const NOTION_API_KEY = process.env.NOTION_API_KEY
const CONFIG_DB_ID = process.env.CONFIG_DB_ID
const DELIVERABLES_DB_ID = process.env.DELIVERABLES_DB_ID
const MILESTONES_DB_ID = process.env.MILESTONES_DB_ID
const PAYMENT_DB_ID = process.env.PAYMENT_DB_ID
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const NOTION_VERSION = '2022-06-28'
const notionHeaders = {
  Authorization: 'Bearer ' + NOTION_API_KEY,
  'Notion-Version': NOTION_VERSION,
  'content-type': 'application/json'
}

// -------- Helpers (no template strings) --------
async function notionQueryAll(database_id, filter) {
  let results = []
  let has_more = true
  let start_cursor = undefined
  while (has_more) {
    const url = 'https://api.notion.com/v1/databases/' + database_id + '/query'
    const res = await fetch(url, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({ filter: filter, start_cursor: start_cursor })
    })
    if (!res.ok) throw new Error(await res.text())
    const json = await res.json()
    results = results.concat(json.results || [])
    has_more = !!json.has_more
    start_cursor = json.next_cursor
  }
  return results
}

function get(obj, path, dflt) {
  if (dflt === undefined) dflt = null
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i]
    if (cur && Object.prototype.hasOwnProperty.call(cur, k)) {
      cur = cur[k]
    } else {
      return dflt
    }
  }
  return cur
}

function parseTitle(prop) { return get(prop, 'title.0.plain_text', '').trim() }
function parseSelect(prop) { return get(prop, 'select.name', '') }
function parseStatus(prop) { return get(prop, 'status.name', '') }
function parseNumber(prop) {
  const n = get(prop, 'number', null)
  return typeof n === 'number' ? n : null
}
function parseDateStart(prop) { return get(prop, 'date.start', null) }
function parseRich(prop) { return get(prop, 'rich_text.0.plain_text', '').trim() }

// -------- Gemini summary (optional; no template strings) --------
async function summarizeWithGemini(payload) {
  if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY')
  const paid = (((payload && payload.kpis && payload.kpis.paidVsBudget) || 0) * 100).toFixed(1)
  const deliv = (((payload && payload.kpis && payload.kpis.deliverablesProgress) || 0) * 100).toFixed(0)
  const over = (payload && payload.kpis && payload.kpis.overBudgetCount) || 0
  const prompt =
    'Summarize project status in 6–8 concise bullet points.n' +
    'Paid vs Budget: ' + paid + '%.n' +
    'Deliverables: ' + deliv + '% complete.n' +
    'Over budget items: ' + over + '.n' +
    'Highlight top risks and upcoming payments.'
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + GEMINI_API_KEY
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }]}] })
  })
  if (!res.ok) throw new Error('Gemini error: ' + (await res.text()))
  const json = await res.json()
  const parts = get(json, 'candidates.0.content.parts', [])
  let text = ''
  for (let i = 0; i < parts.length; i++) {
    if (i) text += 'n'
    text += parts[i].text || ''
  }
  return text || 'No response.'
}

