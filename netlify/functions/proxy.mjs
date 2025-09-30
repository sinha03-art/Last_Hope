/**
 * Renovation Project Hub proxy (ESM)
 * - GET: Aggregates KPIs, alerts, cashflow, gate aggregates, top vendors, config
 * - POST: { type: 'summary' | 'suggestion', data: {...} } → Gemini text
 *
 * Env vars: NOTION_API_KEY, MILESTONES_DB_ID, DELIVERABLES_DB_ID, PAYMENTS_DB_ID, CONFIG_DB_ID
 * Optional: GEMINI_API_KEY
 */
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

const NOTION_DB_QUERY_URL = (dbId) => `{{https://api.notion.com/v1/databases/${dbId}}}/query`;
const GEMINI_URL = (model, key) =>
  `{{https://generativelanguage.googleapis.com/v1beta/models/${model}}}:generateContent?key=${encodeURIComponent(key)}`;

const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

// Helpers
function ymKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function norm(s=''){ return String(s).trim().toLowerCase(); }

// Optional canonical mapping: map “g2” → “G2 Schematic”, etc.
const CANON_GATE = [
  ['G1 Concept', ['g1','g1 concept','concept']],
  ['G2 Schematic', ['g2','g2 schematic','schematic']],
  ['G3 Design Development', ['g3','g3 design development','design development','dd']],
  ['G4 Authority Submission', ['g4','g4 authority submission','authority']],
  ['G5 Construction Documentation', ['g5','g5 construction documentation','cd']],
  ['G6 Design Close‑out', ['g6','g6 design close‑out','close-out','closeout']],
];
function canonGate(label=''){
  const s = norm(label);
  for (const [canon, aliases] of CANON_GATE) if (aliases.includes(s)) return canon;
  if (/^g[1-6]\s/.test(s)) return label;
  return label || 'Uncategorized';
}

