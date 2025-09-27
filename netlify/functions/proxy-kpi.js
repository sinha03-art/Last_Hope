// Netlify Function (Node 18+): returns a tiny KPI JSON.
// Required env vars in Netlify:
//   NOTION_API_KEY
//   MILESTONES_DB_ID = 📅Project Milestones​
//   CONFIG_DB_ID     = 🛠️Project Config​
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const MILESTONES_DB_ID = process.env.MILESTONES_DB_ID || "📅Project Milestones";
const CONFIG_DB_ID = process.env.CONFIG_DB_ID || "🛠️Project Config";
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
body: JSON.stringify({ page_size: 100, ...body }),
});
if (!res.ok) {
const detail = await res.text().catch(() => "");
throw new Error(Notion ${res.status}: ${detail});
}
return res.json();
}
function get(obj, path, dflt=null) {
try {
const parts = path.split(".");
let cur = obj;
for (const k of parts) {
if (cur == null) return dflt;
cur = cur[k];
}
return cur ?? dflt;
} catch { return dflt; }
}
function average(nums) {
const xs = nums.filter(n => typeof n === "number" && isFinite(n));
if (!xs.length) return 0;
return xs.reduce((a,b)=>a+b,0) / xs.length;
}
exports.handler = async () => {
try {
if (!NOTION_API_KEY) {
return resp(500, { error: "Missing NOTION_API_KEY" });
}
// 1) Fetch milestones
const ms = await notionQuery(MILESTONES_DB_ID);
const msResults = Array.isArray(ms.results) ? ms.results : [];
// paidVsBudget: Milestones.'Paid vs Budget (%)'.formula.number (0..1)
const paidRatios = msResults.map(p =>
get(p, "properties.Paid vs Budget (%).formula.number", null)
).filter(n => typeof n === "number" && isFinite(n));
// deliverablesProgress: Milestones.'Deliverables Progress (%)'.formula.number (0..1)
const delivRatios = msResults.map(p =>
get(p, "properties.Deliverables Progress (%).formula.number", null)
).filter(n => typeof n === "number" && isFinite(n));
// overBudgetCount: Milestones.'Over Budget?'.formula.boolean OR .formula.string truthy
const overBudgetCount = msResults.reduce((cnt, p) => {
const b = get(p, "properties.Over Budget?.formula.boolean", null);
const s = get(p, "properties.Over Budget?.formula.string", "");
const val = (typeof b === "boolean") ? b : !!s;
return cnt + (val ? 1 : 0);
}, 0);
// 2) Fetch config for "Project Launch Date"
const cfg = await notionQuery(CONFIG_DB_ID);
const cfgResults = Array.isArray(cfg.results) ? cfg.results : [];
let launchStr = null;
for (const r of cfgResults) {
const key = get(r, "properties.Key.title.0.plain_text", "").trim();
if (key.toLowerCase() === "project launch date") {
launchStr = get(r, "properties.Value.rich_text.0.plain_text", "").trim();
break;
}
}
let daysToLaunch = 0;
if (launchStr) {
const launchDate = new Date(launchStr);
if (!isNaN(+launchDate)) {
const now = new Date();
daysToLaunch = Math.max(0, Math.ceil((+launchDate - +now) / (10006060*24)));
}
}
const kpis = {
paidVsBudget: average(paidRatios),            // 0..1
deliverablesProgress: average(delivRatios),    // 0..1
overBudgetCount,
daysToLaunch
};
return resp(200, { kpis });
} catch (err) {
return resp(500, { error: "Proxy KPI error", detail: err.message });
}
};
function resp(status, obj) {
return {
statusCode: status,
headers: {
"content-type": "application/json",
"cache-control": "no-store",
"Access-Control-Allow-Origin": "*"
},
body: JSON.stringify(obj)
};
}
