import {
  GROUPS as GRUPOS, STORAGE_KEYS as LS, SUPABASE_URL, SUPABASE_ANON_KEY,
  VAPID_PUBLIC_KEY
} from './config.js';
import { loadJSON, saveJSON } from './storage.js';
import { DimDimApi } from './api.js';
import { escapeHTML, localDateTime } from './dom.js';
import { createNotificationCenter } from './notifications.js';

let BACKEND_URL = SUPABASE_URL || loadJSON(LS.supabaseUrl, '');
let ANON_KEY = SUPABASE_ANON_KEY || loadJSON(LS.supabaseAnonKey, '');
const api = new DimDimApi(BACKEND_URL, ANON_KEY);
let catalog=loadJSON(LS.catalog,[]),lastLocation=null,selectedPayment=null,saldoVisivel=loadJSON(LS.saldoVisivel,true),lastHeroData=null;
let investimentos=[];
let aiMessages=[];
let aiRequestPending=false;
let aiVoiceOn=loadJSON(LS.aiVoice, false);
let cats=[];
let custos=[];
let proventos=[];
function uid(){return globalThis.crypto?.randomUUID?.() || ('i'+Math.random().toString(36).slice(2,10));}
function money(n){return'R$ '+(Number(n)||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}
const notificationCenter=createNotificationCenter({api,money,toast,vapidPublicKey:VAPID_PUBLIC_KEY});
notificationCenter.init();
setTimeout(()=>{document.getElementById('splash').classList.add('fade');},3300);
setTimeout(()=>{document.getElementById('splash').style.display='none';},3900);
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
const MAIS_SCREENS = ['lista','ocr'];
function go(id){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('active'));
  document.getElementById('s-'+id).classList.add('active');
  const tabId = MAIS_SCREENS.includes(id) ? 'mais' : id;
  document.querySelectorAll('.tabbtn[data-go]').forEach(t=>t.classList.toggle('active',t.dataset.go===tabId));
  document.getElementById('btnMais').classList.toggle('active', tabId==='mais');
  if(id==='home')refreshHero();
  if(id==='hist')loadHistory();
  if(id==='painel')loadPainel();
}
function openMais(){document.getElementById('maisOverlay').classList.add('open');}
function closeMais(){document.getElementById('maisOverlay').classList.remove('open');}
document.getElementById('btnMais').addEventListener('click',openMais);
document.getElementById('btnCloseMais').addEventListener('click',closeMais);
document.querySelectorAll('.mais-opt').forEach(b=>b.addEventListener('click',closeMais));
async function openRegistro(){document.getElementById('registroOverlay').classList.add('open');await testConnection();renderRegistro();}
function closeRegistro(){document.getElementById('registroOverlay').classList.remove('open');}
document.getElementById('btnOpenRegistro').addEventListener('click',openRegistro);
document.getElementById('btnCloseRegistro').addEventListener('click',closeRegistro);
function applyHealthTheme(status){
  document.documentElement.classList.remove('health-warn','health-bad');
  if(status==='warn') document.documentElement.classList.add('health-warn');
  if(status==='bad') document.documentElement.classList.add('health-bad');
}
function calcHealth(data){
  if(data.saldoLivre < 0) return 'bad';
  if(data.receita > 0 && (data.saldoLivre/data.receita) < 0.12) return 'warn';
  return 'good';
}
function renderHero(data){
  const val=document.getElementById('heroSaldo');
  val.textContent=saldoVisivel?money(data.saldoLivre):'R$ ••••••';
  const commitments=Number(data.compromissos||0);
  document.getElementById('heroSub').textContent=commitments>0
    ? `Receita ${money(data.receita)} · Gastos ${money(data.gastoTotal)} · Compromissos ${money(commitments)}`
    : `Receita ${money(data.receita)} · Gastos ${money(data.gastoTotal)}`;
  lastHeroData=data;

  const status = calcHealth(data);
  applyHealthTheme(status);
  const icon = document.getElementById('insightIcon');
  const insight=document.getElementById('insightText');

  if(status==='bad'){
    icon.textContent='🚨';
    insight.textContent=`Seu saldo livre está negativo (${money(data.saldoLivre)}). Hora de rever os gastos do mês.`;
    return;
  }
  if(status==='warn'){
    icon.textContent='⚠️';
    insight.textContent=`Seu saldo livre está no limite (${money(data.saldoLivre)}). Fique de olho nos próximos gastos.`;
    return;
  }
  icon.textContent='✅';
  if(data.grupos&&data.grupos.length){
    const pior=data.grupos.reduce((a,b)=>{const ra=a.meta>0?a.gasto/a.meta:0,rb=b.meta>0?b.gasto/b.meta:0;return rb>ra?b:a;});
    const pct=pior.meta>0?Math.round((pior.gasto/pior.meta)*100):0;
    if(pct>=100){icon.textContent='⚠️';insight.textContent=`Atenção: o grupo ${pior.grupo} já passou da meta do mês (${pct}%).`;}
    else if(pct>=70) insight.textContent=`Você já usou ${pct}% da meta de ${pior.grupo} este mês.`;
    else insight.textContent='Suas finanças estão saudáveis este mês.';
  } else{
    insight.textContent='Entre na sua conta para ver seus dados reais.';
  }
}
async function refreshHero(){
  try{
    const summary=await api.get('resumoFinanceiro');
    renderHero({
      receita:Number(summary.income),
      gastoTotal:Number(summary.spent),
      saldoLivre:Number(summary.available),
      compromissos:Number(summary.fixedCommitments)+Number(summary.pendingInstallments)+Number(summary.goalReserve),
      grupos:(summary.groups||[]).map(group=>({
        grupo:group.name,
        gasto:Number(group.spent),
        meta:Number(group.budget)
      }))
    });
  }catch{
    try{renderHero(await api.get('painel',{periodo:'mes'}));}
    catch{renderHero({receita:0,gastoTotal:0,saldoLivre:0,grupos:[]});}
  }
}
document.getElementById('btnToggleSaldo').addEventListener('click',()=>{saldoVisivel=!saldoVisivel;saveJSON(LS.saldoVisivel,saldoVisivel);if(lastHeroData)renderHero(lastHeroData);});
async function syncCatalog(){if(!api.isAuthenticated())return;try{await api.post('salvarLista',{items:catalog});}catch(e){toast(e.message);}}
async function loadCatalog(){if(!api.isAuthenticated())return;try{const data=await api.get('lista');catalog=data.items||[];saveJSON(LS.catalog,catalog);renderCatalog();}catch(e){toast(e.message);}}
document.getElementById('btnAdd').addEventListener('click',()=>{const raw=document.getElementById('paste').value.trim();if(!raw){toast('Cole ou digite algum item primeiro.');return;}raw.split('\n').map(l=>l.trim()).filter(Boolean).forEach(line=>{const separator=line.includes(';')?';':',';const parts=line.split(separator).map(p=>p.trim());const name=parts[0];if(!name)return;const category=parts[1]||'Outros';const priceText=separator===','&&parts.length>3?parts.slice(2).join('.'):parts[2];let price=priceText?parseFloat(priceText.replace(',','.')):0;if(isNaN(price))price=0;const existing=catalog.find(i=>i.name.toLowerCase()===name.toLowerCase());if(existing){existing.checked=true;existing.category=category;if(price)existing.price=price;}else{catalog.push({id:uid(),name,category,price,checked:true,timesUsed:0});}});document.getElementById('paste').value='';saveJSON(LS.catalog,catalog);renderCatalog();syncCatalog();toast('Item adicionado.');});
function renderCatalog(){const box=document.getElementById('catalog');box.innerHTML='';if(catalog.length===0){box.innerHTML='<div class="empty">Sua lista está vazia. Adicione itens acima.</div>';return;}catalog.forEach(item=>{const row=document.createElement('div');row.className='row'+(item.checked?' on':'');row.innerHTML=`<button class="chk" type="button" aria-label="Marcar ${escapeHTML(item.name)}">${item.checked?'✓':''}</button><div class="r-name">${escapeHTML(item.name)}<div class="r-meta">${escapeHTML(item.category)}${item.timesUsed>0?' · comprado '+item.timesUsed+'x':''}</div></div><div class="r-price">${money(item.price)}</div><button class="item-edit" type="button" aria-label="Editar">✎</button><button class="item-delete" type="button" aria-label="Excluir">✕</button>`;row.querySelector('.chk').addEventListener('click',()=>{item.checked=!item.checked;saveJSON(LS.catalog,catalog);renderCatalog();syncCatalog();});row.querySelector('.item-edit').addEventListener('click',()=>editCatalogItem(item));row.querySelector('.item-delete').addEventListener('click',()=>{if(confirm(`Excluir ${item.name}?`)){catalog=catalog.filter(current=>current.id!==item.id);saveJSON(LS.catalog,catalog);renderCatalog();syncCatalog();}});box.appendChild(row);});}
function editCatalogItem(item){const name=prompt('Nome do item:',item.name);if(name===null||!name.trim())return;const category=prompt('Categoria:',item.category);if(category===null)return;const price=prompt('Preço:',String(item.price).replace('.',','));if(price===null)return;item.name=name.trim();item.category=category.trim()||'Outros';item.price=Number(String(price).replace(',','.'))||0;saveJSON(LS.catalog,catalog);renderCatalog();syncCatalog();}
renderCatalog();
document.getElementById('fileInput').addEventListener('change',async(e)=>{const file=e.target.files[0];if(!file)return;const progress=document.getElementById('ocrProgress');const label=document.getElementById('ocrDropLabel');label.textContent='Lendo a nota...';progress.innerHTML='<div class="empty">Isso pode levar alguns segundos.</div>';try{const {data:{text}}=await Tesseract.recognize(file,'por');label.textContent='Fotografar ou enviar outra nota';progress.innerHTML='';processarTextoNota(text);}catch(err){progress.innerHTML='<div class="warn">Não consegui ler essa imagem. Tente uma foto mais nítida.</div>';label.textContent='Fotografe a nota ou escolha um arquivo';}});
function processarTextoNota(text){const linhas=text.split('\n').map(l=>l.trim()).filter(Boolean);const itens=[];const regexPreco=/(\d{1,4}[.,]\d{2})\s*$/;linhas.forEach(linha=>{const m=linha.match(regexPreco);if(!m)return;const preco=parseFloat(m[1].replace(',','.'));let nome=linha.slice(0,m.index).trim();let qtd=1;const qm=nome.match(/^(\d+)\s*[xX]?\s+/);if(qm){qtd=parseInt(qm[1],10);nome=nome.slice(qm[0].length).trim();}nome=nome.replace(/^\d+\s*/,'').trim();if(nome.length<2)return;itens.push({name:nome,qty:qtd,price:preco});});renderOcrResult(itens);}
function renderOcrResult(itens){const box=document.getElementById('ocrResult');if(itens.length===0){box.innerHTML='<div class="warn">Não encontrei itens com valores nessa imagem. Você pode ajustar manualmente ou tentar outra foto.</div>';return;}const selecionados=catalog.filter(c=>c.checked);const naoVieram=selecionados.filter(c=>!itens.some(i=>i.name.toLowerCase().includes(c.name.toLowerCase())||c.name.toLowerCase().includes(i.name.toLowerCase())));let html='<div class="seclabel">Itens reconhecidos — revise antes de confirmar</div>';itens.forEach(it=>{const estavaNaLista=selecionados.some(c=>c.name.toLowerCase().includes(it.name.toLowerCase())||it.name.toLowerCase().includes(c.name.toLowerCase()));it.inList=estavaNaLista;html+=`<div class="row"><div class="r-name${estavaNaLista?'':' off'}">${it.qty}x ${escapeHTML(it.name)}${estavaNaLista?'':' · fora da lista'}</div><div class="r-price">${money(it.qty*it.price)}</div></div>`;});if(naoVieram.length>0){html+=`<div class="warn">Da sua lista, não veio na nota: ${naoVieram.map(f=>escapeHTML(f.name)).join(', ')}</div>`;}html+='<div class="pay-grid" id="ocrPayGrid"><button class="pay-opt" data-p="Pix">Pix</button><button class="pay-opt" data-p="Débito">Débito</button><button class="pay-opt" data-p="Crédito">Crédito</button></div>';html+='<button class="btn" id="btnConfirmOcr" style="margin-top:10px">Confirmar e registrar</button>';box.innerHTML=html;let payOcr=null;box.querySelectorAll('#ocrPayGrid .pay-opt').forEach(o=>o.addEventListener('click',()=>{box.querySelectorAll('#ocrPayGrid .pay-opt').forEach(x=>x.classList.remove('active'));o.classList.add('active');payOcr=o.dataset.p;}));document.getElementById('btnConfirmOcr').addEventListener('click',async()=>{if(!payOcr){toast('Escolha a forma de pagamento.');return;}const saved=await enviarCompra(itens,payOcr);if(!saved)return;catalog.forEach(c=>c.checked=false);saveJSON(LS.catalog,catalog);toast('Compra da nota fiscal registrada.');go('hist');});
}
function setBotState(state, revertAfter){
  const fab=document.getElementById('botFab'), head=document.getElementById('botHead');
  if(fab) fab.dataset.state = state;
  if(head) head.dataset.state = state;
  if(revertAfter){ setTimeout(()=>{ if(fab)fab.dataset.state='idle'; if(head)head.dataset.state='idle'; }, revertAfter); }
}
function setBotThinking(on){
  const fabOuter=document.getElementById('botFabOuter'), headOuter=document.getElementById('botHeadOuter');
  if(fabOuter) fabOuter.classList.toggle('fast', on);
  if(headOuter) headOuter.classList.toggle('fast', on);
  setBotState(on ? 'thinking' : 'idle');
}
async function enviarCompra(items,paymentMethod){const now=localDateTime();const payload={purchaseId:uid(),date:now.date,time:now.time,location:lastLocation,paymentMethod,items:items.map(i=>({name:i.name,category:i.category||'Outros',qty:i.qty||1,price:i.price||0,inList:i.inList!==false}))};try{const data=await api.post('compra',payload);if(data.alertas?.length){triggerBudgetAlert(data.alertas);}else{setBotState('success',2200);}await Promise.all([refreshHero(),loadHistory(),notificationCenter.refresh()]);return data;}catch(e){toast(e.message||'Não consegui gravar no banco agora.');return null;}}
function triggerBudgetAlert(alertas){const overlay=document.getElementById('flashOverlay');overlay.classList.add('on');setTimeout(()=>overlay.classList.remove('on'),3000);playBeep();toast('Orçamento estourado em: '+alertas.map(a=>a.categoria).join(', '));setBotState('error',3000);}
function playBeep(){try{const ctx=new (window.AudioContext||window.webkitAudioContext)();[0,0.35,0.7].forEach(t=>{const o=ctx.createOscillator();const g=ctx.createGain();o.type='square';o.frequency.value=880;o.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(0.0001,ctx.currentTime+t);g.gain.exponentialRampToValueAtTime(0.25,ctx.currentTime+t+0.02);g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+t+0.25);o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+0.3);});}catch(e){}}
let history=[];let payHoje=null;
async function loadHistory(){if(!api.isConfigured()){history=[];renderHist();return;}try{const data=await api.get('historico',{limit:100});history=data.compras||[];renderHist();}catch(e){toast(e.message);}}
function renderHist(){const box=document.getElementById('histList');const selected=catalog.filter(c=>c.checked);let html='<div class="date-card"><div class="date-head"><div><div class="date-title">Hoje · em aberto</div><div class="date-sub">'+selected.length+' itens</div></div><span class="date-tot">'+money(selected.reduce((s,i)=>s+(i.price||0),0))+'</span></div><div class="date-body">'+(selected.length?selected.map(i=>`<div class="row"><div class="r-name">${escapeHTML(i.name)}</div><div class="r-price">${money(i.price)}</div></div>`).join('')+'<div class="pay-grid" id="payHojeGrid"><button class="pay-opt" data-p="Pix">Pix</button><button class="pay-opt" data-p="Débito">Débito</button><button class="pay-opt" data-p="Crédito">Crédito</button></div><button class="btn gh" id="btnLoc" type="button">📍 Usar minha localização</button><div id="locStatus"></div><button class="btn" id="btnFinishToday">Finalizar</button>':'<div class="empty">Nenhum item selecionado.</div>')+'</div></div>';if(!history.length)html+='<div class="empty">Nenhuma compra registrada.</div>';history.forEach(h=>{html+=`<div class="date-card"><div class="date-head"><div><div class="date-title">${escapeHTML(h.date)}</div><div class="date-sub">${h.items.length} itens · ${escapeHTML(h.paymentMethod)}</div></div><span class="date-tot">${money(h.total)}</span></div><div class="date-body">${h.items.map(i=>`<div class="row"><div class="r-name${i.inList?'':' off'}">${i.qty}x ${escapeHTML(i.name)}</div><div class="r-price">${money(i.subtotal)}</div></div>`).join('')}<button class="btn gh edit-purchase" data-id="${escapeHTML(h.purchaseId)}">Editar compra</button><button class="btn mut delete-purchase" data-id="${escapeHTML(h.purchaseId)}">Excluir compra</button></div></div>`;});box.innerHTML=html;box.querySelectorAll('.delete-purchase').forEach(btn=>btn.addEventListener('click',async()=>{if(!confirm('Excluir esta compra definitivamente?'))return;try{await api.post('excluirCompra',{purchaseId:btn.dataset.id});await Promise.all([loadHistory(),refreshHero()]);toast('Compra excluída.');}catch(e){toast(e.message);}}));box.querySelectorAll('.edit-purchase').forEach(btn=>btn.addEventListener('click',()=>editPurchase(btn.dataset.id)));const payGrid=document.getElementById('payHojeGrid');payGrid?.querySelectorAll('.pay-opt').forEach(o=>o.addEventListener('click',()=>{payGrid.querySelectorAll('.pay-opt').forEach(x=>x.classList.remove('active'));o.classList.add('active');payHoje=o.dataset.p;}));document.getElementById('btnLoc')?.addEventListener('click',()=>{const status=document.getElementById('locStatus');status.textContent='Obtendo localização...';navigator.geolocation?.getCurrentPosition(pos=>{lastLocation={lat:pos.coords.latitude,lng:pos.coords.longitude};status.textContent='Localização adicionada.';},()=>status.textContent='Não foi possível obter localização',{timeout:8000});});document.getElementById('btnFinishToday')?.addEventListener('click',async e=>{if(!payHoje){toast('Escolha a forma de pagamento.');return;}e.currentTarget.disabled=true;const items=selected.map(i=>({name:i.name,category:i.category,qty:1,price:i.price,inList:true}));const saved=await enviarCompra(items,payHoje);if(!saved){e.currentTarget.disabled=false;return;}selected.forEach(i=>{i.timesUsed=(i.timesUsed||0)+1;i.checked=false;});saveJSON(LS.catalog,catalog);payHoje=null;lastLocation=null;toast('Compra registrada!');renderCatalog();});}
async function editPurchase(purchaseId){const purchase=history.find(item=>item.purchaseId===purchaseId);if(!purchase)return;const payment=prompt('Forma de pagamento:',purchase.paymentMethod);if(payment===null)return;const items=[];for(const current of purchase.items){const name=prompt('Nome do item:',current.name);if(name===null)return;const category=prompt('Categoria:',current.category);if(category===null)return;const qty=prompt('Quantidade:',String(current.qty));if(qty===null)return;const price=prompt('Preço unitário:',String(current.price).replace('.',','));if(price===null)return;items.push({name:name.trim(),category:category.trim()||'Outros',qty:Number(String(qty).replace(',','.'))||1,price:Number(String(price).replace(',','.'))||0,inList:current.inList});}try{await api.post('atualizarCompra',{purchaseId,date:purchase.date,time:purchase.time,paymentMethod:payment,items});await Promise.all([loadHistory(),refreshHero()]);toast('Compra atualizada.');}catch(e){toast(e.message);}}
document.querySelectorAll('#periodChips .chip').forEach(c=>c.addEventListener('click',()=>{document.querySelectorAll('#periodChips .chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');loadPainel(c.dataset.p);}));
let chartInst=null;
async function loadPainel(periodo){periodo=periodo||'mes';const alertBox=document.getElementById('painelAlert');alertBox.innerHTML='';try{renderPainel(await api.get('painel',{periodo}));}catch(e){alertBox.innerHTML=`<div class="warn">${escapeHTML(e.message)}</div>`;}}
function renderPainel(data){document.getElementById('pIncome').textContent=money(data.receita);document.getElementById('pSpent').textContent=money(data.gastoTotal);document.getElementById('pFree').textContent=money(data.saldoLivre);const alertBox=document.getElementById('painelAlert');if(data.alertas&&data.alertas.length>0){alertBox.innerHTML=`<div class="warn">Orçamento estourado: ${data.alertas.map(a=>escapeHTML(a.categoria)).join(', ')}</div>`;}const colors={Necessidade:'#0C8A54',Desejo:'#5FCB92',Investimento:'#B9EDD1'};const seg=document.getElementById('ruleSeg');const total=data.grupos.reduce((s,g)=>s+g.gasto,0)||1;seg.innerHTML=data.grupos.map(g=>`<div class="seg-part" style="width:${Math.max(0,Math.min(100,(g.gasto/total)*100))}%;background:${colors[g.grupo]||'#ccc'}"></div>`).join('');const rows=document.getElementById('ruleRows');rows.innerHTML=data.grupos.map(g=>{const pctIdeal=data.receita>0?Math.round((g.meta/data.receita)*100):0;return`<div class="rule-row"><div><span class="rule-dot" style="background:${colors[g.grupo]||'#ccc'}"></span><span class="rule-lb">${escapeHTML(g.grupo)} (${pctIdeal}% ideal)</span></div><div class="rule-vals">${money(g.gasto)} / ${money(g.meta)}</div></div>`;}).join('');const ctx=document.getElementById('chart');if(chartInst)chartInst.destroy();chartInst=new Chart(ctx,{type:'bar',data:{labels:data.grupos.map(g=>g.grupo),datasets:[{label:'Gasto',data:data.grupos.map(g=>Math.round(g.gasto)),backgroundColor:'#0C8A54',borderRadius:6},{label:'Meta',data:data.grupos.map(g=>Math.round(g.meta)),backgroundColor:'#B9EDD1',borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true}}}});}
async function testConnection(){const status=document.getElementById('connStatus');status.innerHTML='🔄 Testando conexão...';try{const data=await api.get('config');applyConfig(data);status.innerHTML=`<span style="color:var(--gd);font-weight:600">✓ Conectado<br><span style="font-size:12px;font-weight:400;margin-top:4px;display:block">${cats.length} categorias sincronizadas</span></span>`;}catch(e){status.innerHTML=`<span style="color:var(--red)">✗ ${escapeHTML(e.message)}</span>`;}}
function applyConfig(data){cats=(data.categorias||[]).map(c=>({n:c.categoria,v:c.orcamento,g:c.grupo}));custos=data.custosFixos||[];proventos=data.proventos||[];investimentos=data.investimentos||[];}
function renderEditCats(){const box=document.getElementById('editCats');box.innerHTML='';cats.forEach((item,index)=>{const row=document.createElement('div');row.className='edit-row';row.innerHTML=`<input class="nm" value="${escapeHTML(item.n)}"><select>${GRUPOS.map(g=>`<option ${g===item.g?'selected':''}>${g}</option>`).join('')}</select><input class="vl" inputmode="decimal" value="${item.v}"><button class="remove-row" type="button">✕</button>`;row.querySelector('.nm').addEventListener('change',e=>item.n=e.target.value);row.querySelector('select').addEventListener('change',e=>item.g=e.target.value);row.querySelector('.vl').addEventListener('change',e=>item.v=parseFloat(e.target.value)||0);row.querySelector('.remove-row').addEventListener('click',()=>{cats.splice(index,1);renderEditCats();});box.appendChild(row);});const addBtn=document.createElement('button');addBtn.className='btn mut';addBtn.style.marginTop='6px';addBtn.textContent='Adicionar categoria';addBtn.addEventListener('click',()=>{cats.push({n:'Nova categoria',v:0,g:'Necessidade'});renderEditCats();});box.appendChild(addBtn);}
function renderEditSimple(target,list,placeholder){const box=document.getElementById(target);box.innerHTML='';list.forEach((item,index)=>{const row=document.createElement('div');row.className='edit-row simple-edit';row.innerHTML=`<input class="nm" value="${escapeHTML(item.n)}"><input class="vl" inputmode="decimal" value="${item.v}"><button class="remove-row" type="button">✕</button>`;row.querySelector('.nm').addEventListener('change',e=>item.n=e.target.value);row.querySelector('.vl').addEventListener('change',e=>item.v=parseFloat(e.target.value)||0);row.querySelector('.remove-row').addEventListener('click',()=>{list.splice(index,1);renderEditSimple(target,list,placeholder);});box.appendChild(row);});const addBtn=document.createElement('button');addBtn.className='btn mut';addBtn.style.marginTop='6px';addBtn.textContent=placeholder;addBtn.addEventListener('click',()=>{list.push({n:'Novo item',v:0});renderEditSimple(target,list,placeholder);});box.appendChild(addBtn);}
function renderRegistro(){renderEditCats();renderEditSimple('editCustos',custos,'Adicionar custo fixo');renderEditSimple('editProventos',proventos,'Adicionar provento');}
document.getElementById('btnSaveRegistro').addEventListener('click',async()=>{const btn=document.getElementById('btnSaveRegistro');btn.textContent='Salvando...';btn.disabled=true;try{await api.post('salvarConfig',{categorias:cats,custosFixos:custos,proventos});toast('Mudanças salvas.');await Promise.all([refreshHero(),notificationCenter.refresh()]);}catch(e){toast(e.message);}btn.textContent='Salvar mudanças';btn.disabled=false;});
refreshHero();
// Teste de conexão automático ao iniciar (mostra na tela de Status)
setTimeout(()=>{testConnection();},2400);

