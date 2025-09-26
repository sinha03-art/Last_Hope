const NOTION_API_KEY = process.env.NOTION_API_KEY;
const CONFIG_DB_ID = process.env.CONFIG_DB_ID;
const MILESTONES_DB_ID = process.env.MILESTONES_DB_ID;
const DELIVERABLES_DB_ID = process.env.DELIVERABLES_DB_ID;
const PAYMENT_DB_ID = process.env.PAYMENT_DB_ID;

const NOTION_VERSION = "2022-06-28";

// Helper function for CORS headers
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

async function notionQuery(databaseId, body = {}) {
  // Check if databaseId is valid before proceeding
  if (!databaseId || typeof databaseId !== 'string' || databaseId.length !== 32) {
    throw new Error("Invalid Notion database ID provided: " + databaseId);
  }

  const url = "https://api.notion.com/v1/databases/" + databaseId + "/query";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + NOTION_API_KEY,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 25, ...body }),
  });

  if (!res.ok) {
    let detail = await res.text().catch(() => "");
    throw new Error(`Notion API Error ${res.status}: ${detail}`);
  }

  return res.json();
}

exports.handler = async (event) => {
  try {
    if (!NOTION_API_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ error: "Missing NOTION_API_KEY environment variable." }),
      };
    }

    const url = new URL(event.rawUrl || ("https://x" + (event.path || "") + (event.queryStringParameters ? "?" + new URLSearchParams(event.queryStringParameters) : "")));
    const type = (url.searchParams.get("type") || "").toLowerCase(); // Changed default to empty string

    let dbId;
    if (type === "milestones") dbId = MILESTONES_DB_ID;
    else if (type === "deliverables") dbId = DELIVERABLES_DB_ID;
    else if (type === "payments") dbId = PAYMENT_DB_ID;
    else if (type === "config") dbId = CONFIG_DB_ID;
    else {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Unknown or missing 'type' parameter. Expected: milestones, deliverables, payments, or config." }) };
    }

    // Ensure the specific DB ID for the requested type is set
    if (!dbId) {
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: `Missing environment variable for ${type.toUpperCase()}_DB_ID.` }) };
    }

    const data = await notionQuery(dbId);

    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify(data),
    };
  } catch (err) {
    console.error("Proxy Function Error:", err); // Log the full error for debugging
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Proxy error", detail: err.message || String(err) }),
    };
  }
};