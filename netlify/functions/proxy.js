/**
 * Renovation Project Hub proxy (ESM)
 * - GET: Aggregates KPIs, alerts, cashflow, gate aggregates, top vendors, config
 * - POST: { type: 'summary' | 'suggestion', data: {...} } → Gemini text
 *
 * Env vars required (set in Netlify → Site settings → Environment):
 * - NOTION_API_KEY
 * - MILESTONES_DB_ID
 * - DELIVERABLES_DB_ID
 * - PAYMENTS_DB_ID
 * - CONFIG_DB_ID
 * Optional:
 * - GEMINI_API_KEY
 */

const {
  GEMINI_API_KEY,
  NOTION_API_KEY,
  MILESTONES_DB_ID,
  DELIVERABLES_DB_ID,
  PAYMENTS_DB_ID,
  CONFIG_DB_ID,
} = process.env;

const NOTION_VERSION = '2022-06-28'; // Update only after testing with your schema
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';

const NOTION_DB_QUERY_URL = (dbId) => `https://api.notion.com/v1/databases/${dbId}/query`;
const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

function ymKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Canonicalize/normalize gate labels
function normGate(s = '') {
  return String(s).trim();
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) {
    // Graceful behavior when key is absent
    return 'AI summary is unavailable (no API key configured).';
  }
  const res = await fetch(GEMINI_URL(GEMINI_MODEL, GEMINI_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// Notion query with pagination
async function queryNotionDB(databaseId, filter, sorts) {
  const baseBody = {};
  if (filter && Object.keys(filter).length > 0) baseBody.filter = filter;
  if (sorts && sorts.length > 0) baseBody.sorts = sorts;

  const headers = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  let results = [];
  let start_cursor;

  do {
    const res = await fetch(NOTION_DB_QUERY_URL(databaseId), {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...baseBody, start_cursor }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Notion error for DB ${databaseId}: ${res.status} ${text}`);
      throw new Error(`Notion ${res.status}`);
    }
    const data = await res.json();
    results = results.concat(data.results || []);
    start_cursor = data.has_more ? data.next_cursor : undefined;
  } while (start_cursor);

  return { results };
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: baseHeaders };
  }

  try {
    if (event.httpMethod === 'POST') {
      let type, data;
      try {
        ({ type, data } = JSON.parse(event.body || '{}'));
      } catch {
        return {
          statusCode: 400,
          headers: baseHeaders,
          body: JSON.stringify({ error: 'Invalid JSON body' }),
        };
      }

      if (type !== 'summary' && type !== 'suggestion') {
        return {
          statusCode: 400,
          headers: baseHeaders,
          body: JSON.stringify({ error: 'Invalid request type' }),
        };
      }

      let prompt = '';
      if (type === 'summary') {
        const k = data?.kpis || {};
        const kpiText = `Paid vs Budget: ${((k.paidVsBudget || 0) * 100).toFixed(
          1
        )}%, Deliverables: ${((k.deliverablesProgress || 0) * 100).toFixed(0)}% approved, Milestones At Risk: ${
          k.milestonesAtRisk || 0
        }, Next 30d Due: RM ${(k.next30?.amount || 0).toLocaleString('en-MY')} (${k.next30?.count || 0} items).`;
        const milestonesText = (data?.milestones || [])
          .slice(0, 10)
          .map((m) => `- ${m.title} (Risk: ${m.riskStatus}, Financials: ${m.indicator})`)
          .join('\n');

        prompt = `Act as a renovation PM. Based on the live data, write a concise weekly update with Wins, Risks, and Next Actions.
Key Metrics: ${kpiText}
Key Milestones:
${milestonesText}`;
      } else {
        // type === 'suggestion'
        prompt = `Act as a senior construction PM. A milestone is "At Risk". Provide 3 concise actions.
Milestone: "${data?.title}"
Financial: ${data?.indicator}
Issue: "${data?.gateIssue}"`;
      }

      const text = await callGemini(prompt);
      return { statusCode: 200, headers: baseHeaders, body: JSON.stringify({ text }) };
    }

    if (event.httpMethod === 'GET') {
      const missing = [
        'MILESTONES_DB_ID',
        'DELIVERABLES_DB_ID',
        'PAYMENTS_DB_ID',
        'CONFIG_DB_ID',
        'NOTION_API_KEY',
      ].filter((k) => !process.env[k]);

      if (missing.length) {
        return {
          statusCode: 500,
          headers: baseHeaders,
          body: JSON.stringify({ error: 'Missing environment variables', details: missing }),
        };
      }

      const [milestonesData, deliverablesData, paymentsData, configData] = await Promise.all([
        queryNotionDB(MILESTONES_DB_ID, undefined, [{ property: 'StartDate', direction: 'ascending' }]),
        queryNotionDB(DELIVERABLES_DB_ID),
        queryNotionDB(PAYMENTS_DB_ID),
        queryNotionDB(CONFIG_DB_ID),
      ]);

      // Mappers with robust fallbacks
      const milestones = (milestonesData.results || []).map((p) => ({
        id: p.id,
        title:
          p.properties?.MilestoneTitle?.title?.[0]?.plain_text ??
          p.properties?.Name?.title?.[0]?.plain_text ??
          'Untitled',
        riskStatus: p.properties?.Risk?.status?.name ?? 'OK',
        phase: normGate(p.properties?.Phase?.select?.name ?? 'Uncategorized'),
        progress: p.properties?.Progress?.number ?? 0,
        indicator:
          p.properties?.Indicator?.formula?.string ??
          p.properties?.Indicator?.rich_text?.[0]?.plain_text ??
          '🟢 OK',
        url: p.url,
      }));

      const deliverables = (deliverablesData.results || []).map((p) => ({
        id: p.id,
        title:
          p.properties?.['Deliverable Name']?.title?.[0]?.plain_text ??
          p.properties?.Name?.title?.[0]?.plain_text ??
          'Untitled',
        gate: normGate(p.properties?.Gate?.select?.name ?? 'Uncategorized'),
        status: p.properties?.Status?.select?.name ?? 'Missing',
        assignees: (p.properties?.Owner?.people || []).map(
          (x) => x.name || x.person?.email || x.id
        ),
        url: p.url,
      }));

      const payments = (paymentsData.results || []).map((p) => ({
        id: p.id,
        title:
          p.properties?.['Payment For']?.title?.[0]?.plain_text ??
          p.properties?.Name?.title?.[0]?.plain_text ??
          'Untitled',
        vendor:
          p.properties?.Vendor?.rich_text?.[0]?.plain_text ??
          p.properties?.Vendor?.select?.name ??
          p.properties?.Vendor?.title?.[0]?.plain_text ??
          'N/A',
        amount: p.properties?.['Amount (RM)']?.number ?? 0,
        status: p.properties?.Status?.select?.name ?? 'Outstanding',
        dueDate: p.properties?.DueDate?.date?.start ?? null,
        paidDate: p.properties?.PaidDate?.date?.start ?? null,
        url: p.url,
      }));

      // Config KV
      const config = (configData.results || []).reduce((acc, p) => {
        const key = p.properties?.Key?.title?.[0]?.plain_text;
        const value =
          p.properties?.Value?.rich_text?.[0]?.plain_text ??
          p.properties?.Value?.select?.name ??
          p.properties?.Value?.title?.[0]?.plain_text ??
          '';
        if (key) acc[key] = value;
        return acc;
      }, {});

      // KPIs and computations
      const totalBudget = (milestonesData.results || []).reduce(
        (s, p) => s + (p.properties?.['Budget (RM)']?.number ?? 0),
        0
      );
      const totalPaid = payments
        .filter((p) => p.status === 'Paid')
        .reduce((s, p) => s + (p.amount || 0), 0);

      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const overdue = payments
        .filter((p) => {
          if (p.status === 'Paid') return false;
          const d = p.dueDate ? new Date(p.dueDate) : null;
          return d && d < now;
        })
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      const upcoming = payments
        .filter((p) => {
          if (p.status === 'Paid') return false;
          const d = p.dueDate ? new Date(p.dueDate) : null;
          return d && d >= now && d <= in30;
        })
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      const next30 = {
        amount: upcoming.reduce((s, p) => s + (p.amount || 0), 0),
        count: upcoming.length,
        items: upcoming.slice(0, 50),
      };

      const deliverablesIssues = deliverables.filter(
        (d) => d.status === 'Missing' || d.status === 'Rejected'
      );
      const milestonesRisk = milestones.filter((m) => m.riskStatus === 'At Risk');

      const cashAgg = {};
      payments.forEach((p) => {
        const due = p.dueDate ? new Date(p.dueDate) : null;
        if (due) {
          const k = ymKey(due);
          cashAgg[k] = cashAgg[k] || { ym: k, scheduled: 0, paid: 0 };
          cashAgg[k].scheduled += p.amount || 0;
        }
        const paid = p.paidDate ? new Date(p.paidDate) : null;
        if (paid) {
          const k2 = ymKey(paid);
          cashAgg[k2] = cashAgg[k2] || { ym: k2, scheduled: 0, paid: 0 };
          cashAgg[k2].paid += p.amount || 0;
        }
      });
      const cashflow = Object.values(cashAgg).sort((a, b) =>
        a.ym.localeCompare(b.ym, 'en', { numeric: true })
      );

      const gatesIndex = {};
      // From deliverables
      deliverables.forEach((d) => {
        const g = d.gate || 'Uncategorized';
        gatesIndex[g] = gatesIndex[g] || { id: g, required: 0, approved: 0, blocked: 0, milestonesComplete: 0 };
        gatesIndex[g].required += 1;
        if (d.status === 'Approved') gatesIndex[g].approved += 1;
        if (d.status === 'Rejected' || d.status === 'Missing') gatesIndex[g].blocked += 1;
      });
      // From milestones
      milestones.forEach((m) => {
        const g = m.phase || 'Uncategorized';
        gatesIndex[g] = gatesIndex[g] || { id: g, required: 0, approved: 0, blocked: 0, milestonesComplete: 0 };
        if (m.progress >= 1 || String(m.indicator).toLowerCase().includes('complete')) {
          gatesIndex[g].milestonesComplete += 1;
        }
      });
      const gates = Object.values(gatesIndex);

      const vendorOutstanding = {};
      payments.forEach((p) => {
        if (p.status !== 'Paid') {
          const key = p.vendor || 'Unknown';
          vendorOutstanding[key] = (vendorOutstanding[key] || 0) + (p.amount || 0);
        }
      });
      const topVendors = Object.entries(vendorOutstanding)
        .map(([vendor, amount]) => ({ vendor, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);

      const kpis = {
        paidVsBudget: totalBudget > 0 ? totalPaid / totalBudget : 0,
        deliverablesProgress:
          deliverables.length > 0
            ? deliverables.filter((d) => d.status === 'Approved').length / deliverables.length
            : 0,
        milestonesAtRisk: milestonesRisk.length,
        next30,
      };

      const alerts = { paymentsOverdue: overdue, paymentsUpcoming: upcoming, deliverablesIssues, milestonesRisk };

      return {
        statusCode: 200,
        headers: baseHeaders,
        body: JSON.stringify({
          milestones,
          deliverables,
          payments,
          kpis,
          alerts,
          cashflow,
          gates,
          topVendors,
          config,
        }),
      };
    }

    return {
      statusCode: 405,
      headers: baseHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  } catch (error) {
    console.error('Server Error:', error);
    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ error: 'An internal server error occurred.', details: error.message }),
    };
  }
};
