/**
 * DIMDIM — Backend Google Apps Script
 * Execute configurarPlanilhaInicial() uma vez e copie o token exibido no log.
 * Implante como Web App: executar como você; acesso "Qualquer pessoa".
 */

const SHEETS = {
  compras: 'Compras',
  categorias: 'Categorias_Config',
  custos: 'Custos_Fixos_App',
  proventos: 'Proventos_App',
  investimentos: 'Investimentos_App'
};
const TOKEN_PROPERTY = 'DIMDIM_API_TOKEN';
const TIME_ZONE = 'America/Sao_Paulo';

function _ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function _sheet(name) {
  const sheet = _ss().getSheetByName(name);
  if (!sheet) throw new Error('Aba não encontrada: ' + name);
  return sheet;
}
function _json(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
function _safeCell(value) {
  const text = String(value == null ? '' : value).trim().slice(0, 300);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
function _number(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max == null ? 1e12 : max, Math.max(min == null ? 0 : min, number));
}
function _dateParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}
function _token() {
  return PropertiesService.getScriptProperties().getProperty(TOKEN_PROPERTY) || '';
}
function _authorize(token) {
  const expected = _token();
  if (!expected || !token || String(token) !== expected) throw new Error('Acesso não autorizado.');
}
function _withLock(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return callback(); } finally { lock.releaseLock(); }
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    _authorize(params.token);
    const action = params.action || 'painel';
    if (action === 'config') return _json({ ok: true, ...getConfig() });
    if (action === 'categorias') return _json({ ok: true, categorias: getCategorias() });
    if (action === 'investimentos') return _json({ ok: true, investimentos: getInvestimentos() });
    if (action === 'historico') return _json({ ok: true, compras: getHistorico(_number(params.limit, 1, 500) || 100) });
    if (action === 'painel') return _json({ ok: true, ...getPainelPeriodo(params.periodo || 'mes') });
    if (action === 'summary') {
      const now = new Date();
      const month = _number(params.mes, 1, 12) || now.getMonth() + 1;
      const year = _number(params.ano, 2000, 2200) || now.getFullYear();
      return _json({ ok: true, ...getResumoMensal(month, year) });
    }
    throw new Error('Ação desconhecida: ' + action);
  } catch (error) {
    return _json({ ok: false, error: String(error.message || error) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Corpo da requisição ausente.');
    if (e.postData.contents.length > 500000) throw new Error('Requisição muito grande.');
    const body = JSON.parse(e.postData.contents);
    _authorize(body.token);
    const action = body.action;
    const result = _withLock(function () {
      if (action === 'compra') return registrarCompra(body);
      if (action === 'atualizarCompra') return atualizarCompra(body);
      if (action === 'excluirCompra') return excluirCompra(body.purchaseId);
      if (action === 'salvarConfig') return salvarConfig(body);
      if (action === 'categorias') return salvarCategorias(body.categorias || []);
      if (action === 'custosFixos') return salvarListaSimples(SHEETS.custos, body.itens || []);
      if (action === 'proventos') return salvarListaSimples(SHEETS.proventos, body.itens || []);
      if (action === 'investimentos') return salvarInvestimentos(body.itens || []);
      if (action === 'atualizarTaxaInvestimento') return atualizarTaxaInvestimento(body.nome, body.novaTaxa);
      throw new Error('Ação desconhecida: ' + action);
    });
    return _json({ ok: true, ...(result || {}) });
  } catch (error) {
    return _json({ ok: false, error: String(error.message || error) });
  }
}

function registrarCompra(payload) {
  const sheet = _sheet(SHEETS.compras);
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 200) : [];
  if (!items.length) throw new Error('A compra não possui itens.');
  const purchaseId = _safeCell(payload.purchaseId || Utilities.getUuid());
  const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  const timeNow = Utilities.formatDate(new Date(), TIME_ZONE, 'HH:mm:ss');
  const date = _dateParts(payload.date) ? payload.date : today;
  const time = /^\d{2}:\d{2}:\d{2}$/.test(payload.time || '') ? payload.time : timeNow;
  const location = payload.location && Number.isFinite(Number(payload.location.lat))
    ? `${_number(payload.location.lat, -90, 90).toFixed(5)}, ${_number(payload.location.lng, -180, 180).toFixed(5)}`
    : 'Não informado';
  const payment = _safeCell(payload.paymentMethod || 'Não informado');
  const groupByCategory = {};
  getCategorias().forEach(c => groupByCategory[c.categoria] = c.grupo);
  const rows = items.map(item => {
    const qty = _number(item.qty, 0.01, 10000) || 1;
    const price = _number(item.price, 0, 1e9);
    const category = _safeCell(item.category || 'Outros');
    return [
      date, time, location, purchaseId, _safeCell(item.name || '(sem nome)'), category,
      qty, price, qty * price, payment, item.inList !== false,
      groupByCategory[category] || 'Necessidade'
    ];
  });
  const firstRow = sheet.getLastRow() + 1;
  sheet.getRange(firstRow, 1, rows.length, 12).setValues(rows);
  rows.forEach((row, index) => {
    if (!row[10]) sheet.getRange(firstRow + index, 1, 1, 12).setFontColor('#D6483B');
  });
  const parts = _dateParts(date);
  return { purchaseId, ...getResumoMensal(parts.month, parts.year) };
}