/* ===================== AUTENTICAÇÃO SUPABASE ===================== */
async function autenticarWelcome(createAccount = false){
  const setupUrl = document.getElementById('welcomeSupabaseUrl').value.trim();
  const setupKey = document.getElementById('welcomeSupabaseKey').value.trim();
  const name = document.getElementById('welcomeNameInput').value.trim();
  const email = document.getElementById('welcomeEmailInput').value.trim();
  const password = document.getElementById('welcomePasswordInput').value;
  const status = document.getElementById('welcomeStatus');
  if(!email || password.length < 6){ status.innerHTML='<span style="color:var(--red)">Informe o e-mail e uma senha com pelo menos 6 caracteres.</span>'; return; }
  status.innerHTML = createAccount ? '🔄 Criando conta...' : '🔄 Entrando...';
  try{
    if(setupUrl || setupKey){
      if(!setupUrl || !setupKey) throw new Error('Informe a URL e a chave pública do Supabase.');
      BACKEND_URL=setupUrl;ANON_KEY=setupKey;api.configure(BACKEND_URL,ANON_KEY);
      saveJSON(LS.supabaseUrl,BACKEND_URL);saveJSON(LS.supabaseAnonKey,ANON_KEY);
    }
    const data = createAccount ? await api.signUp(email,password,name) : await api.signIn(email,password);
    if(!data.access_token){
      status.innerHTML='<span style="color:var(--gd)">Conta criada. Confirme o e-mail e depois entre.</span>';
      return;
    }
    document.getElementById('welcomeScreen').classList.remove('show');
    toast('Conta conectada!');
    await Promise.all([testConnection(),loadCatalog(),refreshHero(),notificationCenter.refresh()]);
    if(createAccount) startOnboarding();
  }catch(e){
    status.innerHTML = `<span style="color:var(--red)">${escapeHTML(e.message)}</span>`;
  }
}
document.getElementById('btnWelcomeLogin').addEventListener('click',()=>autenticarWelcome(false));
document.getElementById('btnWelcomeSignup').addEventListener('click',()=>autenticarWelcome(true));
document.getElementById('btnLogout').addEventListener('click',async()=>{await api.signOut();document.getElementById('registroOverlay').classList.remove('open');document.getElementById('welcomeScreen').classList.add('show');await notificationCenter.refresh({generate:false});toast('Sessão encerrada.');});
if(!api.isAuthenticated()){ document.getElementById('welcomeScreen').classList.add('show'); }
else { loadCatalog(); notificationCenter.refresh(); }
if(api.isConfigured()){document.getElementById('supabaseSetupFields').style.display='none';}