// -------- Handler --------
exports.handler = async (event) => {
  try {
    if (!NOTION_API_KEY) {
      return { statusCode: 500, body: 'Missing NOTION_API_KEY' }
    }

    // POST → AI summary
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}')
      if (body.type === 'summary') {
        const text = await summarizeWithGemini(body.data)
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: text })
        }
      }
      return { statusCode: 400, body: 'Unknown POST type' }
    }

    // GET → Notion → frontend contract
    // 1) Config (key/value)
    const cfgPages = await notionQueryAll(CONFIG_DB_ID)
    const configPairs = {}
    for (let i = 0; i < cfgPages.length; i++) {
      const p = cfgPages[i]
      const props = p.properties || {}
      const key = parseTitle(props['Key'])
      const value = parseRich(props['Value'])
      if (key) configPairs[key] = value
    }

    // 2) Milestones
    const msPages = await notionQueryAll(MILESTONES_DB_ID)
    const milestones = msPages.map((p) => {
      const props = p.properties || {}
      return {
        id: p.id,
        title: parseTitle(props['MilestoneTitle']),
        phase: parseSelect(props['Phase']),
        status: parseSelect(props['Status']),
        progress: ((parseNumber(props['Progress']) || 0) / 100),
        indicator: parseRich(props['Indicator']) || parseRich(props['Indicator [PROD]']) || '',
        riskStatus: parseStatus(props['Risk']) || '',
        endDate: parseDateStart(props['EndDate'])
      }
    })

    // 3) Deliverables (single DB; extend for designer/architect DBs if needed)
    const delPages = await notionQueryAll(DELIVERABLES_DB_ID)
    const deliverables = delPages.map((p) => {
      const props = p.properties || {}
      return {
        title: parseTitle(props['Deliverable Name']),
        gate: parseSelect(props['Gate']) || 'Uncategorized',
        status: parseSelect(props['Status']) || 'Missing'
      }
    })

    // 4) Payments (Payment Schedule or Actuals-style)
    const payPages = await notionQueryAll(PAYMENT_DB_ID)
    const payments = payPages.map((p) => {
      const props = p.properties || {}
      const title = parseTitle(props['Payment For']) || parseTitle(props['Invoice #'])
      const vendor = parseRich(props['Vendor']) || ''
      const amount =
        parseNumber(props['Amount (RM)']) != null ? parseNumber(props['Amount (RM)']) :
        parseNumber(props['Paid (MYR)']) != null ? parseNumber(props['Paid (MYR)']) :
        parseNumber(props['Invoice Amount (Doc)']) != null ? parseNumber(props['Invoice Amount (Doc)']) :
        0
      const status = parseSelect(props['Status']) || 'Outstanding'
      const dueDate = parseDateStart(props['DueDate']) || parseDateStart(props['Paid Date']) || null
      const paidDate = parseDateStart(props['Paid Date']) || null
      return { title: title, vendor: vendor, amount: amount, status: status, dueDate: dueDate, paidDate: paidDate }
    })

    // KPIs (safe defaults)
    const paidRatios = msPages
      .map((p) => get(p, 'properties.Paid vs Budget (%) [PROD].number', null))
      .filter((n) => typeof n === 'number' && isFinite(n))
    const paidVsBudget = paidRatios.length
      ? paidRatios.reduce((a, b) => a + b, 0) / paidRatios.length
      : 0

    const roleProgress = msPages
      .map((p) => {
        const d = get(p, 'properties.Designer Deliverables Progress (%).formula.number', null)
        const a = get(p, 'properties.Architect Deliverables Progress (%).formula.number', null)
        if (typeof d === 'number' && isFinite(d) && typeof a === 'number' && isFinite(a)) {
          return (d + a) / 2
        }
        const u = get(p, 'properties.Deliverables Progress (%).formula.number', null)
        return (typeof u === 'number' && isFinite(u)) ? u : null
      })
      .filter((n) => typeof n === 'number' && isFinite(n))
    const deliverablesProgress = roleProgress.length
      ? roleProgress.reduce((x, y) => x + y, 0) / roleProgress.length
      : 0

    const overBudgetCount = msPages.reduce((cnt, p) => {
      const obBool = get(p, 'properties.Over Budget?.formula.boolean', null)
      const obStr = get(p, 'properties.Over Budget?.formula.string', '')
      const val = (typeof obBool === 'boolean') ? obBool : !!obStr
      return cnt + (val ? 1 : 0)
    }, 0)

    const launchStr = configPairs['Project Launch Date']
    const launchDate = launchStr ? new Date(launchStr) : null
    const now = new Date()
    // FIX APPLIED HERE: Added * between numbers in the denominator
    const daysToLaunch = launchDate
      ? Math.max(0, Math.ceil((+launchDate - +now) / (1000 * 60 * 60 * 24)))
      : 0

    const kpis = {
      daysToLaunch: daysToLaunch,
      paidVsBudget: paidVsBudget,
      deliverablesProgress: deliverablesProgress,
      overBudgetCount: overBudgetCount
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({ kpis: kpis, milestones: milestones, deliverables: deliverables, payments: payments })
    }
  } catch (err) {
    return { statusCode: 500, body: 'Proxy error: ' + (err && err.message ? err.message : String(err)) }
  }
}