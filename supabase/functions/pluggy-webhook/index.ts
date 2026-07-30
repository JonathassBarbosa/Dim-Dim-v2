function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const expectedSecret = Deno.env.get('PLUGGY_WEBHOOK_SECRET');
  const receivedSecret = request.headers.get('x-pluggy-webhook-secret')
    || new URL(request.url).searchParams.get('token');
  if (!expectedSecret || !receivedSecret || receivedSecret !== expectedSecret) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Backend não configurado.' }, 500);

  try {
    const payload = await request.json();
    const eventId = String(payload.eventId || '');
    const eventType = String(payload.event || payload.eventType || '');
    const itemId = String(payload.itemId || payload.item?.id || '');
    const userId = isUuid(payload.clientUserId) ? String(payload.clientUserId) : null;
    if (!eventId || !eventType) return json({ error: 'Evento inválido.' }, 400);

    const baseHeaders = {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation'
    };
    const eventResponse = await fetch(`${supabaseUrl}/rest/v1/provider_webhook_events?on_conflict=provider,provider_event_id`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        provider: 'pluggy',
        provider_event_id: eventId,
        event_type: eventType,
        provider_item_id: itemId || null,
        user_id: userId,
        payload,
        processing_status: userId && itemId ? 'processed' : 'ignored',
        processed_at: new Date().toISOString()
      })
    });
    if (!eventResponse.ok) {
      const error = await eventResponse.json().catch(() => ({}));
      return json({ error: error.message || 'Falha ao registrar evento.' }, 500);
    }

    if (userId && itemId && eventType.startsWith('item/')) {
      const status = eventType === 'item/deleted' ? 'deleted'
        : eventType === 'item/error' ? 'error'
        : eventType === 'item/updated' ? 'active'
        : 'updating';
      await fetch(`${supabaseUrl}/rest/v1/financial_connections?on_conflict=provider,provider_item_id`, {
        method: 'POST',
        headers: { ...baseHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          provider: 'pluggy',
          provider_item_id: itemId,
          status,
          execution_status: payload.item?.executionStatus || null,
          error_code: payload.item?.error?.code || null,
          error_message: payload.item?.error?.message || null,
          last_synced_at: eventType === 'item/updated' ? new Date().toISOString() : null
        })
      });
      if (eventType === 'item/updated') {
        await fetch(`${supabaseUrl}/functions/v1/pluggy-register-item`, {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'x-dimdim-internal-secret': expectedSecret
          },
          body: JSON.stringify({ itemId, userId })
        });
      }
    }

    return json({ ok: true });
  } catch {
    return json({ error: 'Payload inválido.' }, 400);
  }
});
