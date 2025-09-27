// Netlify Function: minimal KPIs (Milestones + Config + Payments)
// Env vars required: NOTION_API_KEY, MILESTONES_DB_ID, CONFIG_DB_ID, PAYMENT_DB_ID
const NOTION_API_KEY   = process.env.NOTION_API_KEY;
const MILESTONES_DB_ID = process.env.MILESTONES_DB_ID || "📅Project Milestones";
const CONFIG_DB_ID     = process.env.CONFIG_DB_ID     || "🛠️Project Config";
const PAYMENT_DB_ID    = process.env.PAYMENT_DB_ID    || "💳Payment Schedule";
const NOTION_VERSION   = "2022-06-28";
async function notionQuery(id, body){ if(!body) body={};
const url = "https://api.notion.com/v1/databases/"+id+"/query";
const r = await fetch(url,{method:"POST",headers:{
"Authorization":"Bearer "+NOTION_API_KEY,"Notion-Version":NOTION_VERSION,"Content-Type":"application/json"
},body:JSON.stringify({page_size:100})});
if(!r.ok){ const t=await r.text().catch(()=> ""); throw new Error("Notion "+r.status+": "+t); }
return r.json();
}
function get(o,p,d){ if(d===undefined)d=null; try{var a=p.split("."),c=o;for(var i=0;i<a.length;i++){ if(c==null)return d; c=c[a[i]];} return (c===undefined||c===null)?d:c;}catch(e){return d}}
function avg(xs){ var a=[],i; for(i=0;i<xs.length;i++){var n=xs[i]; if(typeof n==="number"&&isFinite(n)) a.push(n);} if(!a.length)return 0; var s=0; for(i=0;i<a.length;i++) s+=a[i]; return s/a.length;}
function sum(xs){ var s=0,i; for(i=0;i<xs.length;i++){var n=xs[i]; if(typeof n==="number"&&isFinite(n)) s+=n;} return s;}
exports.handler = async function(){
try{
if(!NOTION_API_KEY) return json(500,{error:"Missing NOTION_API_KEY"});
if(!MILESTONES_DB_ID||!CONFIG_DB_ID) return json(500,{error:"Missing DB IDs (milestones/config)"});
// 1) Milestones
var ms = await notionQuery(MILESTONES_DB_ID);
var rows = Array.isArray(ms.results)?ms.results:[];
var paidVs=[], deliv=[], over=0, i, p;
for(i=0;i<rows.length;i++){
p=rows[i];
var pv = get(p,"properties.Paid vs Budget (%).formula.number",null);
if(typeof pv==="number"&&isFinite(pv)) paidVs.push(pv);
var dp = get(p,"properties.Deliverables Progress (%).formula.number",null);
if(typeof dp==="number"&&isFinite(dp)) deliv.push(dp);
var ob = get(p,"properties.Over Budget?.formula.boolean",null);
var os = get(p,"properties.Over Budget?.formula.string","");
var val = (typeof ob==="boolean")? ob : (os?true:false);
if(val) over+=1;
}
// 2) Config (Project Launch Date)
var cfg = await notionQuery(CONFIG_DB_ID);
var cfgRows = Array.isArray(cfg.results)?cfg.results:[], launch=null;
for(i=0;i<cfgRows.length;i++){
var r=cfgRows[i];
var k=(get(r,"properties.Key.title.0.plain_text","")||"").trim().toLowerCase();
if(k==="project launch date"){ launch=(get(r,"properties.Value.rich_text.0.plain_text","")||"").trim(); break; }
}
var days=0;
if(launch){
var L=new Date(launch); if(!isNaN(+L)){ var now=new Date(); days=Math.max(0,Math.ceil((+L-+now)/(10006060*24))); }
}
// 3) Payments (optional but recommended)
var paymentsOutstandingNext30RM = 0;
var paymentsPaidTotalRM = 0;
if (PAYMENT_DB_ID) {
var py = await notionQuery(PAYMENT_DB_ID);
var pys = Array.isArray(py.results)?py.results:[];
var todayISO = new Date();
var in30ISO = new Date(Date.now()+302460601000);
// Normalize to YYYY-MM-DD for safe comparisons
function toYMD(d){ return d.toISOString().slice(0,10); }
var todayYMD = toYMD(todayISO);
var in30YMD = toYMD(in30ISO);
var outstanding = [];
var paid = [];
for (i=0;i<pys.length;i++){
var row = pys[i];
var status = get(row,"properties.Status.select.name","");
var amt = get(row,"properties.Amount (RM).number",null);
var due = get(row,"properties.DueDate.date.start",null);
var paidDate = get(row,"properties.PaidDate.date.start",null);
if (status==="Outstanding") {
if (typeof amt==="number" && isFinite(amt)) {
if (due) {
var dueYMD = (new Date(due)).toISOString().slice(0,10);
if (dueYMD >= todayYMD && dueYMD <= in30YMD) outstanding.push(amt);
}
}
} else if (status==="Paid") {
if (typeof amt==="number" && isFinite(amt)) paid.push(amt);
}
}
paymentsOutstandingNext30RM = sum(outstanding);
paymentsPaidTotalRM = sum(paid);
}
return json(200,{kpis:{
paidVsBudget:avg(paidVs),             // 0..1
deliverablesProgress:avg(deliv),      // 0..1
overBudgetCount:over,
daysToLaunch:days,
paymentsOutstandingNext30RM:paymentsOutstandingNext30RM,
paymentsPaidTotalRM:paymentsPaidTotalRM
}, diag:{
milestonesCount:rows.length,
paidVsBudget_usedRows:paidVs.length,
deliverables_usedRows:deliv.length,
hasLaunchDate: !!launch
}});
}catch(e){ return json(500,{error:"Proxy KPI error",detail:String(e&&e.message?e.message:e)})}
}
function json(s,b){ return {statusCode:s,headers:{"content-type":"application/json","cache-control":"no-store","Access-Control-Allow-Origin":"*"},body:JSON.stringify(b)}}