/* ===================== AGENTE DE IA (texto, voz e onboarding) ===================== */
function openAi(){ document.getElementById('aiOverlay').classList.add('open'); document.getElementById('aiInput').focus(); }
function closeAi(){ document.getElementById('aiOverlay').classList.remove('open'); if('speechSynthesis' in window) speechSynthesis.cancel(); }
document.getElementById('btnOpenAi').addEventListener('click', openAi);
document.getElementById('btnCloseAi').addEventListener('click', closeAi);

const btnVoiceToggle = document.getElementById('btnAiVoiceToggle');
btnVoiceToggle.textContent = aiVoiceOn ? '🔊' : '🔇';
btnVoiceToggle.addEventListener('click', ()=>{
  aiVoiceOn = !aiVoiceOn; saveJSON(LS.aiVoice, aiVoiceOn);
  btnVoiceToggle.textContent = aiVoiceOn ? '🔊' : '🔇';
  if(!aiVoiceOn && 'speechSynthesis' in window) speechSynthesis.cancel();
});

function renderAiBubble(role, text){
  const box = document.getElementById('aiMsgs');
  const el = document.createElement('div');
  el.className = 'ai-msg ' + role;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}
function renderAiConfigCard(cfg){
  const box = document.getElementById('aiMsgs');
  const el = document.createElement('div');
  el.className = 'ai-config-card';
  const linhas = [];
  if(cfg.proventos) linhas.push(`Receitas: ${cfg.proventos.map(p=>p.n+' ('+money(p.v)+')').join(', ')}`);
  if(cfg.custosFixos) linhas.push(`Custos fixos: ${cfg.custosFixos.map(p=>p.n+' ('+money(p.v)+')').join(', ')}`);
  if(cfg.investimentos) linhas.push(`Investimentos: ${cfg.investimentos.map(p=>p.nome+' — '+p.tipo+' ('+money(p.valor)+', '+p.taxa+'% a.a.)').join(', ')}`);
  if(cfg.metas) linhas.push(`Metas: ${cfg.metas.map(p=>p.nome+' (objetivo '+money(p.objetivo)+', reserva mensal '+money(p.mensal)+')').join(', ')}`);
  const title = document.createElement('b');
  title.textContent = 'Detectei estas informações:';
  const preview = document.createElement('pre');
  preview.textContent = linhas.join('\n');
  el.append(title, preview);
  const btn = document.createElement('button');
  btn.className = 'btn'; btn.style.marginTop='4px'; btn.textContent = 'Confirmar e salvar';
  btn.addEventListener('click', async ()=>{
    btn.textContent = 'Salvando...'; btn.disabled = true;
    try{
      if(cfg.proventos){ proventos = cfg.proventos; await api.post('proventos',{itens:proventos}); }
      if(cfg.custosFixos){ custos = cfg.custosFixos; await api.post('custosFixos',{itens:custos}); }
      if(cfg.investimentos){ investimentos = cfg.investimentos; await api.post('investimentos',{itens:cfg.investimentos}); }
      if(cfg.metas){ await api.post('metas',{itens:cfg.metas}); }
      btn.textContent = '✓ Salvo';
      toast('Configuração salva!');
      refreshHero();
    }catch(e){ btn.textContent = 'Erro ao salvar, tentar de novo'; btn.disabled = false; }
  });
  el.appendChild(btn);
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
function falarTexto(texto){
  if(!aiVoiceOn || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR';
  speechSynthesis.speak(u);
}

async function buscarContextoFinanceiro(){
  if(!api.isAuthenticated()) return 'O usuário ainda não entrou na conta.';
  try{
    const [summary, investResp, goalResp] = await Promise.all([api.get('resumoFinanceiro'),api.get('investimentos'),api.get('metas')]);
    let ctx = `Resumo calculado pelo banco para ${summary.referenceMonth}: receita ${money(summary.income)}; gastos já registrados ${money(summary.spent)}; custos fixos planejados ${money(summary.fixedCommitments)}; parcelas pendentes no mês ${money(summary.pendingInstallments)}; reserva para metas ${money(summary.goalReserve)}; valor realmente disponível até o fim do mês ${money(summary.available)}; limite seguro por dia ${money(summary.safeDaily)}; faltam ${summary.remainingDays} dias. `;
    if(summary.groups?.length){
      ctx += `Orçamentos: ` + summary.groups.map(g=>`${g.name} gastou ${money(g.spent)} de ${money(g.budget)} (${g.percentage}%)`).join('; ') + '. ';
    }
    if(investResp && investResp.ok && investResp.investimentos.length){
      ctx += `Investimentos atuais: ` + investResp.investimentos.map(i=>`${i.nome} (${i.tipo}, ${money(i.valor)}, taxa ${i.taxa}% a.a., atualizado em ${i.atualizadoEm})`).join('; ') + '. ';
    }
    if(goalResp && goalResp.ok && goalResp.metas.length){
      ctx += `Metas financeiras: ` + goalResp.metas.map(g=>`${g.nome}: ${money(g.atual)} de ${money(g.objetivo)}, reservando ${money(g.mensal)} por mês`).join('; ') + '. ';
    }
    return ctx || 'Sem dados financeiros ainda — banco conectado mas vazio.';
  }catch{
    try{
      const painel=await api.get('painel',{periodo:'mes'});
      return `Receita mensal: ${money(painel.receita)}. Gastos registrados: ${money(painel.gastoTotal)}. Saldo simples: ${money(painel.saldoLivre)}.`;
    }catch{
      return 'Não consegui buscar os dados financeiros agora.';
    }
  }
}

function processarRespostaTexto(textoResposta){
  const match = textoResposta.match(/```dimdim-config\s*([\s\S]*?)```/);
  const textoLimpo = textoResposta.replace(/```dimdim-config[\s\S]*?```/, '').trim();
  renderAiBubble('bot', textoLimpo || textoResposta);
  aiMessages.push({role:'assistant', content:textoResposta});
  falarTexto(textoLimpo || textoResposta);
  if(match){
    try{ renderAiConfigCard(JSON.parse(match[1])); setBotState('success',2200); }catch(e){}
  }
}

async function enviarMensagemAi(texto){
  if(!texto.trim()) return;
  if(aiRequestPending){toast('Aguarde a resposta atual.');return;}
  renderAiBubble('user', texto);
  aiRequestPending=true;
  const sendButton=document.getElementById('btnAiSend');
  const input=document.getElementById('aiInput');
  sendButton.disabled=true;
  input.disabled=true;
  try{await enviarParaGemini(texto);}
  finally{
    aiRequestPending=false;
    sendButton.disabled=false;
    input.disabled=false;
    input.focus();
  }
}

async function enviarParaGemini(texto){
  aiMessages.push({role:'user', content:texto});
  const thinking = renderAiBubble('thinking', 'Pensando...');
  setBotThinking(true);

  const contexto = await buscarContextoFinanceiro();
  const systemPrompt = `Você é o assistente financeiro do app DimDim, conversando em português do Brasil, direto e amigável, respostas curtas (poucos parágrafos). Os valores do contexto abaixo foram calculados pelo PostgreSQL: use-os como fonte de verdade, não refaça as contas e não invente valores ausentes. Contexto financeiro atual do usuário: ${contexto}
Se o usuário estiver te contando receita, custos fixos, gastos de cartão, dívidas ou investimentos (onboarding inicial), depois de entender o suficiente, responda normalmente E inclua ao final um bloco de código no formato:
\`\`\`dimdim-config
{"proventos":[{"n":"Nome","v":1000}],"custosFixos":[{"n":"Nome","v":500}],"investimentos":[{"nome":"Nome","tipo":"Tipo","valor":1000,"taxa":10.5}],"metas":[{"nome":"Reserva de emergência","objetivo":10000,"atual":1000,"mensal":500,"data":"2027-12-31"}]}
\`\`\`
Inclua só as chaves que fizerem sentido pro que foi dito. Se o usuário perguntar sobre rentabilidade de algum investimento (CDB, Tesouro, poupança, fundos etc.), use a busca do Google pra achar a taxa atual antes de responder.`;

  const geminiContents = aiMessages.map(m=>({
    role: m.role==='assistant' ? 'model' : 'user',
    parts:[{text:m.content}]
  }));

  try{
    const data = await api.post('gemini', {
      systemInstruction: systemPrompt,
      contents: geminiContents
    });
    thinking.remove();
    setBotThinking(false);
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const textoResposta = parts.map(p=>p.text||'').join('\n').trim() || 'Não consegui responder agora.';
    processarRespostaTexto(textoResposta);
  }catch(e){
    thinking.remove();
    setBotThinking(false);
    aiMessages.pop();
    renderAiBubble('bot', e.message || 'Não consegui falar com o servidor agora.');
  }
}

document.getElementById('btnAiSend').addEventListener('click', ()=>{
  const input = document.getElementById('aiInput');
  const texto = input.value; input.value='';
  enviarMensagemAi(texto);
});
document.getElementById('aiInput').addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){ document.getElementById('btnAiSend').click(); }
});

