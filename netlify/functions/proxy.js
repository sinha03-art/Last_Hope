const NOTION_API_KEY = process.env.NOTION_API_KEY;

const CONFIG_DB_ID = process.env.CONFIG_DB_ID || "[Project Config](https://www.notion.so/2c05a80cd06781ab9afa0003e3692781/ds/e99269c204bd47749e8e0f144651cdf7?db=5ed0e89ba8484377bbaa1ce74f478574&pvs=21)";

const MILESTONES_DB_ID = process.env.MILESTONES_DB_ID || "[Project Milestones](https://www.notion.so/2c05a80cd06781ab9afa0003e3692781/ds/be255c8aba634d0b9a7d68b152fb7c2e?db=13262b8e4fea4a969d03c9032e99088f&pvs=21)";

const DELIVERABLES_DB_ID = process.env.DELIVERABLES_DB_ID || "[Gate Deliverables](https://www.notion.so/2c05a80cd06781ab9afa0003e3692781/ds/91c8fc8aeafa4015b47e814f27ea45fc?db=d754a179028046b4a8040c7153935558&pvs=21)";

const PAYMENT_DB_ID = process.env.PAYMENT_DB_ID || "[Payment Schedule](https://www.notion.so/2c05a80cd06781ab9afa0003e3692781/ds/0032bf7e1db04b6bad248721a81fff04?db=7f679ba982e24ad4bcc194b106cbfb3b&pvs=21)";

const NOTION_VERSION = "2022-06-28";

async function notionQuery(databaseId, body = {}) {

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

throw new Error(`Notion ${res.status}: ${detail}`);

}

return res.json();

}

exports.handler = async (event) => {

try {

if (!NOTION_API_KEY) {

return {

statusCode: 500,

headers: corsHeaders(),

body: JSON.stringify({ error: "Missing NOTION_API_KEY" }),

};

}

const url = new URL(event.rawUrl || ("https://x" + (event.path || "") + (event.queryStringParameters ? "?" + new URLSearchParams(event.queryStringParameters) : "")));

const type = (url.searchParams.get("type") || "milestones").toLowerCase();

let dbId;

if (type === "milestones") dbId = MILESTONES_DB_ID;

else if (type === "deliverables") dbId = DELIVERABLES_DB_ID;

else if (type === "payments") dbId = PAYMENT_DB_ID;

else if (type === "config") dbId = CONFIG_DB_ID;

else {

return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: "Unknown type" }) };

}

// You can add per-type filters here later if needed

const data = await notionQuery(dbId);

return {

statusCode: 200,

headers: { ...corsHeaders(), "content-type": "application/json", "cache-control": "no-store" },

body: JSON.stringify(data),

};

} catch (err) {

return {

statusCode: 500,

headers: corsHeaders(),

body: JSON.stringify({ error: "Proxy error", detail: err.message }),

};

}

};

function corsHeaders() {

return {

"Access-Control-Allow-Origin": "*",

"Access-Control-Allow-Methods": "GET,OPTIONS",

"Access-Control-Allow-Headers": "Content-Type, Authorization",

};

}