function excluirCompra(purchaseId) {
  const id = String(purchaseId || '');
  if (!id) throw new Error('ID da compra ausente.');
  const sheet = _sheet(SHEETS.compras);
  const values = sheet.getDataRange().getValues();
  const keep = values.slice(1).filter(row => String(row[3]) !== id);
  if (keep.length === values.length - 1) throw new Error('Compra não encontrada.');
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).clearContent().setFontColor(null);
  if (keep.length) {
    sheet.getRange(2, 1, keep.length, 12).setValues(keep);
    keep.forEach((row, index) => {
      if (row[10] === false) sheet.getRange(index + 2, 1, 1, 12).setFontColor('#D6483B');
    });
  }
  return {};
}

function atualizarCompra(payload) {
  if (!Array.isArray(payload.items) || !payload.items.length) throw new Error('A compra não possui itens.');
  const sheet = _sheet(SHEETS.compras);
  const backup = sheet.getDataRange().getValues();
  try {
    excluirCompra(payload.purchaseId);
    return registrarCompra(payload);
  } catch (error) {
    sheet.clearContents();
    if (backup.length) sheet.getRange(1, 1, backup.length, backup[0].length).setValues(backup);
    throw error;
  }
}

function getHistorico(limit) {
  const rows = _sheet(SHEETS.compras).getDataRange().getValues().slice(1);
  const grouped = {};
  rows.forEach(row => {
    if (!row[3]) return;
    const id = String(row[3]);
    if (!grouped[id]) {
      const date = row[0] instanceof Date ? Utilities.formatDate(row[0], TIME_ZONE, 'yyyy-MM-dd') : String(row[0]);
      grouped[id] = { purchaseId: id, date, time: String(row[1] || ''), location: String(row[2] || ''), paymentMethod: String(row[9] || ''), total: 0, items: [] };
    }
    const item = { name: String(row[4] || ''), category: String(row[5] || ''), qty: Number(row[6]) || 0, price: Number(row[7]) || 0, subtotal: Number(row[8]) || 0, inList: row[10] !== false };
    grouped[id].items.push(item);
    grouped[id].total += item.subtotal;
  });
  return Object.values(grouped)
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, limit);
}