function startOnboarding(){
  aiMessages = [];
  document.getElementById('aiMsgs').innerHTML = '';
  const msg = 'Oi! Sou o assistente do DimDim 👋 Vamos configurar tudo rapidinho? Me conta: qual sua receita mensal, seus custos fixos (aluguel, contas), gastos de cartão de crédito e parcelas, outras dívidas, investimentos e metas financeiras — incluindo quanto quer guardar por mês. Pode mandar tudo em uma mensagem só ou aos poucos.';
  renderAiBubble('bot', msg);
  aiMessages.push({role:'assistant', content:msg});
  openAi();
}

/* ===================== ENTRADA POR VOZ (Web Speech API) ===================== */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const btnMic = document.getElementById('btnAiMic');
if(!SpeechRec){
  btnMic.style.display = 'none';
} else {
  const recognizer = new SpeechRec();
  recognizer.lang = 'pt-BR';
  recognizer.interimResults = false;
  let ouvindo = false;
  recognizer.addEventListener('result', (e)=>{
    const texto = e.results[0][0].transcript;
    document.getElementById('aiInput').value = texto;
    enviarMensagemAi(texto);
    document.getElementById('aiInput').value = '';
  });
  recognizer.addEventListener('end', ()=>{ ouvindo=false; btnMic.classList.remove('listening'); });
  recognizer.addEventListener('error', ()=>{ ouvindo=false; btnMic.classList.remove('listening'); });
  btnMic.addEventListener('click', ()=>{
    if(ouvindo){ recognizer.stop(); ouvindo=false; btnMic.classList.remove('listening'); return; }
    try{ recognizer.start(); ouvindo=true; btnMic.classList.add('listening'); }catch(e){}
  });
}

if('serviceWorker'in navigator){
  let refrescando = false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(refrescando) return;
    refrescando = true;
    window.location.reload();
  });
  navigator.serviceWorker.addEventListener('message', event=>{
    if(event.data?.type==='OPEN_NOTIFICATIONS') notificationCenter.open();
  });
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
if(window.location.hash==='#notifications'){
  setTimeout(()=>notificationCenter.open(),4000);
}
