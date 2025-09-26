const NOTION_API_KEY = process.env.NOTION_API_KEY
const CONFIG_DB_ID = process.env.CONFIG_DB_ID
const DELIVERABLES_DB_ID = process.env.DELIVERABLES_DB_ID
const MILESTONES_DB_ID = process.env.MILESTONES_DB_ID
const PAYMENT_DB_ID = process.env.PAYMENT_DB_ID
const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const NOTION_VERSION = '2022-06-28'
const notionHeaders = {
Authorization: Bearer ${NOTION_API_KEY},
'Notion-Version': NOTION_VERSION,
'content-type': 'application/json'
}
// ---------- Helpers ----------
async function notionQueryAll(database_id, filter) {
let results = []
let has_more = true
let start_cursor = undefined
while (has_more) {
const url = https://api.notion.com/v1/databases/${database_id}/query
const res = await fetch(url, {
method: 'POST',
headers: notionHeaders,
body: JSON.stringify({ filter, start_cursor })
})
if (!res.ok) throw new Error(await res.text())
const json = await res.json()
results = results.concat(json.results || [])
has_more = json.has_more
start_cursor = json.next_cursor
}
return results
}
const get = (obj, path, dflt = null) =>
path.split('.').reduce((o, k) => (o && k in o ? o[k] : dflt), obj)
const parseTitle = (prop) => get(prop, 'title.0.plain_text', '').trim()
const parseSelect = (prop) => get(prop, 'select.name', '')
const parseStatus = (prop) => get(prop, 'status.name', '')
const parseNumber = (prop) => (typeof get(prop, 'number') === 'number' ? get(prop, 'number') : null)
const parseDateStart = (prop) => get(prop, 'date.start', null)
const parseRich = (prop) => get(prop, 'rich_text.0.plain_text', '').trim()
// ---------- Gemini summary (optional) ----------
async function summarizeWithGemini(payload) {
if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY')
const paid = ((payload?.kpis?.paidVsBudget ?? 0) * 100).toFixed(1)
const deliv = ((payload?.kpis?.deliverablesProgress ?? 0) * 100).toFixed(0)
const over = payload?.kpis?.overBudgetCount ?? 0
const prompt =
Summarize project status in 6–8 concise bullet points.\n +
Paid vs Budget: ${paid}%.\n +
Deliverables: ${deliv}% complete.\n +
Over budget items: ${over}.\n +
Highlight top risks and upcoming payments.
const url = https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}
const res = await fetch(url, {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({ contents: [{ parts: [{ text: prompt }]}] })
})
if (!res.ok) throw new Error(Gemini error: ${await res.text()})
const json = await res.json()
const text =
(json?.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('n') ||
'No response.'
return text
}
// ---------- Handler ----------
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
body: JSON.stringify({ text })
}
}
return { statusCode: 400, body: 'Unknown POST type' }
}
// GET → Notion → frontend contract
// 1) Config
const cfgPages = await notionQueryAll(CONFIG_DB_ID)
const configPairs = {}
for (const p of cfgPages) {
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
progress: (parseNumber(props['Progress']) ?? 0) / 100,
indicator: parseRich(props['Indicator']) || parseRich(props['Indicator [PROD]']) || '',
riskStatus: parseStatus(props['Risk']) || '',
endDate: parseDateStart(props['EndDate'])
}
})
// 3) Deliverables (single DB; extend if you also want designer/architect DBs)
const delPages = await notionQueryAll(DELIVERABLES_DB_ID)
const deliverables = delPages.map((p) => {
const props = p.properties || {}
return {
title: parseTitle(props['Deliverable Name']),
gate: parseSelect(props['Gate']) || 'Uncategorized',
status: parseSelect(props['Status']) || 'Missing'
}
})
// 4) Payments (supports Payment Schedule or Actuals-style fields)
const payPages = await notionQueryAll(PAYMENT_DB_ID)
const payments = payPages.map((p) => {
const props = p.properties || {}
const title = parseTitle(props['Payment For']) || parseTitle(props['Invoice #'])
const vendor = parseRich(props['Vendor']) || ''
const amount =
parseNumber(props['Amount (RM)']) ??
parseNumber(props['Paid (MYR)']) ??
parseNumber(props['Invoice Amount (Doc)']) ??
0
const status = parseSelect(props['Status']) || 'Outstanding'
const dueDate = parseDateStart(props['DueDate']) ?? parseDateStart(props['Paid Date']) ?? null
const paidDate = parseDateStart(props['Paid Date']) ?? null
return { title, vendor, amount, status, dueDate, paidDate }
})
// KPIs
const paidRatios = msPages
.map((p) => get(p, 'properties.Paid vs Budget (%) [PROD].number'))
.filter((n) => Number.isFinite(n))
const paidVsBudget = paidRatios.length
? paidRatios.reduce((a, b) => a + b, 0) / paidRatios.length
: 0
const roleProgress = msPages
.map((p) => {
const d = get(p, 'properties.Designer Deliverables Progress (%).formula.number')
const a = get(p, 'properties.Architect Deliverables Progress (%).formula.number')
if (Number.isFinite(d) && Number.isFinite(a)) return (d + a) / 2
const u = get(p, 'properties.Deliverables Progress (%).formula.number')
return Number.isFinite(u) ? u : NaN
})
.filter(Number.isFinite)
const deliverablesProgress = roleProgress.length
? roleProgress.reduce((x, y) => x + y, 0) / roleProgress.length
: 0
const overBudgetCount = msPages.reduce((cnt, p) => {
const obBool = get(p, 'properties.Over Budget?.formula.boolean')
const obStr = get(p, 'properties.Over Budget?.formula.string')
const val = typeof obBool === 'boolean' ? obBool : Boolean(obStr)
return cnt + (val ? 1 : 0)
}, 0)
const launchStr = configPairs['Project Launch Date']
const launchDate = launchStr ? new Date(launchStr) : null
const now = new Date()
const daysToLaunch = launchDate
? Math.max(0, Math.ceil((+launchDate - +now) / (1000  60  60 * 24)))
: 0
const kpis = { daysToLaunch, paidVsBudget, deliverablesProgress, overBudgetCount }
return {
statusCode: 200,
headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
body: JSON.stringify({ kpis, milestones, deliverables, payments })
}
} catch (err) {
return { statusCode: 500, body: Proxy error: ${err.message || String(err)} }
}
}
