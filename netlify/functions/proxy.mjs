/**
 * JOOBIN Renovation Hub Proxy v6.3.1
 * Fixed: Notion API 400 errors
 */

const {
  GEMINI_API_KEY,
  NOTION_API_KEY,
  NOTION_BUDGET_DB_ID,
  NOTION_ACTUALS_DB_ID,
  MILESTONES_DB_ID,
  DELIVERABLES_DB_ID,
  VENDOR_REGISTRY_DB_ID,
  CONFIG_DB_ID,
} = process.env;

const NOTION_VERSION = '2022-06-28';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';

const notionHeaders = () => ({
  'Authorization': `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
});

async function queryNotionDB(dbId, filter = {}) {
  const url = `https://api.notion.com/v1/databases/${dbId}/query`;
  const body = Object.keys(filter).length > 0 ? { filter, page_size: 100 } : { page_size: 100 };
  
  const res = await fetch(url, {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`Notion API error ${res.status} for DB ${dbId}:`, errorText);
    throw new Error(`Notion API error: ${res.status}`);
  }
  
  return res.json();
}

function getProp(page, propName) {
  const prop = page.properties[propName];
  if (!prop) return null;
  
  switch (prop.type) {
    case 'title':
      return prop.title?.[0]?.plain_text || '';
    case 'rich_text':
      return prop.rich_text?.[0]?.plain_text || '';
    case 'number':
      return prop.number || 0;
    case 'select':
      return prop.select?.name || '';
    case 'multi_select':
      return prop.multi_select?.map(s => s.name) || [];
    case 'status':
      return prop.status?.name || '';
    case 'date':
      return prop.date?.start || null;
    case 'formula':
      return prop.formula?.number || 0;
    case 'relation':
      return prop.relation?.map(r => r.id) || [];
    default:
      return null;
  }
}

const vendorTradeCache = {};

async function getVendorTrade(vendorName) {
  if (vendorTradeCache[vendorName]) return vendorTradeCache[vendorName];
  
  try {
    // Query all vendors without filter to avoid syntax issues
    const result = await queryNotionDB(VENDOR_REGISTRY_DB_ID);
    
    const vendor = result.results.find(page => {
      const name = getProp(page, 'Company_Name') || getProp(page, 'Company Name');
      return name === vendorName;
    });
    
    if (vendor) {
      const trade = getProp(vendor, 'Trade Specialization') || getProp(vendor, 'Trade_Specialization') || '—';
      vendorTradeCache[vendorName] = trade;
      return trade;
    }
  } catch (err) {
    console.error(`Vendor trade lookup failed for ${vendorName}:`, err);
  }
  
  vendorTradeCache[vendorName] = '—';
  return '—';
}

async function handleGet() {
  console.log('Starting data fetch from Notion...');
  
  try {
    const [budgetData, actualsData, milestonesData, deliverablesData, configData] = 
      await Promise.all([
        queryNotionDB(NOTION_BUDGET_DB_ID),
        queryNotionDB(NOTION_ACTUALS_DB_ID),
        queryNotionDB(MILESTONES_DB_ID),
        queryNotionDB(DELIVERABLES_DB_ID),
        queryNotionDB(CONFIG_DB_ID),
      ]);

    console.log(`Fetched: ${budgetData.results.length} budget, ${actualsData.results.length} actuals, ${deliverablesData.results.length} deliverables`);

    // Budget calculation
    const budgetMYR = budgetData.results.reduce((sum, page) => {
      return sum + (getProp(page, 'Subtotal (Formula)') || getProp(page, 'Subtotal') || 0);
    }, 0);

    // Paid calculation
    const paidMYR = actualsData.results.reduce((sum, page) => {
      const status = getProp(page, 'Status');
      const amount = getProp(page, 'Paid (MYR)') || getProp(page, 'Paid') || 0;
      return status === 'Paid' ? sum + amount : sum;
    }, 0);

    const remainingMYR = budgetMYR - paidMYR;

    // Deliverables
    const deliverablesTotal = deliverablesData.results.length;
    const deliverablesApproved = deliverablesData.results.filter(page => {
      return getProp(page, 'Status') === 'Approved';
    }).length;

    // Milestones at risk
    const milestonesAtRisk = milestonesData.results.filter(page => {
      return getProp(page, 'Risk_Status') === 'At Risk' || getProp(page, 'Risk Status') === 'At Risk';
    }).length;

    const kpis = {
      budgetMYR: Math.round(budgetMYR),
      paidMYR: Math.round(paidMYR),
      remainingMYR: Math.round(remainingMYR),
      deliverablesApproved,
      deliverablesTotal,
      paidVsBudget: budgetMYR > 0 ? paidMYR / budgetMYR : 0,
      deliverablesProgress: deliverablesTotal > 0 ? deliverablesApproved / deliverablesTotal : 0,
      milestonesAtRisk,
    };

    // Gates
    const REQUIRED_BY_GATE = configData.results.length > 0 
      ? JSON.parse(getProp(configData.results[0], 'REQUIRED_BY_GATE') || '{}')
      : {};

    const gates = Object.keys(REQUIRED_BY_GATE).map(gateName => {
      const requiredItems = REQUIRED_BY_GATE[gateName] || [];
      const approved = deliverablesData.results.filter(page => {
        const title = getProp(page, 'Title');
        const status = getProp(page, 'Status');
        return requiredItems.includes(title) && status === 'Approved';
      }).length;

      return {
        gate: gateName,
        total: requiredItems.length,
        approved,
        gateApprovalRate: requiredItems.length > 0 ? approved / requiredItems.length : 0,
      };
    });

    // Top Vendors
    const vendorPayments = {};
    actualsData.results.forEach(page => {
      const vendor = getProp(page, 'Vendor') || 'Unknown';
      const amount = getProp(page, 'Paid (MYR)') || getProp(page, 'Paid') || 0;
      const status = getProp(page, 'Status');
      
      if (status === 'Paid') {
        vendorPayments[vendor] = (vendorPayments[vendor] || 0) + amount;
      }
    });

    const topVendorsRaw = Object.entries(vendorPayments)
      .map(([vendor, amount]) => ({ vendor, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const topVendors = await Promise.all(
      topVendorsRaw.map(async (v) => ({
        name: v.vendor,
        paid: Math.round(v.amount),
        trade: await getVendorTrade(v.vendor),
      }))
    );

    // Milestones
    const milestones = milestonesData.results.map(page => {
      const riskStatus = getProp(page, 'Risk_Status') || getProp(page, 'Risk Status') || '';
      return {
        title: getProp(page, 'MilestoneTitle') || getProp(page, 'Title') || '',
        phase: getProp(page, 'Phase') || '',
        riskStatus,
        status: riskStatus,
        risk: riskStatus === 'At Risk' ? 'High' : 'Low',
        budgetAllocated: getProp(page, 'Budget_Allocated') || getProp(page, 'Budget Allocated') || 0,
        actualSpend: getProp(page, 'Actual_Spend') || getProp(page, 'Actual Spend') || 0,
      };
    });

    // Payments
    const payments = actualsData.results.map(page => {
      const vendor = getProp(page, 'Vendor') || '';
      return {
        vendor,
        recipient: vendor,
        amount: getProp(page, 'Paid (MYR)') || getProp(page, 'Paid') || 0,
        status: getProp(page, 'Status') || '',
        dueDate: getProp(page, 'Due_Date') || getProp(page, 'Due Date') || getProp(page, 'Paid Date') || null,
      };
    });

    // Deliverables
    const ownerMap = { 
      solomon: 'Solomon', 
      harminder: 'Harminder' 
    };
    
    const deliverables = deliverablesData.results.map(page => {
      const rawOwner = (getProp(page, 'Owner') || '').toLowerCase();
      return {
        title: getProp(page, 'Title') || '',
        status: getProp(page, 'Status') || '',
        gate: getProp(page, 'Gate') || '',
        owner: ownerMap[rawOwner] || rawOwner || '',
        submittedDate: getProp(page, 'Submitted_Date') || getProp(page, 'Submitted Date') || null,
        approvedDate: getProp(page, 'Approved_Date') || getProp(page, 'Approved Date') || null,
      };
    });

    console.log('Data processing complete');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kpis,
        gates,
        topVendors,
        milestones,
        payments,
        deliverables,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('GET handler error:', error);
    throw error;
  }
}

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500,
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No summary available.';
}

async function handlePost(body) {
  const { kpis, alerts, milestones } = JSON.parse(body);
  
  const prompt = `You are a renovation project assistant. Summarize the following project status in 2-3 sentences:

KPIs: Budget ${kpis.budgetMYR} MYR, Paid ${kpis.paidMYR} MYR, Remaining ${kpis.remainingMYR} MYR. Deliverables: ${kpis.deliverablesApproved}/${kpis.deliverablesTotal} approved.

Alerts: ${alerts.length} active alerts.

Milestones at risk: ${kpis.milestonesAtRisk}

Provide a concise executive summary focusing on budget health, progress, and key risks.`;

  const summary = await callGemini(prompt);
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary }),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return await handleGet();
    } else if (event.httpMethod === 'POST') {
      return await handlePost(event.body);
    } else {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