// Notion + Gemini
async function callGemini(prompt) {
  if (!GEMINI_API_KEY) return 'AI summary is unavailable (no API key configured).';
  const res = await fetch(GEMINI_URL(GEMINI_MODEL, GEMINI_API_KEY), {
    method: 'POST', headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ contents:[{ parts:[{ text: prompt }]}] })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(()=>''))?.slice(0,300)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function queryNotionDB(databaseId, filter, sorts) {
  const baseBody = {};
  if (filter && Object.keys(filter).length) baseBody.filter = filter;
  if (sorts && sorts.length) baseBody.sorts = sorts;

  const headers = {
    Authorization: `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  let results = [], start_cursor;
  do {
    const res = await fetch(NOTION_DB_QUERY_URL(databaseId), {
      method:'POST', headers, body: JSON.stringify({ ...baseBody, start_cursor })
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
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
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers: baseHeaders };

  try {
    if (event.httpMethod === 'POST') {
      let type, data; try { ({ type, data } = JSON.parse(event.body || '{}')); } catch {
        return { statusCode:400, headers: baseHeaders, body: JSON.stringify({ error:'Invalid JSON body' }) };
      }
      if (type !== 'summary' && type !== 'suggestion') {
        return { statusCode:400, headers: baseHeaders, body: JSON.stringify({ error:'Invalid request type' }) };
      }
      const k = data?.kpis || {};
      const kpiText = `Paid vs Budget: ${((k.paidVsBudget||0)*100).toFixed(1)}%, Deliverables: ${((k.deliverablesProgress||0)*100).toFixed(0)}% approved, Milestones At Risk: ${k.milestonesAtRisk||0}, Next 30d Due: RM ${(k.next30?.amount||0).toLocaleString('en-MY')} (${k.next30?.count||0} items).`;
      const milestonesText = (data?.milestones||[]).slice(0,10).map(m=>`- ${m.title} (Risk: ${m.riskStatus}, Financials: ${m.indicator})`).join('\n');
      const prompt = type === 'summary'
        ? `Act as a renovation PM. Based on the live data, write a concise weekly update with Wins, Risks, and Next Actions.\nKey Metrics: ${kpiText}\nKey Milestones:\n${milestonesText}`
        : `Act as a senior construction PM. A milestone is "At Risk". Provide 3 concise actions.\nMilestone: "${data?.title}"\nFinancial: ${data?.indicator}\nIssue: "${data?.gateIssue}"`;
      const text = await callGemini(prompt);
      return { statusCode:200, headers: baseHeaders, body: JSON.stringify({ text }) };
    }

    if (event.httpMethod === 'GET') {
      const missing = ['MILESTONES_DB_ID','DELIVERABLES_DB_ID','PAYMENTS_DB_ID','CONFIG_DB_ID','NOTION_API_KEY']
        .filter(k => !process.env[k]);
      if (missing.length) {
        return { statusCode:500, headers: baseHeaders, body: JSON.stringify({ error:'Missing environment variables', details: missing }) };
      }

      const [milestonesData, deliverablesData, paymentsData, configData] = await Promise.all([
        queryNotionDB(MILESTONES_DB_ID, undefined, [{ property:'StartDate', direction:'ascending' }]),
        queryNotionDB(DELIVERABLES_DB_ID),
        queryNotionDB(PAYMENTS_DB_ID),
        queryNotionDB(CONFIG_DB_ID),
      ]);

      // Map records
      const milestones = (milestonesData.results||[]).map(p => ({
        id: p.id,
        title: p.properties?.MilestoneTitle?.title?.[0]?.plain_text ?? p.properties?.Name?.title?.[0]?.plain_text ?? 'Untitled',
        riskStatus: p.properties?.Risk?.status?.name ?? 'OK',
        phase: canonGate(p.properties?.Phase?.select?.name ?? 'Uncategorized'),
        progress: p.properties?.Progress?.number ?? 0,
        indicator: p.properties?.Indicator?.formula?.string ?? p.properties?.Indicator?.rich_text?.[0]?.plain_text ?? '🟢 OK',
        url: p.url,
      }));

      const deliverables = (deliverablesData.results||[]).map(p => ({
        id: p.id,
        title: p.properties?.['Deliverable Name']?.title?.[0]?.plain_text ?? p.properties?.Name?.title?.[0]?.plain_text ?? 'Untitled',
        gate: canonGate(p.properties?.Gate?.select?.name ?? 'Uncategorized'),
        status: p.properties?.Status?.select?.name ?? 'Missing',
        assignees: (p.properties?.Owner?.people||[]).map(x => x.name || x.person?.email || x.id),
        url: p.url,
      }));

      const payments = (paymentsData.results||[]).map(p => ({
        id: p.id,
        title: p.properties?.['Payment For']?.title?.[0]?.plain_text ?? p.properties?.Name?.title?.[0]?.plain_text ?? 'Untitled',
        vendor: p.properties?.Vendor?.rich_text?.[0]?.plain_text ?? p.properties?.Vendor?.select?.name ?? p.properties?.Vendor?.title?.[0]?.plain_text ?? 'N/A',
        amount: p.properties?.['Amount (RM)']?.number ?? 0,
        status: p.properties?.Status?.select?.name ?? 'Outstanding',
        dueDate: p.properties?.DueDate?.date?.start ?? null,
        paidDate: p.properties?.PaidDate?.date?.start ?? null,
        url: p.url,
      }));

      // Config key-value map
      const config = (configData.results||[]).reduce((acc, p) => {
        const key = p.properties?.Key?.title?.[0]?.plain_text ?? p.properties?.Name?.title?.[0]?.plain_text ?? '';
        const value = p.properties?.Value?.rich_text?.[0]?.plain_text ?? p.properties?.Value?.select?.name ?? p.properties?.Value?.title?.[0]?.plain_text ?? '';
        if (key) acc[key] = value;
        return acc;
      }, {});

      // KPIs
      const totalBudget = (milestonesData.results||[]).reduce((s,p)=> s + (p.properties?.['Budget (RM)']?.number ?? 0), 0);
      const totalPaid = payments.filter(p=>p.status==='Paid').reduce((s,p)=> s + (p.amount||0), 0);

      const now = new Date(), in30 = new Date(now.getTime() + 30*24*60*60*1000);
      const overdue = payments.filter(p=> p.status!=='Paid' && p.dueDate && new Date(p.dueDate) < now)
        .sort((a,b)=> new Date(a.dueDate)-new Date(b.dueDate));
      const upcoming = payments.filter(p=> p.status!=='Paid' && p.dueDate && new Date(p.dueDate) >= now && new Date(p.dueDate) <= in30)
        .sort((a,b)=> new Date(a.dueDate)-new Date(b.dueDate));
      const next30 = { amount: upcoming.reduce((s,p)=> s + (p.amount||0), 0), count: upcoming.length, items: upcoming.slice(0,50) };

      const deliverablesIssues = deliverables.filter(d=> d.status==='Missing' || d.status==='Rejected');
      const milestonesRisk = milestones.filter(m=> m.riskStatus==='At Risk');

      const cashAgg = {};
      payments.forEach(p=>{
        const due = p.dueDate ? new Date(p.dueDate) : null;
        if (due){ const k = ymKey(due); cashAgg[k] = cashAgg[k] || { ym:k, scheduled:0, paid:0 }; cashAgg[k].scheduled += (p.amount||0); }
        const paid = p.paidDate ? new Date(p.paidDate) : null;
        if (paid){ const k2 = ymKey(paid); cashAgg[k2] = cashAgg[k2] || { ym:k2, scheduled:0, paid:0 }; cashAgg[k2].paid += (p.amount||0); }
      });
      const cashflow = Object.values(cashAgg).sort((a,b)=> a.ym.localeCompare(b.ym, 'en', { numeric:true }));

      // Gate metrics (base)
      const gatesIndex = {};
      function ensureGate(id){ gatesIndex[id] = gatesIndex[id] || { id, required:0, approved:0, submitted:0, blocked:0, milestonesComplete:0 }; return gatesIndex[id]; }
      deliverables.forEach(d=>{
        const gi = ensureGate(d.gate || 'Uncategorized');
        gi.required += 1;
        if (d.status==='Approved') gi.approved += 1;
        else if (d.status==='Submitted') gi.submitted += 1;
        else if (d.status==='Rejected' || d.status==='Missing') gi.blocked += 1;
      });
      milestones.forEach(m=>{
        const gi = ensureGate(m.phase || 'Uncategorized');
        const complete = (typeof m.progress==='number' && m.progress >= 100) || String(m.indicator||'').toLowerCase().includes('complete');
        if (complete) gi.milestonesComplete += 1;
      });
      let gates = Object.values(gatesIndex).map(gi => ({
        ...gi,
        gateApprovalRate: gi.required>0 ? gi.approved/gi.required : 0,
        gateSubmissionRate: gi.required>0 ? (gi.approved+gi.submitted)/gi.required : 0,
      }));

      // ----- ENFORCEMENT: REQUIRED_BY_GATE / PRECONSTRUCTION -----
      function toSetLower(arr){ const s=new Set(); (arr||[]).forEach(x=> s.add(norm(x))); return s; }
      function deliveredApprovedIndexByTitle(delivs){ const s=new Set(); (delivs||[]).forEach(d=>{ if (d.status==='Approved') s.add(norm(d.title)); }); return s; }

      let reqConfigRaw = {};
      try { reqConfigRaw = JSON.parse(config['REQUIRED_BY_GATE'] || config['Gate Requirements'] || '{}'); } catch {}
      const REQUIRED_BY_GATE = reqConfigRaw || {};
      const PRE_REQ = toSetLower(REQUIRED_BY_GATE.PreconstructionRequired || []);
      const approvedTitles = deliveredApprovedIndexByTitle(deliverables);

      function gateAllRequiredApproved(gate){
        const req = REQUIRED_BY_GATE[gate] || [];
        if (req.length === 0) return false;
        return req.every(title => approvedTitles.has(norm(title)));
      }
      const preconstructionOK = PRE_REQ.size > 0 && Array.from(PRE_REQ).every(title => approvedTitles.has(title));

      const gatesStrict = (gates||[]).map(gi => {
        const allApproved = gateAllRequiredApproved(gi.id);
        return { ...gi, completeStrict: allApproved, unlocked: allApproved && gi.blocked === 0 };
      });

      function inferGateForPayment(p){
        const t = norm(p.title);
        if (t.includes('foshan') || t.includes('tranche')) return 'G5 Construction Documentation';
        if (t.includes('permit') || t.includes('mbsa')) return 'G4 Authority Submission';
        if (t.includes('fer') || t.includes('designer') || t.includes('claim')) return 'G2 Schematic';
        return 'Uncategorized';
      }
      function computeBlockedReasons(p){
        const reasons = [];
        if (!preconstructionOK) reasons.push('Pre‑construction prerequisites not fully approved');
        const g = inferGateForPayment(p);
        if (g !== 'Uncategorized' && !gateAllRequiredApproved(g)) reasons.push(`Gate requirements not fully approved (${g})`);
        return reasons;
      }
      const paymentsWithFlags = (payments||[]).map(p=>{
        const blockedReasons = computeBlockedReasons(p);
        const payable = blockedReasons.length === 0;
        return { ...p, payable, blockedReasons };
      });

      const kpis = {
        paidVsBudget: totalBudget > 0 ? totalPaid/totalBudget : 0,
        deliverablesProgress: deliverables.length>0 ? (deliverables.filter(d=>d.status==='Approved').length / deliverables.length) : 0,
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
          payments: paymentsWithFlags,
          kpis,
          alerts,
          cashflow,
          gates: gatesStrict,
          topVendors: Object.entries(
            payments.reduce((m,p)=>{ if(p.status!=='Paid'){ m[p.vendor||'Unknown']=(m[p.vendor||'Unknown']||0)+(p.amount||0);} return m; },{})
          ).map(([vendor,amount])=>({vendor,amount})).sort((a,b)=>b.amount-a.amount).slice(0,5),
          config,
        }),
      };
    }

    return { statusCode:405, headers: baseHeaders, body: JSON.stringify({ error:'Method Not Allowed' }) };
  } catch (error) {
    console.error('Server Error:', error);
    return { statusCode:500, headers: baseHeaders, body: JSON.stringify({ error:'An internal server error occurred.', details: error.message }) };
  }
};
