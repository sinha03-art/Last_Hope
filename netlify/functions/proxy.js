// netlify/functions/proxy.js

const { Client } = require('@notionhq/client');

// Initialize Notion Client globally to reuse across invocations.
// It will only be initialized once per Netlify function instance lifecycle.
let notion;
if (process.env.NOTION_API_KEY) {
    notion = new Client({ auth: process.env.NOTION_API_KEY });
} else {
    // Log an error if the API key isn't set, this will appear in Netlify Function logs
    console.error("CRITICAL: NOTION_API_KEY environment variable is not set. Notion client cannot be initialized.");
}

// Map 'type' query parameters to actual Notion database IDs.
// These IDs MUST be set as environment variables in Netlify.
const DATABASE_IDS = {
    milestones: process.env.NOTION_MILESTONES_DB_ID,
    deliverables: process.env.NOTION_DELIVERABLES_DB_ID,
    payments: process.env.NOTION_PAYMENTS_DB_ID,
    config: process.env.NOTION_CONFIG_DB_ID,
};

exports.handler = async (event, context) => {
    // Basic CORS headers for local testing or explicit cross-origin needs.
    // Netlify Functions typically handle simple CORS requests automatically for your deployed site.
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // Be more restrictive in production if needed, e.g., "https://your-dashboard.netlify.app"
        "Access-Control-Allow-Methods": "GET",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    // Handle OPTIONS preflight requests for CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: headers
        };
    }

    // Check if the Notion client was successfully initialized
    if (!notion) {
        console.error("Notion client not initialized due to missing API key.");
        return {
            statusCode: 500,
            headers: headers,
            body: JSON.stringify({ error: "Server configuration error: Notion API key not set." }),
        };
    }

    const { type } = event.queryStringParameters || {}; // Safely access query parameters

    // Validate the 'type' parameter
    if (!type || !DATABASE_IDS[type]) {
        console.warn(`Invalid or missing 'type' parameter received: ${type}`);
        return {
            statusCode: 400,
            headers: headers,
            body: JSON.stringify({ error: "Invalid or missing 'type' parameter in request." }),
        };
    }

    const databaseId = DATABASE_IDS[type];

    try {
        // Query the Notion database
        const response = await notion.databases.query({
            database_id: databaseId,
        });

        return {
            statusCode: 200,
            headers: headers,
            body: JSON.stringify(response), // Send Notion's response directly
        };
    } catch (error) {
        console.error(`Notion API query error for type '${type}' (DB ID: ${databaseId}):`, error);

        // Provide more granular error details if it's a Notion API error
        let errorMessage = "Failed to fetch data from Notion API.";
        let statusCode = 500;

        if (error.code) { // Notion API error codes
            errorMessage = `Notion API Error (${error.code}): ${error.message}`;
            statusCode = error.status || 500; // Use Notion's provided status
        } else {
            errorMessage = `Unexpected error: ${error.message}`;
        }

        return {
            statusCode: statusCode,
            headers: headers,
            body: JSON.stringify({
                error: errorMessage,
                details: error.message,
                notionError: error.code || null,
            }),
        };
    }
};