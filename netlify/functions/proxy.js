// This is a temporary backend function for testing all THREE database connections.

exports.handler = async (event) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
    
    // --- CONFIGURATION ---
    const { NOTION_API_KEY, MILESTONES_DB_ID, DELIVERABLES_DB_ID, PAYMENTS_DB_ID } = process.env;

    const queryNotionDB = async (databaseId, propertyName) => {
        // This helper function will test one database at a time.
        if (!databaseId) {
            return { success: false, error: `Configuration Error: The Database ID for this test is missing from Netlify environment variables.` };
        }
        try {
            if (!NOTION_API_KEY) {
                 return { success: false, error: `Configuration Error: The NOTION_API_KEY is missing.` };
            }

            const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${NOTION_API_KEY}`, 
                    'Notion-Version': '2022-06-28', 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({})
            });

            if (!response.ok) {
                const errorBody = await response.json();
                console.error('Notion API Error:', errorBody);
                return { success: false, error: `Notion API responded with status ${response.status}: ${errorBody.message}` };
            }

            const data = await response.json();
            const titles = data.results.map(p => ({ title: p.properties[propertyName]?.title[0]?.plain_text || `Untitled (Check property name: ${propertyName})` }));
            return { success: true, data: titles };

        } catch (error) {
            console.error('Server-side fetch error:', error);
            return { success: false, error: error.message };
        }
    };

    // Run all three tests in parallel.
    const [milestonesResult, deliverablesResult, paymentsResult] = await Promise.all([
        queryNotionDB(MILESTONES_DB_ID, 'MilestoneTitle'),
        queryNotionDB(DELIVERABLES_DB_ID, 'Deliverable Name'),
        queryNotionDB(PAYMENTS_DB_ID, 'Payment For')
    ]);

    // Return a structured result for all tests.
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
            milestones: milestonesResult,
            deliverables: deliverablesResult,
            payments: paymentsResult
        })
    };
};

