// Netlify Function (Node 18+): returns minimal KPIs from Notion
// Env vars required in Netlify:
//   NOTION_API_KEY
//   MILESTONES_DB_ID = 📅Project Milestones​
//   CONFIG_DB_ID     = 🛠️Project Config​
const NOTION_API_KEY   = process.env.NOTION_API_KEY;
const MILESTONES_DB_ID = process.env.MILESTONES_DB_ID || "📅Project Milestones";
const CONFIG_DB_ID     = process.env.CONFIG_DB_ID     || "🛠️Project Config";
const NOTION_VERSION   = "2022-06-28";
async function notionQuery(databaseId, body) {
if (!body) body = {};
const url = "https://api.notion.com/v1/databases/" + databaseId + "/query";
const res = await fetch(url, {
method: "POST",
headers: {
"Authorization": "Bearer " + NOTION_API_KEY,
"Notion-Version": NOTION_VERSION,
"Content-Type": "application/json"
},
body: JSON.stringify({ page_size: 100, ...body })
});
if (!res.ok) {
const text = await res.text().catch(function(){ return ""; });
throw new Error("Notion " + res.status + ": " + text);
}
return res.json();
}
function get(obj, path, dflt) {
if (dflt === undefined) dflt = null;
try {
var parts = path.split(".");
var cur = obj;
for (var i = 0; i < parts.length; i++) {
if (cur == null) return dflt;
cur = cur[parts[i]];
}
return (cur === undefined || cur === null) ? dflt : cur;
} catch (e) {
return dflt;
}
}
function average(nums) {
var xs = [];
for (var i = 0; i < nums.length; i++) {
var n = nums[i];
if (typeof n === "number" && isFinite(n)) xs.push(n);
}
if (!xs.length) return 0;
var s = 0;
for (var j = 0; j < xs.length; j++) s += xs[j];
return s / xs.length;
}
exports.handler = async function(event, context) {
try {
if (!NOTION_API_KEY) {
return json(500, { error: "Missing NOTION_API_KEY" });
}
// 1) Milestones
var ms = await notionQuery(MILESTONES_DB_ID);
var rows = Array.isArray(ms.results) ? ms.results : [];
// Paid vs Budget — prefer formula number (0..1), fallback to Paid/Budget
var paidVsValues = [];
for (var i = 0; i < rows.length; i++) {
var p = rows[i];
var r = get(p, "properties.Paid vs Budget (%).formula.number", null);
if (!(typeof r === "number" && isFinite(r))) {
var paid = get(p, "properties.Paid Spent (RM).rollup.number", null);
var spent = get(p, "properties.Spent (RM).rollup.number", null);
var bud = get(p, "properties.Budget (RM).number", null);
if (typeof bud === "number" && bud > 0) {
var num = (typeof paid === "number") ? paid : ((typeof spent === "number") ? spent : null);
if (typeof num === "number") r = num / bud;
}
}
if (typeof r === "number" && isFinite(r)) paidVsValues.push(r);
}
// Deliverables Progress — prefer formula number, fallback to designer/architect average
var delivValues = [];
for (var k = 0; k < rows.length; k++) {
var p2 = rows[k];
var d = get(p2, "properties.Deliverables Progress (%).formula.number", null);
if (!(typeof d === "number" && isFinite(d))) {
var dd = get(p2, "properties.Designer Deliverables Progress (%).formula.number", null);
var aa = get(p2, "properties.Architect Deliverables Progress (%).formula.number", null);
if (typeof dd === "number" && typeof aa === "number") d = (dd + aa) / 2;
else if (typeof dd === "number") d = dd;
else if (typeof aa === "number") d = aa;
}
if (typeof d === "number" && isFinite(d)) delivValues.push(d);
}
// Over Budget?
var overBudgetCount = 0;
for (var m = 0; m < rows.length; m++) {
var p3 = rows[m];
var b = get(p3, "properties.Over Budget?.formula.boolean", null);
var s = get(p3, "properties.Over Budget?.formula.string", "");
var val = (typeof b === "boolean") ? b : (s ? true : false);
if (val) overBudgetCount += 1;
}
// 2) Config — Project Launch Date
var cfg = await notionQuery(CONFIG_DB_ID);
var cfgRows = Array.isArray(cfg.results) ? cfg.results : [];
var launchStr = null;
for (var c = 0; c < cfgRows.length; c++) {
var rrow = cfgRows[c];
var key = get(rrow, "properties.Key.title.0.plain_text", "");
key = (key || "").trim().toLowerCase();
if (key === "project launch date") {
launchStr = (get(rrow, "properties.Value.rich_text.0.plain_text", "") || "").trim();
break;
}
}
var daysToLaunch = 0;
if (launchStr) {
var launchDate = new Date(launchStr);
if (!isNaN(+launchDate)) {
var now = new Date();
daysToLaunch = Math.max(0, Math.ceil((+launchDate - +now) / (1000  60  60 * 24)));
}
}
var kpis = {
paidVsBudget: average(paidVsValues),           // 0..1
deliverablesProgress: average(delivValues),    // 0..1
overBudgetCount: overBudgetCount,
daysToLaunch: daysToLaunch
};
var diag = {
milestonesCount: rows.length,
paidVsBudget_usedRows: paidVsValues.length,
deliverables_usedRows: delivValues.length,
hasLaunchDate: !!launchStr
};
return json(200, { kpis: kpis, diag: diag });
} catch (err) {
return json(500, { error: "Proxy KPI error", detail: String(err && err.message ? err.message : err) });
}
};
function json(status, obj) {
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
