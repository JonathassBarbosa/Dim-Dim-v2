export class DimDimApi {
  constructor(url = '', token = '') {
    this.configure(url, token);
  }

  configure(url, token) {
    this.url = String(url || '').trim();
    this.token = String(token || '').trim();
  }

  isConfigured() {
    return /^https:\/\/script\.google\.com\/.+\/exec(?:\?.*)?$/i.test(this.url) && this.token.length >= 16;
  }

  async get(action, params = {}) {
    this.#assertConfigured();
    const url = new URL(this.url);
    url.searchParams.set('action', action);
    url.searchParams.set('token', this.token);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
    return this.#parse(await fetch(url.toString(), { cache: 'no-store' }));
  }

  async post(action, payload = {}) {
    this.#assertConfigured();
    return this.#parse(await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, action, token: this.token })
    }));
  }

  #assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error('Conecte uma URL válida do Apps Script e o token de acesso.');
    }
  }

  async #parse(response) {
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Resposta inválida do servidor (HTTP ${response.status}).`);
    }
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `Falha no servidor (HTTP ${response.status}).`);
    }
    return data;
  }
}
