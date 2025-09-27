
exports.handler = async function () {

return {

statusCode: 200,

headers: { "content-type": "application/json", "cache-control": "no-store", "Access-Control-Allow-Origin": "*" },

body: JSON.stringify({ ok: true, msg: "kpi function up" })

};

};