function getCategorias() {
  return _sheet(SHEETS.categorias).getDataRange().getValues().slice(1)
    .filter(row => row[0])
    .map(row => {
      const group = ['Necessidade', 'Desejo', 'Investimento'].includes(row[2]) ? row[2] : 'Necessidade';
      return { categoria: String(row[0]), orcamento: Number(row[1]) || 0, grupo: group };
    });
}
function getSimpleList(sheetName) {
  return _sheet(sheetName).getDataRange().getValues().slice(1)
    .filter(row => row[0])
    .map(row => ({ n: String(row[0]), v: Number(row[1]) || 0 }));
}
function getInvestimentos() {
  return _sheet(SHEETS.investimentos).getDataRange().getValues().slice(1)
    .filter(row => row[0])
    .map(row => ({ nome: String(row[0]), tipo: String(row[1] || ''), valor: Number(row[2]) || 0, taxa: Number(row[3]) || 0, atualizadoEm: String(row[4] || '') }));
}
function getConfig() {
  return { categorias: getCategorias(), custosFixos: getSimpleList(SHEETS.custos), proventos: getSimpleList(SHEETS.proventos), investimentos: getInvestimentos() };
}

function _replaceRows(sheetName, header, rows) {
  const sheet = _sheet(sheetName);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  sheet.setFrozenRows(1);
}
function salvarCategorias(items) {
  const rows = (items || []).slice(0, 200).filter(item => item.n)
    .map(item => [_safeCell(item.n), _number(item.v, 0, 1e12), ['Necessidade', 'Desejo', 'Investimento'].includes(item.g) ? item.g : 'Necessidade']);
  _replaceRows(SHEETS.categorias, ['Categoria', 'Orçamento Mensal (R$)', 'Grupo (50-30-20)'], rows);
}
function salvarListaSimples(sheetName, items) {
  const rows = (items || []).slice(0, 500).filter(item => item.n).map(item => [_safeCell(item.n), _number(item.v, 0, 1e12)]);
  _replaceRows(sheetName, ['Nome', 'Valor Mensal (R$)'], rows);
}
function salvarInvestimentos(items) {
  const today = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  const rows = (items || []).slice(0, 500).filter(item => item.nome)
    .map(item => [_safeCell(item.nome), _safeCell(item.tipo), _number(item.valor, 0, 1e12), _number(item.taxa, -100, 1e6), item.atualizadoEm || today]);
  _replaceRows(SHEETS.investimentos, ['Nome', 'Tipo', 'Valor Investido (R$)', 'Taxa Atual (% a.a.)', 'Última Atualização'], rows);
}
function salvarConfig(body) {
  salvarCategorias(body.categorias || []);
  salvarListaSimples(SHEETS.custos, body.custosFixos || []);
  salvarListaSimples(SHEETS.proventos, body.proventos || []);
  return {};
}
function atualizarTaxaInvestimento(name, rate) {
  const sheet = _sheet(SHEETS.investimentos);
  const values = sheet.getDataRange().getValues();
  for (let index = 1; index < values.length; index++) {
    if (String(values[index][0]) === String(name)) {
      sheet.getRange(index + 1, 4, 1, 2).setValues([[_number(rate, -100, 1e6), Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd')]]);
      return {};
    }
  }
  throw new Error('Investimento não encontrado.');
}
function somaListaSimples(sheetName) {
  return getSimpleList(sheetName).reduce((sum, item) => sum + item.v, 0);
}

function getResumoMensal(month, year) {
  const categories = getCategorias();
  const spent = {};
  categories.forEach(category => spent[category.categoria] = 0);
  _sheet(SHEETS.compras).getDataRange().getValues().slice(1).forEach(row => {
    const parts = row[0] instanceof Date
      ? _dateParts(Utilities.formatDate(row[0], TIME_ZONE, 'yyyy-MM-dd'))
      : _dateParts(row[0]);
    if (!parts || parts.month !== Number(month) || parts.year !== Number(year)) return;
    const category = row[5] || 'Outros';
    spent[category] = (spent[category] || 0) + (Number(row[8]) || 0);
  });
  const summary = categories.map(category => {
    const value = spent[category.categoria] || 0;
    return { categoria: category.categoria, orcamento: category.orcamento, gasto: Math.round(value * 100) / 100, excedido: category.orcamento > 0 && value > category.orcamento };
  });
  return { categorias: summary, alertas: summary.filter(item => item.excedido) };
}

function getPainelPeriodo(period) {
  if (!['dia', 'mes', 'ano'].includes(period)) period = 'mes';
  const now = new Date();
  const today = Utilities.formatDate(now, TIME_ZONE, 'yyyy-MM-dd');
  const todayParts = _dateParts(today);
  const monthlyIncome = somaListaSimples(SHEETS.proventos);
  const monthlyFixed = somaListaSimples(SHEETS.custos);
  const factor = period === 'dia' ? 1 / 30 : (period === 'ano' ? 12 : 1);
  const income = monthlyIncome * factor;
  const fixed = monthlyFixed * factor;
  const spentByCategory = {};
  _sheet(SHEETS.compras).getDataRange().getValues().slice(1).forEach(row => {
    const value = row[0] instanceof Date ? Utilities.formatDate(row[0], TIME_ZONE, 'yyyy-MM-dd') : String(row[0]);
    const parts = _dateParts(value);
    if (!parts) return;
    const inside = period === 'dia' ? value === today : period === 'ano' ? parts.year === todayParts.year : parts.year === todayParts.year && parts.month === todayParts.month;
    if (inside) spentByCategory[row[5] || 'Outros'] = (spentByCategory[row[5] || 'Outros'] || 0) + (Number(row[8]) || 0);
  });
  const groups = { Necessidade: fixed, Desejo: 0, Investimento: 0 };
  getCategorias().forEach(category => groups[category.grupo || 'Necessidade'] += spentByCategory[category.categoria] || 0);
  const rates = { Necessidade: 0.5, Desejo: 0.3, Investimento: 0.2 };
  const groupList = Object.keys(groups).map(group => ({ grupo: group, gasto: Math.round(groups[group] * 100) / 100, meta: Math.round(income * rates[group] * 100) / 100 }));
  const total = groupList.reduce((sum, group) => sum + group.gasto, 0);
  return {
    periodo: period, receita: Math.round(income * 100) / 100, gastoTotal: Math.round(total * 100) / 100,
    custosFixos: Math.round(fixed * 100) / 100, saldoLivre: Math.round((income - total) * 100) / 100,
    grupos: groupList, alertas: getResumoMensal(todayParts.month, todayParts.year).alertas
  };
}

function configurarPlanilhaInicial() {
  const ss = _ss();
  const definitions = [
    [SHEETS.compras, ['Data', 'Hora', 'Localização', 'ID Compra', 'Item', 'Categoria', 'Qtd', 'Preço Unit.', 'Subtotal', 'Forma Pagamento', 'Na Lista', 'Grupo (50-30-20)']],
    [SHEETS.categorias, ['Categoria', 'Orçamento Mensal (R$)', 'Grupo (50-30-20)']],
    [SHEETS.custos, ['Nome', 'Valor Mensal (R$)']],
    [SHEETS.proventos, ['Nome', 'Valor Mensal (R$)']],
    [SHEETS.investimentos, ['Nome', 'Tipo', 'Valor Investido (R$)', 'Taxa Atual (% a.a.)', 'Última Atualização']]
  ];
  definitions.forEach(definition => {
    if (!ss.getSheetByName(definition[0])) {
      const sheet = ss.insertSheet(definition[0]);
      sheet.appendRow(definition[1]);
      sheet.setFrozenRows(1);
    }
  });
  if (!_token()) PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY, Utilities.getUuid() + Utilities.getUuid());
  Logger.log('TOKEN DIMDIM: ' + _token());
  return _token();
}

function mostrarTokenAcesso() {
  if (!_token()) throw new Error('Execute configurarPlanilhaInicial primeiro.');
  Logger.log('TOKEN DIMDIM: ' + _token());
  return _token();
}
