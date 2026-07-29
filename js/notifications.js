const DEFAULT_PREFERENCES = {
  in_app_enabled: true,
  push_enabled: false,
  daily_tip_enabled: true,
  low_balance_enabled: true,
  budget_alert_enabled: true,
  bill_due_enabled: true,
  daily_tip_time: '08:00',
  low_balance_threshold: 100
};

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

function notificationIcon(type) {
  return {
    daily_tip: '💡',
    low_balance: '⚠️',
    budget: '📊',
    bill_due: '📅',
    system: '🔔'
  }[type] || '🔔';
}

function dateLabel(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function createNotificationCenter({ api, money, toast, vapidPublicKey }) {
  const elements = {
    overlay: document.getElementById('notificationsOverlay'),
    badge: document.getElementById('notificationBadge'),
    list: document.getElementById('notificationList'),
    available: document.getElementById('notificationAvailable'),
    safeDaily: document.getElementById('notificationSafeDaily'),
    status: document.getElementById('notificationStatus'),
    pushSupport: document.getElementById('pushSupportText'),
    push: document.getElementById('pushEnabled'),
    dailyTip: document.getElementById('dailyTipEnabled'),
    lowBalance: document.getElementById('lowBalanceEnabled'),
    budgetAlert: document.getElementById('budgetAlertEnabled'),
    billDue: document.getElementById('billDueEnabled'),
    dailyTime: document.getElementById('dailyTipTime'),
    threshold: document.getElementById('lowBalanceThreshold')
  };
  let preferences = { ...DEFAULT_PREFERENCES };
  let initialized = false;
  let saving = false;

  function setStatus(message, error = false) {
    elements.status.textContent = message || '';
    elements.status.style.color = error ? 'var(--red)' : 'var(--soft)';
  }

  function setBadge(count) {
    const unread = Math.max(Number(count) || 0, 0);
    elements.badge.textContent = unread > 99 ? '99+' : String(unread);
    elements.badge.hidden = unread === 0;
  }

  function renderSummary(summary = {}) {
    elements.available.textContent = money(summary.available);
    elements.safeDaily.textContent = money(summary.safeDaily);
  }

  function renderPreferences(value) {
    preferences = { ...DEFAULT_PREFERENCES, ...(value || {}) };
    elements.push.checked = Boolean(preferences.push_enabled);
    elements.dailyTip.checked = Boolean(preferences.daily_tip_enabled);
    elements.lowBalance.checked = Boolean(preferences.low_balance_enabled);
    elements.budgetAlert.checked = Boolean(preferences.budget_alert_enabled);
    elements.billDue.checked = Boolean(preferences.bill_due_enabled);
    elements.dailyTime.value = String(preferences.daily_tip_time || '08:00').slice(0, 5);
    elements.threshold.value = String(Number(preferences.low_balance_threshold) || 0);
  }

  function renderNotifications(items = []) {
    elements.list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhum alerta por enquanto. Continue registrando seus dados.';
      elements.list.appendChild(empty);
      setBadge(0);
      return;
    }

    let unread = 0;
    items.forEach(item => {
      if (!item.read_at) unread += 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `notification-item ${item.read_at ? '' : 'unread'} ${item.severity || 'info'}`.trim();

      const icon = document.createElement('span');
      icon.className = 'notification-item-icon';
      icon.textContent = notificationIcon(item.type);

      const content = document.createElement('span');
      content.className = 'notification-item-content';
      const title = document.createElement('span');
      title.className = 'notification-item-title';
      title.textContent = item.title;
      const body = document.createElement('span');
      body.className = 'notification-item-body';
      body.textContent = item.body;
      const date = document.createElement('span');
      date.className = 'notification-item-date';
      date.textContent = dateLabel(item.created_at);
      content.append(title, body, date);
      button.append(icon, content);

      button.addEventListener('click', async () => {
        if (item.read_at) return;
        try {
          await api.post('lerNotificacao', { id: item.id });
          item.read_at = new Date().toISOString();
          button.classList.remove('unread');
          setBadge(Math.max(unread - 1, 0));
          unread -= 1;
        } catch (error) {
          toast(error.message);
        }
      });
      elements.list.appendChild(button);
    });
    setBadge(unread);
  }

  async function getExistingSubscription() {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) return null;
    return registration.pushManager.getSubscription();
  }

  function pushAvailabilityMessage() {
    if (!globalThis.isSecureContext) return 'O push exige HTTPS.';
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return 'Neste iPhone/iPad, instale o app na Tela de Início para ativar o push.';
    }
    if (!vapidPublicKey) return 'A chave pública Web Push ainda precisa ser ativada no projeto.';
    if (Notification.permission === 'denied') return 'As notificações foram bloqueadas nas configurações do navegador.';
    return 'Receber mesmo com o app fechado';
  }

  async function enablePush() {
    if (!globalThis.isSecureContext) throw new Error('O push só funciona em uma conexão HTTPS.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('Instale o DimDim na Tela de Início para habilitar o push neste aparelho.');
    }
    if (!vapidPublicKey) {
      throw new Error('O Web Push está preparado, mas a chave VAPID pública ainda não foi configurada.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Permissão de notificação não concedida.');

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey)
      });
    }
    await api.post('salvarPush', { subscription: subscription.toJSON() });
  }

  async function disablePush() {
    const subscription = await getExistingSubscription();
    if (!subscription) return;
    await api.post('removerPush', { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
  }

  function formPayload() {
    return {
      inAppEnabled: true,
      pushEnabled: elements.push.checked,
      dailyTipEnabled: elements.dailyTip.checked,
      lowBalanceEnabled: elements.lowBalance.checked,
      budgetAlertEnabled: elements.budgetAlert.checked,
      billDueEnabled: elements.billDue.checked,
      dailyTipTime: elements.dailyTime.value || '08:00',
      lowBalanceThreshold: Math.max(Number(elements.threshold.value) || 0, 0)
    };
  }

  async function savePreferences({ pushChanged = false } = {}) {
    if (saving || !api.isAuthenticated()) return;
    saving = true;
    const previousPush = Boolean(preferences.push_enabled);
    setStatus('Salvando preferências...');
    try {
      if (pushChanged && elements.push.checked && !previousPush) await enablePush();
      if (pushChanged && !elements.push.checked && previousPush) await disablePush();
      await api.post('salvarPreferenciasNotificacao', formPayload());
      preferences = {
        ...preferences,
        push_enabled: elements.push.checked,
        daily_tip_enabled: elements.dailyTip.checked,
        low_balance_enabled: elements.lowBalance.checked,
        budget_alert_enabled: elements.budgetAlert.checked,
        bill_due_enabled: elements.billDue.checked,
        daily_tip_time: elements.dailyTime.value || '08:00',
        low_balance_threshold: Number(elements.threshold.value) || 0
      };
      setStatus(elements.push.checked ? 'Push ativo neste aparelho.' : 'Preferências salvas.');
    } catch (error) {
      elements.push.checked = previousPush;
      setStatus(error.message, true);
      toast(error.message);
    } finally {
      saving = false;
      elements.pushSupport.textContent = pushAvailabilityMessage();
    }
  }

  async function refresh({ generate = true } = {}) {
    if (!api.isAuthenticated()) {
      renderSummary();
      renderNotifications([]);
      setStatus('Entre na sua conta para ver os alertas.');
      return;
    }
    elements.list.innerHTML = '<div class="empty">Atualizando seus alertas...</div>';
    try {
      if (generate) await api.post('gerarNotificacoes');
      const [summary, notificationData, preferenceData] = await Promise.all([
        api.get('resumoFinanceiro'),
        api.get('notificacoes', { limit: 50 }),
        api.get('preferenciasNotificacao')
      ]);
      renderSummary(summary);
      renderNotifications(notificationData.notifications);
      renderPreferences(preferenceData.preferences);
      elements.pushSupport.textContent = pushAvailabilityMessage();
      setStatus('');
    } catch (error) {
      elements.list.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'warn';
      empty.textContent = error.message;
      elements.list.appendChild(empty);
      setStatus('A central será liberada depois que a migração de notificações for aplicada.', true);
    }
  }

  function open() {
    elements.overlay.classList.add('open');
    refresh();
  }

  function close() {
    elements.overlay.classList.remove('open');
  }

  function init() {
    if (initialized) return;
    initialized = true;
    document.getElementById('btnOpenNotifications').addEventListener('click', open);
    document.getElementById('btnCloseNotifications').addEventListener('click', close);
    document.getElementById('btnReadAllNotifications').addEventListener('click', async () => {
      try {
        await api.post('lerTodasNotificacoes');
        await refresh({ generate: false });
      } catch (error) {
        toast(error.message);
      }
    });
    elements.push.addEventListener('change', () => savePreferences({ pushChanged: true }));
    [elements.dailyTip, elements.lowBalance, elements.budgetAlert, elements.billDue]
      .forEach(input => input.addEventListener('change', () => savePreferences()));
    [elements.dailyTime, elements.threshold]
      .forEach(input => input.addEventListener('change', () => savePreferences()));
    elements.push.disabled = !globalThis.isSecureContext
      || !('serviceWorker' in navigator)
      || !('PushManager' in window)
      || !('Notification' in window)
      || !vapidPublicKey;
    elements.pushSupport.textContent = pushAvailabilityMessage();
  }

  return { init, refresh, open, close };
}
