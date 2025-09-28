const {
  GEMINI_API_KEY,
  NOTION_API_KEY,
  MILESTONES_DB_ID,
  DELIVERABLES_DB_ID,
  PAYMENTS_DB_ID,
  CONFIG_DB_ID,
} = process.env;

const NOTION_VERSION = '2022-06-28';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }]}] }),
  });
  if (!res.ok) throw new Error(`Gemini API responded with status: ${res.status}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function queryNotionDB(databaseId, filter, sorts) {
  const body = {};
  if (filter && Object.keys(filter).length > 0) body.filter = filter;
  if (sorts && sorts.length > 0) body.sorts = sorts;

  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let errorBody = {};
    try { errorBody = await res.json(); } catch {}
    console.error(`Notion API Error for DB ${databaseId}:`, errorBody);
    throw new Error(`Notion API responded with status: ${res.status}. Message: ${errorBody?.message ?? 'Unknown error'}`);
  }
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    if (event.httpMethod === 'POST') {
      let type, data;
      try { ({ type, data } = JSON.parse(event.body || '{}')); }
      catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

      let prompt = '';
      if (type === 'summary') {
        const k = data.kpis || {};
        const kpiText = `Paid vs Budget: ${((k.paidVsBudget||0)*100).toFixed(1)}%, Deliverables: ${((k.deliverablesProgress||0)*100).toFixed(0)}% approved, Over Budget Items: ${k.overBudgetCount||0}, Milestones At Risk: ${k.milestonesAtRisk||0}.`;
        const milestonesText = (data.milestones||[]).map(m => `- ${m.title} (Risk: ${m.riskStatus}, Financials: ${m.indicator})`).join('\n');
        prompt = `Act as a project manager for a high-end home renovation. Based on the following live data, write a concise, professional weekly summary.\n\nKey Metrics:\n${kpiText}\n\nKey Milestones:\n${milestonesText}`;
      } else if (type === 'suggestion') {
        prompt = `Act as a senior construction PM. A project milestone is "At Risk". Provide 3 concise, actionable suggestions.\n\nMilestone: "${data.title}"\nFinancial Status: ${data.indicator}\nDescribed Issue: "${data.gateIssue}"`;
      } else {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request type' }) };
      }

      const text = await callGemini(prompt);
      return { statusCode: 200, headers, body: JSON.stringify({ text }) };
    }

    if (event.httpMethod === 'GET') {
      if (!MILESTONES_DB_ID || !DELIVERABLES_DB_ID || !PAYMENTS_DB_ID || !CONFIG_DB_ID) {
        throw new Error('Configuration error: One or more database IDs are not set in environment variables.');
      }

      const [milestonesData, deliverablesData, paymentsData, configData] = await Promise.all([
        queryNotionDB(MILESTONES_DB_ID, undefined, [{ property: 'StartDate', direction: 'ascending' }]),
        queryNotionDB(DELIVERABLES_DB_ID),
        queryNotionDB(PAYMENTS_DB_ID),
        queryNotionDB(CONFIG_DB_ID),
      ]);

      const milestones = (milestonesData.results||[]).map(p => ({
        id: p.id,
        title: p.properties?.MilestoneTitle?.title?.[0]?.plain_text ?? 'Untitled',
        riskStatus: p.properties?.Risk?.status?.name ?? 'OK',
        phase: p.properties?.Phase?.select?.name ?? 'Uncategorized',
        progress: p.properties?.Progress?.number ?? 0,
        indicator: p.properties?.Indicator?.formula?.string ?? '🟢 OK',
        paidVsBudget: p.properties?.['Paid vs Budget (%)']?.formula?.number ?? 0,
      }));

      const deliverables = (deliverablesData.results||[]).map(p => ({
        id: p.id,
        title: p.properties?.['Deliverable Name']?.title?.[0]?.plain_text ?? 'Untitled',
        gate: p.properties?.Gate?.select?.name ?? 'Uncategorized',
        status: p.properties?.Status?.select?.name ?? 'Missing',
      }));

      const payments = (paymentsData.results||[]).map(p => ({
        id: p.id,
        title: p.properties?.['Payment For']?.title?.[0]?.plain_text ?? 'Untitled',
        vendor: p.properties?.Vendor?.rich_text?.[0]?.plain_text ?? 'N/A',
        amount: p.properties?.['Amount (RM)']?.number ?? 0,
        status: p.properties?.Status?.select?.name ?? 'Outstanding',
        dueDate: p.properties?.DueDate?.date?.start ?? null,
        paidDate: p.properties?.PaidDate?.date?.start ?? null,
      }));

      const config = (configData.results||[]).reduce((acc, p) => {
        const key = p.properties?.Key?.title?.[0]?.plain_text;
        const value = p.properties?.Value?.rich_text?.[0]?.plain_text;
        if (key) acc[key] = value;
        return acc;
      }, {});

      const totalBudget = (milestonesData.results||[]).reduce((sum, p) => sum + (p.properties?.['Budget (RM)']?.number ?? 0), 0);
      const totalPaidSpent = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + (p.amount||0), 0);
      const overBudgetCount = milestones.filter(m => (m.indicator||'').toLowerCase().includes('over budget')).length;
      const deliverablesApproved = deliverables.filter(d => d.status === 'Approved').length;

      const launchRaw = config['Project Launch Date'];
      const launchDate = launchRaw ? new Date(launchRaw) : null;
      let daysToLaunchVal = 'TBD';
      if (launchDate && !Number.isNaN(+launchDate)) {
        const d = Math.ceil((launchDate - new Date()) / (1000*60*60*24));
        daysToLaunchVal = d >= 0 ? d : 'Launched';
      }

      const kpis = {
        daysToLaunch: daysToLaunchVal,
        paidVsBudget: totalBudget > 0 ? totalPaidSpent / totalBudget : 0,
        deliverablesProgress: deliverables.length > 0 ? deliverablesApproved / deliverables.length : 0,
        overBudgetCount,
        milestonesAtRisk: milestones.filter(m => m.riskStatus === 'At Risk').length,
      };

      return { statusCode: 200, headers, body: JSON.stringify({ milestones, deliverables, payments, kpis, config }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (error) {
    console.error('Server Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'An internal server error occurred.', details: error.message }) };
  }
};
