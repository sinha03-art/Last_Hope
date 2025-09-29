// Keep this helper as-is
function ymKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

// URLs: use plain HTTPS (no braces/placeholders)
const NOTION_DB_QUERY_URL = (dbId) =>
  `https://api.notion.com/v1/databases/${dbId}/query`;

const GEMINI_URL = (model, key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

async function callGemini(prompt) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
  const res = await fetch(GEMINI_URL(GEMINI_MODEL, GEMINI_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0,300)}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function queryNotionDB(databaseId, filter, sorts) {
  const body = {};
  if (filter && Object.keys(filter).length > 0) body.filter = filter;
  if (sorts && sorts.length > 0) body.sorts = sorts;

  const res = await fetch(NOTION_DB_QUERY_URL(databaseId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    console.error(`Notion error for DB ${databaseId}: ${res.status} ${text}`);
    throw new Error(`Notion ${res.status}`);
  }
  return res.json();
}
