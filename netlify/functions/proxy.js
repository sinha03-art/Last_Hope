exports.handler = async () => {

return {

statusCode: 200,

headers: { 'content-type': 'application/json' },

body: JSON.stringify({

ok: true,

hasNotionKey: !!process.env.NOTION_API_KEY,

time: new Date().toISOString()

})

}

}