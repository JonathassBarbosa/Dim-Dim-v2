const SESSION_KEY = 'dd_supabase_session';

export function apiErrorMessage(data, status) {
  const candidates = [
    data?.msg,
    data?.message,
    data?.error_description,
    typeof data?.error === 'string' ? data.error : data?.error?.message,
    data?.details,
    data?.hint
  ];
  return candidates.find(value => typeof value === 'string' && value.trim())
    || `Falha no servidor (HTTP ${status}).`;
}

function saoPauloParts(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:${get('second')}`
  };
}

export class DimDimApi {
  constructor(url = '', anonKey = '') {
    this.configure(url, anonKey);
    this.session = this.#loadSession();
  }

  configure(url, anonKey) {
    this.url = String(url || '').trim().replace(/\/+$/, '');
    this.anonKey = String(anonKey || '').trim();
  }

  isConfigured() {
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(this.url) && this.anonKey.length >= 20;
  }

  isAuthenticated() {
    return Boolean(this.session?.access_token && this.session?.user?.id);
  }

  async signIn(email, password) {
    this.#assertConfigured();
    const data = await this.#request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: { email, password },
      auth: false
    });
    this.#saveSession(data);
    return data;
  }

  async signUp(email, password, name = '', phone = '') {
    this.#assertConfigured();
    const data = await this.#request('/auth/v1/signup', {
      method: 'POST',
      body: {
        email,
        password,
        data: {
          name,
          phone,
          terms_version: '2026-07-30',
          privacy_version: '2026-07-30'
        }
      },
      auth: false
    });
    if (data.access_token) this.#saveSession(data);
    return data;
  }

  async requestPasswordRecovery(email, redirectTo) {
    this.#assertConfigured();
    return this.#request(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      body: { email },
      auth: false
    });
  }

  async updatePasswordWithToken(accessToken, password) {
    this.#assertConfigured();
    const response = await fetch(`${this.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: this.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiErrorMessage(data, response.status));
    return data;
  }

  currentUser() {
    return this.session?.user || null;
  }

  async signOut() {
    if (this.session?.access_token) {
      await this.#request('/auth/v1/logout', { method: 'POST' }).catch(() => {});
    }
    this.#saveSession(null);
  }

  async get(action, params = {}) {
    this.#assertAuthenticated();
    if (action === 'config') return this.#getConfig();
    if (action === 'historico') return this.#getHistory(params.limit);
    if (action === 'painel') return this.#getDashboard(params.periodo);
    if (action === 'resumoFinanceiro') {
      return this.#request('/rest/v1/rpc/financial_summary', {
        method: 'POST',
        body: {}
      });
    }
    if (action === 'resumoOpenFinance') {
      return this.#request('/rest/v1/rpc/open_finance_summary', {
        method: 'POST',
        body: {}
      });
    }
    if (action === 'notificacoes') {
      const limit = Math.min(Number(params.limit) || 50, 100);
      const notifications = await this.#table('notifications', {
        query: `select=id,type,title,body,severity,data,read_at,created_at&order=created_at.desc&limit=${limit}`
      });
      return { ok: true, notifications };
    }
    if (action === 'preferenciasNotificacao') {
      const rows = await this.#table('notification_preferences', {
        query: 'select=in_app_enabled,push_enabled,daily_tip_enabled,low_balance_enabled,budget_alert_enabled,bill_due_enabled,daily_tip_time,low_balance_threshold,timezone&limit=1'
      });
      return { ok: true, preferences: rows[0] || null };
    }
    if (action === 'perfilOpenFinance') {
      const [profiles, connections] = await Promise.all([
        this.#table('profiles', {
          query: 'select=name,profile_type,document_type,document_last_four,phone,birth_date,state,onboarding_completed_at,open_finance_beta_accepted_at&limit=1'
        }),
        this.#table('financial_connections', {
          query: 'select=id,provider_item_id,institution_name,status,last_synced_at,error_message,created_at&order=created_at.desc'
        })
      ]);
      return { ok: true, profile: profiles[0] || null, connections };
    }
    if (action === 'perfilUsuario') {
      const rows = await this.#table('profiles', {
        query: 'select=name,phone&limit=1'
      });
      return { ok: true, profile: rows[0] || null };
    }
    if (action === 'lista') {
      const items = await this.#table('shopping_list_items', {
        query: 'select=id,name,expected_price,checked,times_used,categories(name)&order=position.asc,created_at.asc'
      });
      return {
        ok: true,
        items: items.map(i => ({
          id: i.id, name: i.name, category: i.categories?.name || 'Outros',
          price: Number(i.expected_price), checked: i.checked, timesUsed: i.times_used
        }))
      };
    }
    if (action === 'investimentos') {
      const investimentos = await this.#table('investments', {
        query: 'select=id,name,type,current_value,annual_rate,updated_at&order=updated_at.desc'
      });
      return {
        ok: true,
        investimentos: investimentos.map(i => ({
          id: i.id, nome: i.name, tipo: i.type, valor: Number(i.current_value),
          taxa: Number(i.annual_rate || 0), atualizadoEm: i.updated_at
        }))
      };
    }
    if (action === 'metas') {
      const metas = await this.#table('financial_goals', {
        query: 'select=id,name,target_amount,current_amount,monthly_contribution,target_date&active=eq.true&order=created_at'
      });
      return {
        ok: true,
        metas: metas.map(goal => ({
          id: goal.id,
          nome: goal.name,
          objetivo: Number(goal.target_amount),
          atual: Number(goal.current_amount),
          mensal: Number(goal.monthly_contribution),
          data: goal.target_date
        }))
      };
    }
    throw new Error(`Ação desconhecida: ${action}`);
  }

  async post(action, payload = {}) {
    this.#assertAuthenticated();
    if (action === 'compra') return this.#savePurchase(payload);
    if (action === 'atualizarCompra') return this.#updatePurchase(payload);
    if (action === 'excluirCompra') return this.#deletePurchase(payload.purchaseId);
    if (action === 'salvarConfig') return this.#saveConfig(payload);
    if (action === 'proventos') return this.#replaceSimple('income_sources', payload.itens);
    if (action === 'custosFixos') return this.#replaceSimple('recurring_expenses', payload.itens);
    if (action === 'investimentos') return this.#replaceInvestments(payload.itens);
    if (action === 'metas') return this.#replaceGoals(payload.itens);
    if (action === 'salvarLista') return this.#replaceShoppingList(payload.items);
    if (action === 'gemini') {
      return this.#request('/functions/v1/gemini', { method: 'POST', body: payload });
    }
    if (action === 'gerarNotificacoes') {
      return this.#request('/rest/v1/rpc/generate_financial_notifications', {
        method: 'POST',
        body: {}
      });
    }
    if (action === 'salvarPreferenciasNotificacao') {
      const body = {
        user_id: this.session.user.id,
        in_app_enabled: payload.inAppEnabled !== false,
        push_enabled: Boolean(payload.pushEnabled),
        daily_tip_enabled: payload.dailyTipEnabled !== false,
        low_balance_enabled: payload.lowBalanceEnabled !== false,
        budget_alert_enabled: payload.budgetAlertEnabled !== false,
        bill_due_enabled: payload.billDueEnabled !== false,
        daily_tip_time: payload.dailyTipTime || '08:00',
        low_balance_threshold: Math.max(Number(payload.lowBalanceThreshold) || 0, 0),
        timezone: 'America/Sao_Paulo'
      };
      await this.#table('notification_preferences', {
        method: 'POST',
        query: 'on_conflict=user_id',
        prefer: 'resolution=merge-duplicates,return=representation',
        body
      });
      return { ok: true };
    }
    if (action === 'salvarPerfilOpenFinance') {
      const profile = await this.#request('/rest/v1/rpc/save_open_finance_profile', {
        method: 'POST',
        body: {
          p_name: payload.name,
          p_profile_type: payload.profileType,
          p_document: payload.document,
          p_phone: payload.phone,
          p_birth_date: payload.birthDate || null,
          p_state: payload.state,
          p_accept_terms: Boolean(payload.acceptTerms),
          p_accept_privacy: Boolean(payload.acceptPrivacy),
          p_accept_open_finance_beta: Boolean(payload.acceptOpenFinanceBeta)
        }
      });
      await this.#table('open_finance_consents', {
        method: 'POST',
        query: 'on_conflict=user_id,provider,consent_type,terms_version,privacy_version',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: {
          user_id: this.session.user.id,
          provider: 'pluggy',
          consent_type: 'data_sharing',
          status: 'granted',
          granted_at: new Date().toISOString(),
          terms_version: '2026-07-30',
          privacy_version: '2026-07-30',
          metadata: { source: 'dimdim-onboarding' }
        }
      });
      return { ok: true, profile };
    }
    if (action === 'criarTokenPluggy') {
      return this.#request('/functions/v1/pluggy-connect-token', { method: 'POST', body: {} });
    }
    if (action === 'registrarItemPluggy') {
      return this.#request('/functions/v1/pluggy-register-item', {
        method: 'POST',
        body: { itemId: payload.itemId }
      });
    }
    if (action === 'revogarItemPluggy') {
      return this.#request('/functions/v1/pluggy-revoke-item', {
        method: 'POST',
        body: { itemId: payload.itemId }
      });
    }
    if (action === 'salvarPush') {
      const subscription = payload.subscription || {};
      const keys = subscription.keys || {};
      if (!subscription.endpoint || !keys.p256dh || !keys.auth) {
        throw new Error('Inscrição de push inválida.');
      }
      await this.#table('push_subscriptions', {
        method: 'POST',
        query: 'on_conflict=user_id,endpoint',
        prefer: 'resolution=merge-duplicates,return=representation',
        body: {
          user_id: this.session.user.id,
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: navigator.userAgent.slice(0, 500),
          active: true,
          last_error: null
        }
      });
      return { ok: true };
    }
    if (action === 'removerPush') {
      await this.#table('push_subscriptions', {
        method: 'PATCH',
        query: `endpoint=eq.${encodeURIComponent(payload.endpoint)}`,
        body: { active: false }
      });
      return { ok: true };
    }
    if (action === 'lerNotificacao') {
      await this.#table('notifications', {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(payload.id)}`,
        body: { read_at: new Date().toISOString() }
      });
      return { ok: true };
    }
    if (action === 'lerTodasNotificacoes') {
      await this.#table('notifications', {
        method: 'PATCH',
        query: 'read_at=is.null',
        body: { read_at: new Date().toISOString() }
      });
      return { ok: true };
    }
    throw new Error(`Ação desconhecida: ${action}`);
  }

  async #getConfig() {
    const [categories, budgets, costs, incomes, investments] = await Promise.all([
      this.#table('categories', { query: 'select=id,name,group_name&order=name' }),
      this.#table('budgets', { query: 'select=category_id,amount&period=eq.monthly' }),
      this.#table('recurring_expenses', { query: 'select=id,name,amount&active=eq.true&order=name' }),
      this.#table('income_sources', { query: 'select=id,name,amount&active=eq.true&order=name' }),
      this.#table('investments', { query: 'select=id,name,type,current_value,annual_rate,updated_at&order=name' })
    ]);
    const budgetByCategory = new Map(budgets.map(b => [b.category_id, Number(b.amount)]));
    return {
      ok: true,
      categorias: categories.map(c => ({
        id: c.id, categoria: c.name, grupo: c.group_name,
        orcamento: budgetByCategory.get(c.id) || 0
      })),
      custosFixos: costs.map(i => ({ id: i.id, n: i.name, v: Number(i.amount) })),
      proventos: incomes.map(i => ({ id: i.id, n: i.name, v: Number(i.amount) })),
      investimentos: investments.map(i => ({
        id: i.id, nome: i.name, tipo: i.type, valor: Number(i.current_value),
        taxa: Number(i.annual_rate || 0), atualizadoEm: i.updated_at
      }))
    };
  }

  async #getHistory(limit = 100) {
    const rows = await this.#table('transactions', {
      query: `select=id,occurred_at,payment_method,total,latitude,longitude,transaction_items(id,name,quantity,unit_price,subtotal,in_shopping_list,categories(name))&type=eq.expense&order=occurred_at.desc&limit=${Math.min(Number(limit) || 100, 500)}`
    });
    return {
      ok: true,
      compras: rows.map(row => {
        const local = saoPauloParts(row.occurred_at);
        return {
          purchaseId: row.id,
          date: local.date,
          time: local.time,
          paymentMethod: row.payment_method || '',
          total: Number(row.total),
          items: (row.transaction_items || []).map(item => ({
            id: item.id,
            name: item.name,
            category: item.categories?.name || 'Outros',
            qty: Number(item.quantity),
            price: Number(item.unit_price),
            subtotal: Number(item.subtotal),
            inList: item.in_shopping_list
          }))
        };
      })
    };
  }

  async #getDashboard(period = 'mes') {
    const now = new Date();
    let start;
    if (period === 'dia') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (period === 'ano') start = new Date(now.getFullYear(), 0, 1);
    else start = new Date(now.getFullYear(), now.getMonth(), 1);
    const [transactions, config] = await Promise.all([
      this.#table('transactions', {
        query: `select=type,total,transaction_items(subtotal,categories(name,group_name))&occurred_at=gte.${encodeURIComponent(start.toISOString())}`
      }),
      this.#getConfig()
    ]);
    const recurringIncome = period === 'dia' ? 0 : config.proventos.reduce((sum, i) => sum + i.v, 0) * (period === 'ano' ? 12 : 1);
    const recordedIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.total), 0);
    const receita = recordedIncome || recurringIncome;
    const expenses = transactions.filter(t => t.type === 'expense');
    const gastoTotal = expenses.reduce((s, t) => s + Number(t.total), 0);
    const groups = new Map();
    config.categorias.forEach(c => {
      const current = groups.get(c.grupo) || { grupo: c.grupo, gasto: 0, meta: 0 };
      current.meta += Number(c.orcamento) * (period === 'ano' ? 12 : period === 'dia' ? 0 : 1);
      groups.set(c.grupo, current);
    });
    expenses.forEach(t => (t.transaction_items || []).forEach(i => {
      const groupName = i.categories?.group_name || 'Necessidade';
      const current = groups.get(groupName) || { grupo: groupName, gasto: 0, meta: 0 };
      current.gasto += Number(i.subtotal);
      groups.set(groupName, current);
    }));
    const grupos = [...groups.values()];
    const alertas = grupos.filter(g => g.meta > 0 && g.gasto > g.meta).map(g => ({ categoria: g.grupo }));
    return { ok: true, receita, gastoTotal, saldoLivre: receita - gastoTotal, grupos, alertas };
  }

  async #savePurchase(payload) {
    const total = payload.items.reduce((sum, i) => sum + Number(i.qty || 1) * Number(i.price || 0), 0);
    const occurredAt = new Date(`${payload.date}T${payload.time || '12:00:00'}-03:00`).toISOString();
    const transactionId = await this.#request('/rest/v1/rpc/save_purchase', {
      method: 'POST',
      body: {
        p_purchase_id: payload.purchaseId,
        p_occurred_at: occurredAt,
        p_payment_method: payload.paymentMethod,
        p_total: total,
        p_latitude: payload.location?.lat ?? null,
        p_longitude: payload.location?.lng ?? null,
        p_items: payload.items
      }
    });
    const painel = await this.#getDashboard('mes');
    return { ok: true, purchaseId: transactionId, alertas: painel.alertas };
  }

  async #updatePurchase(payload) {
    return this.#savePurchase({ ...payload, purchaseId: payload.purchaseId });
  }

  async #deletePurchase(id) {
    const deleted = await this.#request('/rest/v1/rpc/delete_purchase', {
      method: 'POST',
      body: { p_purchase_id: id }
    });
    if (!deleted) throw new Error('Compra não encontrada.');
    return { ok: true };
  }

  async #saveConfig(payload) {
    await this.#replaceCategories(payload.categorias || []);
    await this.#replaceSimple('recurring_expenses', payload.custosFixos || []);
    await this.#replaceSimple('income_sources', payload.proventos || []);
    return { ok: true };
  }

  async #replaceCategories(items) {
    await this.#table('categories', { method: 'DELETE', query: 'id=not.is.null' });
    if (!items.length) return;
    const categories = await this.#table('categories', {
      method: 'POST',
      prefer: 'return=representation',
      body: items.map(i => ({
        user_id: this.session.user.id,
        name: i.n,
        group_name: i.g || 'Necessidade'
      }))
    });
    const budgets = categories.map((category, index) => ({
      user_id: this.session.user.id,
      category_id: category.id,
      period: 'monthly',
      amount: Number(items[index].v || 0)
    }));
    if (budgets.length) await this.#table('budgets', { method: 'POST', body: budgets });
  }

  async #replaceSimple(table, items = []) {
    await this.#table(table, { method: 'DELETE', query: 'id=not.is.null' });
    if (items.length) {
      await this.#table(table, {
        method: 'POST',
        body: items.map(i => ({
          user_id: this.session.user.id,
          name: i.n,
          amount: Number(i.v || 0),
          active: true
        }))
      });
    }
    return { ok: true };
  }

  async #replaceInvestments(items = []) {
    await this.#table('investments', { method: 'DELETE', query: 'id=not.is.null' });
    if (items.length) {
      await this.#table('investments', {
        method: 'POST',
        body: items.map(i => ({
          user_id: this.session.user.id,
          name: i.nome,
          type: i.tipo || 'Outro',
          current_value: Number(i.valor || 0),
          annual_rate: Number(i.taxa || 0)
        }))
      });
    }
    return { ok: true };
  }

  async #replaceGoals(items = []) {
    await this.#table('financial_goals', { method: 'DELETE', query: 'id=not.is.null' });
    if (items.length) {
      await this.#table('financial_goals', {
        method: 'POST',
        body: items.map(item => ({
          user_id: this.session.user.id,
          name: item.nome,
          target_amount: Math.max(Number(item.objetivo) || 0, 0.01),
          current_amount: Math.max(Number(item.atual) || 0, 0),
          monthly_contribution: Math.max(Number(item.mensal) || 0, 0),
          target_date: item.data || null,
          active: true
        }))
      });
    }
    return { ok: true };
  }

  async #replaceShoppingList(items = []) {
    const categories = await this.#table('categories', { query: 'select=id,name' });
    const byName = new Map(categories.map(c => [c.name.toLocaleLowerCase('pt-BR'), c.id]));
    await this.#table('shopping_list_items', { method: 'DELETE', query: 'id=not.is.null' });
    if (items.length) {
      await this.#table('shopping_list_items', {
        method: 'POST',
        body: items.map((i, position) => ({
          id: /^[0-9a-f-]{36}$/i.test(String(i.id)) ? i.id : undefined,
          user_id: this.session.user.id,
          category_id: byName.get(String(i.category || 'Outros').toLocaleLowerCase('pt-BR')) || null,
          name: i.name,
          expected_price: Number(i.price || 0),
          checked: Boolean(i.checked),
          times_used: Number(i.timesUsed || 0),
          position
        }))
      });
    }
    return { ok: true };
  }

  async #table(table, options = {}) {
    const suffix = options.query ? `?${options.query}` : '';
    return this.#request(`/rest/v1/${table}${suffix}`, options);
  }

  async #request(path, { method = 'GET', body, auth = true, prefer = '' } = {}) {
    this.#assertConfigured();
    if (auth) await this.#refreshIfNeeded();
    const headers = {
      apikey: this.anonKey,
      'Content-Type': 'application/json'
    };
    if (auth && this.session?.access_token) headers.Authorization = `Bearer ${this.session.access_token}`;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${this.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store'
    });
    if (response.status === 204) return { ok: true };
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiErrorMessage(data, response.status));
    return data;
  }

  async #refreshIfNeeded() {
    if (!this.session?.refresh_token) return;
    const expiresAt = Number(this.session.expires_at || 0) * 1000;
    if (expiresAt && expiresAt - Date.now() > 60_000) return;
    const data = await this.#request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: this.session.refresh_token },
      auth: false
    });
    this.#saveSession(data);
  }

  #loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  }

  #saveSession(session) {
    this.session = session;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  #assertConfigured() {
    if (!this.isConfigured()) throw new Error('Configure a URL e a chave pública do projeto Supabase.');
  }

  #assertAuthenticated() {
    this.#assertConfigured();
    if (!this.isAuthenticated()) throw new Error('Entre na sua conta para acessar os dados.');
  }
}
