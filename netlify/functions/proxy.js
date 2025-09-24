// This is the final, complete backend function.
// It is upgraded to fetch the new advanced formulas and rollups from Notion.

const { GEMINI_API_KEY, NOTION_API_KEY, MILESTONES_DB_ID, DELIVERABLES_DB_ID, PAYMENTS_DB_ID, CONFIG_DB_ID } = process.env;

// Helper function to call the Gemini API
async function callGemini(prompt) {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured.");
    const apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!apiResponse.ok) { throw new Error(`Gemini API responded with status: ${apiResponse.status}`); }
    const data = await apiResponse.json();
    return data.candidates[0].content.parts[0].text;
}


// Helper function to query a Notion database
async function queryNotionDB(databaseId, filter = {}, sorts = []) {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter, sorts })
    });
    if (!response.ok) {
        console.error(`Notion API Error for DB ${databaseId}:`, await response.json());
        throw new Error(`Notion API responded with status: ${response.status}`);
    }
    return response.json();
}

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (event.httpMethod === 'OPTIONS') { return { statusCode: 204, headers }; }

    try {
        // Handle Gemini POST requests
        if (event.httpMethod === 'POST') {
             const { type, data } = JSON.parse(event.body);
            let prompt = '';
            if (type === 'summary') {
                const kpiText = `Overall Progress: ${(data.kpis.paidVsBudget * 100).toFixed(1)}% of budget paid, Deliverables: ${(data.kpis.deliverablesProgress * 100).toFixed(0)}% approved, Over Budget Items: ${data.kpis.overBudgetCount}, Milestones At Risk: ${data.kpis.milestonesAtRisk}.`;
                const milestonesText = data.milestones.map(m => `- ${m.title} (Status: ${m.riskStatus}, Financials: ${m.indicator})`).join('\n');
                prompt = `Act as a project manager. Based on the following data for a home renovation, write a concise, professional weekly summary for project stakeholders. Be encouraging but realistic.\n\nKPIs:\n${kpiText}\n\nMilestones:\n${milestonesText}`;
            } else if (type === 'suggestion') {
                 prompt = `Act as a senior construction project manager. A project milestone is "At Risk". Provide 3 actionable, concise suggestions to help resolve the issue.\n\nMilestone: "${data.title}"\nFinancial Status: ${data.indicator}\nIssue Description: "${data.gateIssue}"`;
            }

            if (!prompt) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request type' }) }; }
            const geminiResponse = await callGemini(prompt);
            return { statusCode: 200, headers, body: JSON.stringify({ text: geminiResponse }) };
        }

        // Handle Notion GET requests
        if (event.httpMethod === 'GET') {
            if (!MILESTONES_DB_ID || !DELIVERABLES_DB_ID || !PAYMENTS_DB_ID || !CONFIG_DB_ID) {
                throw new Error("Configuration error: One or more database IDs are not set in environment variables.");
            }

            // --- FETCH ALL DATA IN PARALLEL ---
            const [milestonesData, deliverablesData, paymentsData, configData] = await Promise.all([
                queryNotionDB(MILESTONES_DB_ID, {}, [{ property: 'StartDate', direction: 'ascending' }]),
                queryNotionDB(DELIVERABLES_DB_ID),
                queryNotionDB(PAYMENTS_DB_ID),
                queryNotionDB(CONFIG_DB_ID)
            ]);

            // --- PROCESS DATA ---
            const milestones = milestonesData.results.map(p => ({
                id: p.id,
                title: p.properties.MilestoneTitle?.title[0]?.plain_text || 'Untitled',
                status: p.properties.Status?.select?.name || 'N/A',
                riskStatus: p.properties.Risk?.status?.name || 'OK',
                phase: p.properties.Phase?.select?.name || 'Uncategorized',
                progress: p.properties.Progress?.number || 0,
                indicator: p.properties.Indicator?.formula?.string || '🟢 OK', 
                paidVsBudget: p.properties['Paid vs Budget (%)']?.formula?.number || 0,
            }));

            const deliverables = deliverablesData.results.map(p => ({
                id: p.id,
                title: p.properties['Deliverable Name']?.title[0]?.plain_text || 'Untitled',
                gate: p.properties.Gate?.select?.name || 'Uncategorized',
                status: p.properties.Status?.select?.name || 'Missing',
            }));
            
            const payments = paymentsData.results.map(p => ({
                id: p.id,
                title: p.properties['Payment For']?.title[0]?.plain_text || 'Untitled',
                vendor: p.properties.Vendor?.rich_text[0]?.plain_text || 'N/A',
                amount: p.properties['Amount (RM)']?.number || 0,
                status: p.properties.Status?.select?.name || 'Upcoming',
                dueDate: p.properties.DueDate?.date?.start || null,
                paidDate: p.properties.PaidDate?.date?.start || null,
            }));
            
            const config = configData.results.reduce((acc, p) => {
                const key = p.properties.Key?.title[0]?.plain_text;
                const value = p.properties.Value?.rich_text[0]?.plain_text;
                if (key) acc[key] = value;
                return acc;
            }, {});

            // --- CALCULATE AGGREGATE KPIs ---
            const totalBudget = milestonesData.results.reduce((sum, p) => sum + (p.properties['Budget (RM)']?.number || 0), 0);
            const totalPaidSpent = payments.filter(p => p.status === 'Paid').reduce((sum, p) => sum + p.amount, 0);
            const overBudgetCount = milestones.filter(m => m.indicator.includes('Over budget')).length;
            const deliverablesApproved = deliverables.filter(d => d.status === 'Approved').length;
            const launchDate = new Date(config['Project Launch Date']);
            const daysToLaunch = Math.ceil((launchDate - new Date()) / (1000 * 60 * 60 * 24));
            
            const kpis = {
                daysToLaunch: daysToLaunch > 0 ? daysToLaunch : 'Launched',
                paidVsBudget: totalBudget > 0 ? totalPaidSpent / totalBudget : 0,
                deliverablesProgress: deliverables.length > 0 ? deliverablesApproved / deliverables.length : 0,
                overBudgetCount: overBudgetCount,
                milestonesAtRisk: milestones.filter(m => m.riskStatus === 'At Risk').length
            };
            
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ milestones, deliverables, payments, kpis, config })
            };
        }

        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    } catch (error) {
        console.error('Server Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'An internal server error occurred.', details: error.message })};
    }
};

