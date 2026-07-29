const PLUGGY_API = 'https://api.pluggy.ai';

function headers(request: Request) {
  const origin = request.headers.get('origin') || 'https://jonathassbarbosa.github.io';
  const allowed = origin === 'https://jonathassbarbosa.github.io' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://jonathassbarbosa.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

async function pluggyKey() {
  const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Integração Pluggy não configurada.');
  const response = await fetch(`${PLUGGY_API}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret })
  });
  const data = await response.json().catch(() => ({}));
  const apiKey = data.apiKey || data.accessToken;
  if (!response.ok || !apiKey) throw new Error(data.message || 'Falha ao autenticar no Pluggy.');
  return apiKey;
}

async function pluggyGet(path: string, apiKey: string) {
  const response = await fetch(`${PLUGGY_API}${path}`, { headers: { 'X-API-KEY': apiKey } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Falha ao consultar ${path}.`);
  return data;
}

async function supabaseUpsert(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  conflict: string,
  body: unknown
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data.message || `Falha ao salvar ${table}.`);
  return data;
}

async function syncProducts(
  apiKey: string,
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  itemId: string,
  connectionId: string,
  institutionName: string | null
) {
  const accountPage = await pluggyGet(`/accounts?itemId=${encodeURIComponent(itemId)}`, apiKey);
  const accounts = Array.isArray(accountPage.results) ? accountPage.results : [];
  let transactionCount = 0;
  let billCount = 0;

  for (const account of accounts) {
    const accountRows = await supabaseUpsert(
      supabaseUrl,
      serviceKey,
      'external_accounts',
      'connection_id,provider_account_id',
      {
        user_id: userId,
        connection_id: connectionId,
        provider_account_id: String(account.id),
        type: account.type || null,
        subtype: account.subtype || null,
        name: account.marketingName || account.name || 'Conta',
        institution: institutionName,
        balance: Number.isFinite(Number(account.balance)) ? Number(account.balance) : null,
        currency: String(account.currencyCode || 'BRL').slice(0, 3),
        raw_data: {
          creditData: account.creditData || null,
          bankData: account.bankData || null,
          numberLastFour: String(account.number || '').replace(/\D/g, '').slice(-4) || null
        }
      }
    );
    const externalAccountId = accountRows[0]?.id;

    let nextPath = `/v2/transactions?accountId=${encodeURIComponent(account.id)}`;
    for (let page = 0; nextPath && page < 20; page += 1) {
      const transactionPage = await pluggyGet(nextPath, apiKey);
      const transactions = Array.isArray(transactionPage.results) ? transactionPage.results : [];
      if (transactions.length) {
        await supabaseUpsert(
          supabaseUrl,
          serviceKey,
          'external_transactions',
          'connection_id,provider_transaction_id',
          transactions.map((transaction: Record<string, unknown>) => ({
            user_id: userId,
            connection_id: connectionId,
            external_account_id: externalAccountId || null,
            provider_transaction_id: String(transaction.id),
            description: String(transaction.description || transaction.descriptionRaw || '').slice(0, 500),
            amount: Number(transaction.amount || 0),
            occurred_at: transaction.date || transaction.createdAt || new Date().toISOString(),
            category: typeof transaction.category === 'string'
              ? transaction.category
              : String((transaction.category as Record<string, unknown> | null)?.description || ''),
            payment_data: transaction.paymentData || {},
            merchant: transaction.merchant || {},
            raw_data: {
              type: transaction.type || null,
              status: transaction.status || null,
              providerId: transaction.providerId || null,
              creditCardMetadata: transaction.creditCardMetadata || null
            }
          }))
        );
        transactionCount += transactions.length;
      }
      nextPath = typeof transactionPage.next === 'string' && transactionPage.next
        ? (transactionPage.next.startsWith('/v2/') ? transactionPage.next : `/v2/transactions${transactionPage.next}`)
        : '';
    }

    if (account.type === 'CREDIT') {
      const billPage = await pluggyGet(`/bills?accountId=${encodeURIComponent(account.id)}`, apiKey);
      const bills = Array.isArray(billPage.results) ? billPage.results : [];
      if (bills.length) {
        await supabaseUpsert(
          supabaseUrl,
          serviceKey,
          'external_credit_card_bills',
          'connection_id,provider_bill_id',
          bills.map((bill: Record<string, unknown>) => ({
            user_id: userId,
            connection_id: connectionId,
            provider_bill_id: String(bill.id),
            provider_account_id: String(account.id),
            due_date: bill.dueDate || null,
            closing_date: bill.billClosingDate || null,
            total_amount: Number.isFinite(Number(bill.totalAmount)) ? Number(bill.totalAmount) : null,
            minimum_payment: Number.isFinite(Number(bill.minimumPaymentAmount))
              ? Number(bill.minimumPaymentAmount)
              : null,
            status: bill.status || null,
            raw_data: {
              currencyCode: bill.totalAmountCurrencyCode || 'BRL',
              allowsInstallments: Boolean(bill.allowsInstallments)
            }
          }))
        );
        const upcoming = bills.filter((bill: Record<string, unknown>) => {
          if (!bill.dueDate) return false;
          const due = new Date(String(bill.dueDate)).getTime();
          return due >= Date.now() - 86_400_000 && due <= Date.now() + (45 * 86_400_000);
        });
        if (upcoming.length) {
          await supabaseUpsert(
            supabaseUrl,
            serviceKey,
            'notifications',
            'user_id,idempotency_key',
            upcoming.map((bill: Record<string, unknown>) => ({
              user_id: userId,
              type: 'bill_due',
              title: 'Fatura identificada',
              body: `${institutionName || 'Seu cartão'}: fatura de R$ ${Number(bill.totalAmount || 0).toFixed(2).replace('.', ',')} com vencimento em ${String(bill.dueDate).slice(0, 10)}.`,
              severity: 'warning',
              data: {
                source: 'pluggy',
                itemId,
                accountId: account.id,
                billId: bill.id,
                dueDate: bill.dueDate,
                amount: Number(bill.totalAmount || 0)
              },
              idempotency_key: `pluggy-bill-${bill.id}`,
              scheduled_for: new Date().toISOString()
            }))
          );
        }
        billCount += bills.length;
      }
    }
  }

  return { accounts: accounts.length, transactions: transactionCount, bills: billCount };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);

  const authorization = request.headers.get('authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorization || !supabaseUrl || !anonKey || !serviceKey) {
    return json(request, { error: 'Autenticação obrigatória.' }, 401);
  }

  try {
    const payload = await request.json();
    const internalSecret = request.headers.get('x-dimdim-internal-secret');
    const expectedInternalSecret = Deno.env.get('PLUGGY_WEBHOOK_SECRET');
    let user;
    if (internalSecret && expectedInternalSecret && internalSecret === expectedInternalSecret) {
      user = { id: String(payload.userId || '') };
    } else {
      const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { authorization, apikey: anonKey }
      });
      user = userResponse.ok ? await userResponse.json() : null;
    }
    if (!user?.id) return json(request, { error: 'Sessão inválida.' }, 401);

    const itemId = String(payload.itemId || '');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(itemId)) {
      return json(request, { error: 'Conexão inválida.' }, 400);
    }

    const apiKey = await pluggyKey();
    const item = await pluggyGet(`/items/${encodeURIComponent(itemId)}`, apiKey);
    if (item.clientUserId !== user.id) {
      return json(request, { error: 'A conexão não pertence ao usuário autenticado.' }, 403);
    }

    const connector = item.connector || {};
    const result = await supabaseUpsert(
      supabaseUrl,
      serviceKey,
      'financial_connections',
      'provider,provider_item_id',
      {
        user_id: user.id,
        provider: 'pluggy',
        provider_item_id: itemId,
        institution_name: connector.name || item.name || null,
        connector_id: connector.id ? String(connector.id) : null,
        status: item.status === 'UPDATED' ? 'active' : 'updating',
        execution_status: item.executionStatus || null,
        error_code: item.error?.code || null,
        error_message: item.error?.message || null,
        last_synced_at: item.lastUpdatedAt || null,
        metadata: { connectorImageUrl: connector.imageUrl || null }
      }
    );
    const connection = result[0];
    if (!connection?.id) return json(request, { error: 'Falha ao salvar conexão.' }, 500);

    const synced = item.status === 'UPDATED'
      ? await syncProducts(
        apiKey,
        supabaseUrl,
        serviceKey,
        user.id,
        itemId,
        connection.id,
        connector.name || item.name || null
      )
      : { accounts: 0, transactions: 0, bills: 0 };

    return json(request, { ok: true, connection, synced });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Falha ao registrar conexão.' }, 500);
  }
});
