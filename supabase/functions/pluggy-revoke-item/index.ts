const PLUGGY_API = 'https://api.pluggy.ai';

function responseHeaders(request: Request) {
  const origin = request.headers.get('origin') || 'https://jonathassbarbosa.github.io';
  const allowed = ['https://jonathassbarbosa.github.io', 'https://dimdim.smartservices.com.br'].includes(origin)
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://jonathassbarbosa.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: responseHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);

  const authorization = request.headers.get('authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');
  if (!authorization || !supabaseUrl || !anonKey || !serviceKey || !clientId || !clientSecret) {
    return json(request, { error: 'Backend não configurado.' }, 500);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { authorization, apikey: anonKey }
  });
  const user = userResponse.ok ? await userResponse.json() : null;
  if (!user?.id) return json(request, { error: 'Sessão inválida.' }, 401);

  try {
    const { itemId } = await request.json();
    const connectionResponse = await fetch(
      `${supabaseUrl}/rest/v1/financial_connections?select=id&user_id=eq.${user.id}&provider_item_id=eq.${encodeURIComponent(itemId)}&limit=1`,
      { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } }
    );
    const connection = (await connectionResponse.json().catch(() => []))[0];
    if (!connection?.id) return json(request, { error: 'Conexão não encontrada.' }, 404);

    const authResponse = await fetch(`${PLUGGY_API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret })
    });
    const authData = await authResponse.json().catch(() => ({}));
    const apiKey = authData.apiKey || authData.accessToken;
    if (!authResponse.ok || !apiKey) throw new Error('Falha ao autenticar no Pluggy.');

    const deleteResponse = await fetch(`${PLUGGY_API}/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: { 'X-API-KEY': apiKey }
    });
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      const error = await deleteResponse.json().catch(() => ({}));
      throw new Error(error.message || 'Não foi possível revogar a conexão.');
    }

    const backendHeaders = {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    };
    await fetch(`${supabaseUrl}/rest/v1/financial_connections?id=eq.${connection.id}`, {
      method: 'PATCH',
      headers: backendHeaders,
      body: JSON.stringify({ status: 'revoked', consent_expires_at: new Date().toISOString() })
    });
    await fetch(`${supabaseUrl}/rest/v1/open_finance_consents?user_id=eq.${user.id}&status=eq.granted`, {
      method: 'PATCH',
      headers: backendHeaders,
      body: JSON.stringify({ status: 'revoked', revoked_at: new Date().toISOString() })
    });

    return json(request, { ok: true });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Falha ao revogar conexão.' }, 500);
  }
});
