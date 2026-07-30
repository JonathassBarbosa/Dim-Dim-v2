import { escapeHTML } from './dom.js';

export function createOpenFinance({ api, toast }) {
  const overlay = document.getElementById('openFinanceOverlay');
  const status = document.getElementById('openFinanceStatus');
  const connections = document.getElementById('openFinanceConnections');
  let profile = null;

  function setStatus(message, error = false) {
    status.textContent = message || '';
    status.classList.toggle('error', error);
  }

  function renderConnections(items = []) {
    if (!items.length) {
      connections.innerHTML = '<div class="empty">Nenhuma instituição conectada.</div>';
      return;
    }
    connections.innerHTML = items.map(item => `
      <div class="open-finance-connection">
        <div><strong>${escapeHTML(item.institution_name || 'Instituição financeira')}</strong>
        <small>${escapeHTML(item.status === 'active' ? 'Sincronizada' : item.status)}</small></div>
        <div class="connection-actions">
          <span class="connection-dot ${escapeHTML(item.status)}"></span>
          ${!['revoked', 'deleted'].includes(item.status)
            ? `<button class="revoke-connection" type="button" data-item="${escapeHTML(item.provider_item_id)}">Revogar</button>`
            : ''}
        </div>
      </div>
    `).join('');
    connections.querySelectorAll('.revoke-connection').forEach(button => {
      button.addEventListener('click', async () => {
        if (!confirm('Revogar o consentimento e desconectar esta instituição?')) return;
        button.disabled = true;
        setStatus('Revogando consentimento...');
        try {
          await api.post('revogarItemPluggy', { itemId: button.dataset.item });
          await load();
          setStatus('Consentimento revogado e conexão removida.');
        } catch (error) {
          setStatus(error.message, true);
          button.disabled = false;
        }
      });
    });
  }

  async function load() {
    const data = await api.get('perfilOpenFinance');
    profile = data.profile;
    document.getElementById('ofName').value = profile?.name || '';
    document.getElementById('ofProfileType').value = profile?.profile_type || 'personal';
    document.getElementById('ofPhone').value = profile?.phone || '';
    document.getElementById('ofBirthDate').value = profile?.birth_date || '';
    document.getElementById('ofState').value = profile?.state || '';
    const documentInput = document.getElementById('ofDocument');
    documentInput.value = '';
    documentInput.placeholder = profile?.document_last_four
      ? `Documento protegido •••${profile.document_last_four}`
      : 'CPF ou CNPJ';
    renderConnections(data.connections);
    return data;
  }

  async function open() {
    if (!api.isAuthenticated()) {
      toast('Entre na sua conta primeiro.');
      return;
    }
    overlay.classList.add('open');
    setStatus('Carregando seus dados...');
    try {
      await load();
      setStatus(profile?.onboarding_completed_at
        ? 'Seus dados cadastrais estão protegidos.'
        : 'Complete o cadastro antes de conectar uma instituição.');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function close() {
    overlay.classList.remove('open');
  }

  async function saveProfile() {
    const documentValue = document.getElementById('ofDocument').value.trim();
    if (!documentValue && !profile?.document_last_four) {
      throw new Error('Informe seu CPF ou CNPJ.');
    }
    if (!documentValue && profile?.document_last_four) return;
    await api.post('salvarPerfilOpenFinance', {
      name: document.getElementById('ofName').value.trim(),
      profileType: document.getElementById('ofProfileType').value,
      document: documentValue,
      phone: document.getElementById('ofPhone').value.trim(),
      birthDate: document.getElementById('ofBirthDate').value || null,
      state: document.getElementById('ofState').value.trim(),
      acceptTerms: document.getElementById('ofAcceptTerms').checked,
      acceptPrivacy: document.getElementById('ofAcceptPrivacy').checked,
      acceptOpenFinanceBeta: document.getElementById('ofAcceptBeta').checked
    });
    await load();
  }

  async function connect() {
    const button = document.getElementById('btnConnectPluggy');
    button.disabled = true;
    setStatus('Preparando conexão segura...');
    try {
      await saveProfile();
      const data = await api.post('criarTokenPluggy');
      if (!globalThis.PluggyConnect) throw new Error('O conector bancário não foi carregado.');
      const widget = new globalThis.PluggyConnect({
        connectToken: data.connectToken,
        includeSandbox: Boolean(data.includeSandbox),
        onSuccess: async ({ item }) => {
          setStatus('Instituição conectada. Salvando referência...');
          await api.post('registrarItemPluggy', { itemId: item.id });
          await load();
          setStatus('Conexão concluída. A primeira sincronização pode levar alguns minutos.');
          toast('Instituição conectada!');
        },
        onError: error => {
          setStatus(error?.message || 'Não foi possível concluir a conexão.', true);
        }
      });
      widget.init();
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  document.getElementById('btnOpenFinance').addEventListener('click', () => {
    document.getElementById('maisOverlay').classList.remove('open');
    open();
  });
  document.getElementById('btnCloseOpenFinance').addEventListener('click', close);
  document.getElementById('btnSaveOpenFinanceProfile').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    setStatus('Salvando cadastro...');
    try {
      await saveProfile();
      setStatus('Cadastro e consentimentos salvos.');
      toast('Cadastro atualizado.');
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      event.currentTarget.disabled = false;
    }
  });
  document.getElementById('btnConnectPluggy').addEventListener('click', connect);

  return { open, close, load };
}
