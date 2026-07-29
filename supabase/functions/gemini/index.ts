const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

Deno.serve(async (request) => {
  const origin = request.headers.get('origin') || '*';
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), { status: 405, headers });
  }

  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return new Response(JSON.stringify({ error: 'Autenticação obrigatória.' }), { status: 401, headers });
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurada.' }), { status: 500, headers });
  }

  try {
    const payload = await request.json();
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: String(payload.systemInstruction || '') }] },
        contents: Array.isArray(payload.contents) ? payload.contents : [],
        tools: [{ google_search: {} }]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      const message =
        (typeof data?.error === 'string' && data.error) ||
        data?.error?.message ||
        data?.message ||
        'O provedor de IA não conseguiu responder agora.';
      return new Response(JSON.stringify({ error: message }), { status: response.status, headers });
    }
    return new Response(JSON.stringify(data), { status: response.status, headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Não foi possível consultar o Gemini.' }), { status: 500, headers });
  }
});
