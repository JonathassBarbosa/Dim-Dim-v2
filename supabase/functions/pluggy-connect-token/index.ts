const PLUGGY_API = 'https://api.pluggy.ai';
const ALLOWED_ORIGINS = new Set([
  'https://jonathassbarbosa.github.io',
  'https://dimdim.smartservices.com.br',
  'http://localhost:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://jonathassbarbosa.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get('authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!authorization || !supabaseUrl || !anonKey) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { authorization, apikey: anonKey }
  });
  return response.ok ? await response.json() : null;
}

async function pluggyApiKey(clientId: string, clientSecret: string) {
  const response = await fetch(`${PLUGGY_API}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret })
  });
  const data = await response.json().catch(() => ({}));
  const apiKey = data.apiKey || data.accessToken;
  if (!response.ok || !apiKey) throw new Error(data.message || 'Falha ao autenticar no Pluggy.');
  return String(apiKey);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);

  const user = await authenticatedUser(request);
  if (!user?.id) return json(request, { error: 'Autenticação obrigatória.' }, 401);

  const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');
  const webhookSecret = Deno.env.get('PLUGGY_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!clientId || !clientSecret || !webhookSecret || !supabaseUrl) {
    return json(request, { error: 'Integração Pluggy não configurada no servidor.' }, 500);
  }

  try {
    const apiKey = await pluggyApiKey(clientId, clientSecret);
    const response = await fetch(`${PLUGGY_API}/connect_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({
        options: {
          clientUserId: user.id,
          webhookUrl: `${supabaseUrl}/functions/v1/pluggy-webhook?token=${encodeURIComponent(webhookSecret)}`,
          oauthRedirectUri: 'https://dimdim.smartservices.com.br/?pluggy=return',
          avoidDuplicates: true
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.accessToken) {
      return json(request, { error: data.message || 'Não foi possível iniciar a conexão bancária.' }, response.status);
    }
    return json(request, {
      connectToken: data.accessToken,
      includeSandbox: Deno.env.get('PLUGGY_INCLUDE_SANDBOX') === 'true'
    });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Falha na integração Pluggy.' }, 502);
  }
});
