/* =====================================================================
   PLATAFORMA KE — MÓDULO LOJA / SITE
   Tudo o que for cadastrado aqui (materiais, preço, estoque, fotos, obras)
   aparece no site público (site/?l=SLUG) em tempo real.
   Pedidos e pedidos de orçamento feitos no site chegam aqui na hora; um
   pedido de orçamento vira orçamento no módulo Orçamentos com um toque.
===================================================================== */
(() => {
'use strict';
const P = window.Plataforma, db = P.db, esc = P.esc;
const $ = s => document.querySelector(s);
let CTX = null, EMP = null;
let CFG = null;                  // linha de loj_config (null = site ainda não criado)
let PRODUTOS = [], OBRAS = [], PEDIDOS = [], SOLIC = [];
const UI = { aba: 'materiais', busca: '', fPed: 'abertos', fSol: 'nova', novos: new Set() };
let edFotos = [];                // fotos do cadastro aberto no modal
let edModo = 'produto';          // 'produto' (só fotos, até 8) ou 'obra' (fotos e vídeos, até 12)
const ehVideo = u => /youtube\.com|youtu\.be/i.test(u) || /\.(mp4|webm|mov)(\?|#|$)/i.test(u);
const ytId = u => (String(u).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/) || [])[1];

/* ---------------- utilitários ---------------- */
const money = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
function toNum(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
const inMoeda = v => (v === null || v === undefined || v === '') ? '' : Number(v).toFixed(2).replace('.', ',');
const inNum = v => (v === null || v === undefined || v === '') ? '' : String(Math.round(Number(v) * 100) / 100).replace('.', ',');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
function toast(m, ms = 2800) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
function abrirModal(html, largo) { $('#modalBox').className = 'modal-box' + (largo ? ' largo' : ''); $('#modalBox').innerHTML = html; $('#modal').hidden = false; document.body.classList.add('lock'); }
function fecharModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; document.body.classList.remove('lock'); edFotos = []; }
const cab = t => `<h3>${t}<button class="x" data-act="fechar" aria-label="Fechar">×</button></h3>`;
async function ok(p) { const { data, error } = await p; if (error) throw error; return data; }
function erro(e) { console.error(e); toast('Erro: ' + (e && e.message || e), 5000); }
const foneBR = d => { d = String(d || ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : d; };
function ehCelular() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent); }
function abrirWhats(fone, texto) {
  const f = fone ? (String(fone).length <= 11 ? '55' : '') + fone : '';
  const t = encodeURIComponent(texto || '');
  if (ehCelular()) return window.open('https://wa.me/' + f + '?text=' + t, '_blank');
  window.open('https://web.whatsapp.com/send?' + (f ? 'phone=' + f + '&' : '') + 'text=' + t, 'ke-whatsapp');
}
const linkSite = () => CFG ? new URL('site/?l=' + encodeURIComponent(CFG.slug), P.raiz).href : '';
const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'minha-loja';
const tempo = d => { const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? 'agora' : s < 3600 ? Math.floor(s / 60) + ' min atrás' : s < 86400 ? Math.floor(s / 3600) + ' h atrás' : new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

/* ---------------- dados ---------------- */
async function carregarTudo() {
  await P.rpc('loj_expirar_minha', { p_empresa: EMP }).catch(() => 0);
  const [cfg, prods, obras, peds, sols] = await Promise.all([
    db.from('loj_config').select('*').eq('empresa_id', EMP).maybeSingle().then(ok),
    db.from('loj_produtos').select('*').eq('empresa_id', EMP).order('ordem').order('nome').then(ok),
    db.from('loj_obras').select('*').eq('empresa_id', EMP).order('criado_em', { ascending: false }).then(ok),
    db.from('loj_pedidos').select('*').eq('empresa_id', EMP).order('criado_em', { ascending: false }).limit(300).then(ok),
    db.from('loj_solicitacoes').select('*').eq('empresa_id', EMP).order('criado_em', { ascending: false }).limit(300).then(ok)
  ]);
  CFG = cfg; PRODUTOS = prods; OBRAS = obras; PEDIDOS = peds; SOLIC = sols;
}
async function recarregarProdutos() { PRODUTOS = await db.from('loj_produtos').select('*').eq('empresa_id', EMP).order('ordem').order('nome').then(ok); }
async function recarregarPedidos() {
  [PEDIDOS, SOLIC] = await Promise.all([
    db.from('loj_pedidos').select('*').eq('empresa_id', EMP).order('criado_em', { ascending: false }).limit(300).then(ok),
    db.from('loj_solicitacoes').select('*').eq('empresa_id', EMP).order('criado_em', { ascending: false }).limit(300).then(ok)]);
}
const ABERTOS = ['aguardando', 'pago', 'separando', 'pronto'];
function contadores() {
  const np = PEDIDOS.filter(p => ['aguardando', 'pago', 'separando'].includes(p.status)).length;
  const ns = SOLIC.filter(s => s.status === 'nova').length;
  $('#cPed').textContent = np || ''; $('#cSol').textContent = ns || '';
  $('#verSite').hidden = !(CFG && CFG.publicado); $('#verSite').href = linkSite();
}

/* ---------------- render ---------------- */
function render() {
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('on', b.dataset.aba === UI.aba));
  contadores();
  const c = $('#conteudo');
  if (!CFG && UI.aba !== 'site') {
    c.innerHTML = `<div class="card"><h2>Bem-vindo à Loja / Site</h2><p class="sub">Primeiro, crie o endereço do site da empresa. Depois é só cadastrar os materiais: eles aparecem para o cliente na hora.</p>
      <button class="btn pri" data-act="aba" data-aba="site">⚙️ Configurar o site</button></div>`;
    return;
  }
  ({ materiais: telaMateriais, pedidos: telaPedidos, solicitacoes: telaSolicitacoes, obras: telaObras, site: telaSite })[UI.aba]();
}

/* ---- MATERIAIS ---- */
function telaMateriais() {
  const q = UI.busca.toLowerCase();
  const lista = PRODUTOS.filter(p => !q || (p.nome + ' ' + p.categoria).toLowerCase().includes(q));
  const pub = PRODUTOS.filter(p => p.publicado);
  const baixo = pub.filter(p => p.estoque - p.reservado <= 0).length;
  const reservado = PRODUTOS.reduce((s, p) => s + (Number(p.reservado) > 0 ? 1 : 0), 0);
  const cats = [...new Set(PRODUTOS.map(p => p.categoria))];
  $('#conteudo').innerHTML = `
    ${CFG && !CFG.publicado ? `<div class="aviso">O site ainda está <b>fora do ar</b>. Quando os materiais estiverem prontos, ligue em <a href="#" data-act="aba" data-aba="site">⚙️ Site</a>.</div>` : ''}
    <div class="tiles">
      <div class="tile"><small>No site</small><b>${pub.length}</b></div>
      <div class="tile"><small>Esgotados no site</small><b style="color:${baixo ? 'var(--danger)' : 'var(--navy)'}">${baixo}</b></div>
      <div class="tile"><small>Com reserva de pedido</small><b>${reservado}</b></div>
    </div>
    <div class="card">
      <h2>📦 Materiais disponíveis <button class="btn pri sm dir" data-act="prod-novo">+ Novo material</button></h2>
      <p class="sub">Altere preço e estoque direto na lista: o site do cliente atualiza na hora. "Disponível" = estoque − reservado por pedidos em aberto.</p>
      <div class="barra-filtros"><input id="busca" placeholder="Buscar material…" value="${esc(UI.busca)}"></div>
      <div id="listaProd" style="margin-top:6px">${lista.map(linhaProduto).join('') || (PRODUTOS.length ? '<div class="vazio">Nada encontrado.</div>' :
        `<div class="vazio"><b>Nenhum material cadastrado</b>Cadastre o primeiro ou comece com os 4 materiais do site (cola, piso, rodapé e ripado), ainda ocultos para você revisar.
          <div class="btn-row" style="justify-content:center"><button class="btn pri" data-act="prod-novo">+ Novo material</button><button class="btn" data-act="prod-exemplos">Usar os 4 do site</button></div></div>`)}</div>
      ${cats.length ? `<p class="hint">Categorias em uso: ${cats.map(esc).join(', ')}. No site, cada categoria vira um filtro.</p>` : ''}
    </div>`;
}
function linhaProduto(p) {
  const disp = Math.max(0, p.estoque - p.reservado);
  const foto = p.fotos && p.fotos[0];
  return `<div class="prod ${p.publicado ? '' : 'oculto'}" data-id="${p.id}">
    <div class="th" style="${foto ? `background-image:url('${esc(foto)}')` : ''}">${foto ? '' : '📦'}</div>
    <div class="info"><b>${esc(p.nome)}</b><small>${esc(p.categoria)} · disponível ${fmtN(disp)} ${esc(p.unidade)}${Number(p.reservado) > 0 ? ` (${fmtN(p.reservado)} reservado)` : ''}</small>
      ${p.publicado ? '' : '<span class="tag">oculto</span>'}${p.publicado && disp <= 0 ? '<span class="tag ver">esgotado</span>' : ''}</div>
    <div class="cel pr"><label>Preço / ${esc(p.unidade)}</label><div class="money"><span>R$</span><input data-campo="preco" data-id="${p.id}" inputmode="decimal" value="${inMoeda(p.preco)}"></div></div>
    <div class="cel es"><label>Estoque (${esc(p.unidade)})</label><input data-campo="estoque" data-id="${p.id}" inputmode="decimal" value="${inNum(p.estoque)}"></div>
    <div class="acoes"><label class="sw" title="Mostrar no site"><input type="checkbox" data-campo="publicado" data-id="${p.id}" ${p.publicado ? 'checked' : ''}><span>Site</span></label>
      <button class="btn sm" data-act="prod-editar" data-id="${p.id}">Editar</button></div>
  </div>`;
}
async function salvarCampo(el) {
  const id = el.dataset.id, campo = el.dataset.campo, p = PRODUTOS.find(x => x.id === id); if (!p) return;
  let v = campo === 'publicado' ? el.checked : toNum(el.value);
  if (campo !== 'publicado') {
    v = Math.round(v * 100) / 100;
    if (v < 0) { el.value = inNum(p[campo]); return toast('Valor inválido'); }
    if (campo === 'estoque' && v < p.reservado) toast(`Atenção: há ${fmtN(p.reservado)} ${p.unidade} reservados em pedidos abertos.`, 4500);
    if (Number(p[campo]) === v) { el.value = inNum(v); return; }
  }
  try {
    const row = await ok(db.from('loj_produtos').update({ [campo]: v }).eq('id', id).select().single());
    Object.assign(p, row);
    const box = el.closest('.money') ? el : el.closest('.sw') || el;
    box.classList.remove('salvo'); void box.offsetWidth; box.classList.add('salvo');
    if (campo === 'publicado') render();
    else { el.value = campo === 'preco' ? inMoeda(v) : inNum(v); const linha = el.closest('.prod'); linha.querySelector('.info small').textContent = `${p.categoria} · disponível ${fmtN(Math.max(0, p.estoque - p.reservado))} ${p.unidade}${Number(p.reservado) > 0 ? ` (${fmtN(p.reservado)} reservado)` : ''}`; }
    toast(CFG && CFG.publicado ? '✓ Atualizado no site' : '✓ Salvo');
  } catch (e) { el.value = campo === 'publicado' ? '' : inNum(p[campo]); if (campo === 'publicado') el.checked = p.publicado; erro(e); }
}
const EXEMPLOS = [
  { categoria: 'Colas', nome: 'Cola de contato 2,8 kg', unidade: 'lata', preco: 89.9, descricao: 'Adesivo de contato para superfícies compatíveis.', tecnico: 'Peso líquido: 2,8 kg. Marca, composição, rendimento e tempo de secagem: conferir ficha técnica.', beneficios: 'Aplicação conforme compatibilidade e instruções do fabricante.', cuidados: 'Siga o rótulo e a ficha de segurança. Ventile o local; mantenha longe de fontes de ignição quando aplicável.' },
  { categoria: 'Pisos', nome: 'Piso vinílico amadeirado', unidade: 'm²', preco: 65, descricao: 'Acabamento para ambientes internos compatíveis.', tecnico: 'Espessura, dimensões, classe de uso e embalagem: confirmar modelo.', beneficios: 'Aspecto amadeirado e facilidade de manutenção conforme modelo.', cuidados: 'Base limpa, seca e nivelada. Use limpeza indicada pelo fabricante e proteção nos móveis.' },
  { categoria: 'Rodapés', nome: 'Rodapé de PVC', unidade: 'barra', preco: 25, descricao: 'Acabamento para encontro entre piso e parede.', tecnico: 'Material: PVC. Altura e comprimento: confirmar modelo.', beneficios: 'Acabamento visual e proteção da base da parede.', cuidados: 'Meça antes de cortar. Utilize fixação compatível e limpeza não abrasiva.' },
  { categoria: 'Ripados', nome: 'Ripado de PVC', unidade: 'peça', preco: 40, descricao: 'Revestimento decorativo para aplicações compatíveis.', tecnico: 'Material: PVC. Dimensões, cor e aplicação: confirmar ficha técnica.', beneficios: 'Textura decorativa e composição visual do ambiente.', cuidados: 'Verifique a base, a fixação e as restrições de temperatura e umidade.' }
];
async function usarExemplos() {
  await ok(db.from('loj_produtos').insert(EXEMPLOS.map((e, i) => ({ ...e, empresa_id: EMP, estoque: 0, publicado: false, ordem: (i + 1) * 10 }))));
  await recarregarProdutos(); render();
  toast('4 materiais criados, ocultos e com estoque 0. Revise preço, estoque e fotos e ligue "Site".', 6000);
}

/* cadastro / edição de material */
function formProduto(id) {
  const p = PRODUTOS.find(x => x.id === id) || { nome: '', categoria: '', unidade: 'un', preco: '', estoque: '', descricao: '', tecnico: '', beneficios: '', cuidados: '', fotos: [], publicado: true, ordem: (PRODUTOS.length + 1) * 10 };
  edFotos = [...(p.fotos || [])]; edModo = 'produto';
  const cats = [...new Set(['Colas', 'Pisos', 'Rodapés', 'Ripados', ...PRODUTOS.map(x => x.categoria)])];
  abrirModal(`${cab(id ? 'Editar material' : 'Novo material')}
    <form id="fProd" data-id="${id || ''}"><div class="grid">
      <div class="full"><label>Nome</label><input name="nome" required maxlength="120" value="${esc(p.nome)}" placeholder="Ex.: Piso vinílico amadeirado 2 mm"></div>
      <div><label>Categoria</label><input name="categoria" required maxlength="40" list="dlCats" value="${esc(p.categoria)}"><datalist id="dlCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div><label>Unidade de venda</label><input name="unidade" required maxlength="12" list="dlUn" value="${esc(p.unidade)}"><datalist id="dlUn">${['m²', 'un', 'lata', 'barra', 'peça', 'caixa', 'rolo', 'm', 'kg'].map(u => `<option value="${u}">`).join('')}</datalist></div>
      <div><label>Preço (R$)</label><div class="money"><span>R$</span><input name="preco" required inputmode="decimal" value="${inMoeda(p.preco)}"></div></div>
      <div><label>Estoque físico</label><input name="estoque" required inputmode="decimal" value="${inNum(p.estoque)}"></div>
      <div class="full"><label>Descrição curta (aparece no cartão)</label><textarea name="descricao" rows="2" maxlength="600">${esc(p.descricao)}</textarea></div>
      <div class="full"><label>Características técnicas</label><textarea name="tecnico" rows="2" maxlength="1500">${esc(p.tecnico)}</textarea></div>
      <div class="full"><label>Benefícios</label><textarea name="beneficios" rows="2" maxlength="1500">${esc(p.beneficios)}</textarea></div>
      <div class="full"><label>Modo de uso / cuidados</label><textarea name="cuidados" rows="2" maxlength="1500">${esc(p.cuidados)}</textarea></div>
      <div class="full"><label>Fotos (até 8 · a primeira é a capa)</label><div class="fotos" id="edFotos"></div>
        <p class="hint">Use fotos reais do produto. Também dá para colar um link https de imagem: <a href="#" data-act="foto-url">adicionar por link</a>.</p></div>
      <div><label>Ordem no site</label><input name="ordem" type="number" step="1" value="${p.ordem}"></div>
      <div style="display:flex;align-items:flex-end"><label class="sw"><input type="checkbox" name="publicado" ${p.publicado ? 'checked' : ''}><span>Mostrar no site</span></label></div>
    </div>
    <div class="btn-row"><button class="btn pri" id="btnSalvarProd">Salvar</button>${id ? '<button type="button" class="btn perigo" data-act="prod-excluir" data-id="' + id + '">Excluir</button>' : ''}<button type="button" class="btn" data-act="fechar">Cancelar</button></div>
    </form>`, true);
  desenharFotos();
}
function desenharFotos() {
  const box = $('#edFotos'); if (!box) return;
  const max = edModo === 'obra' ? 12 : 8;
  const capa = edFotos.findIndex(u => !ehVideo(u));
  box.innerHTML = edFotos.map((u, i) => {
    const v = ehVideo(u), y = v && ytId(u);
    const fundo = !v ? `background-image:url('${esc(u)}')` : y ? `background-image:url('https://i.ytimg.com/vi/${y}/hqdefault.jpg')` : '';
    return `<div class="f${v ? ' vid' : ''}" style="${fundo}">${v && !y ? `<video src="${esc(u)}#t=0.1" muted playsinline preload="metadata"></video>` : ''}
      ${v ? '<span class="selo">▶ vídeo</span>' : i === capa ? '<span class="selo capa">capa</span>' : ''}
      <button type="button" data-act="foto-del" data-i="${i}" aria-label="Remover">×</button>
      ${edFotos.length > 1 ? `<div class="ord">${i > 0 ? `<button type="button" data-act="foto-esq" data-i="${i}" aria-label="Mover para a esquerda">◀</button>` : ''}${i < edFotos.length - 1 ? `<button type="button" data-act="foto-dir" data-i="${i}" aria-label="Mover para a direita">▶</button>` : ''}</div>` : ''}</div>`;
  }).join('')
    + (edFotos.length < max ? `<label class="add"><b>＋</b>${edModo === 'obra' ? 'Fotos ou vídeo' : 'Adicionar fotos'}<input type="file" accept="image/jpeg,image/png,image/webp${edModo === 'obra' ? ',video/mp4,video/webm,video/quicktime' : ''}" multiple hidden id="inFotos"></label>` : '');
}
async function reduzir(file, maxLado = 1400, qualidade = 0.82) {
  const b = await createImageBitmap(file);
  const s = Math.min(1, maxLado / Math.max(b.width, b.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(b.width * s)); c.height = Math.max(1, Math.round(b.height * s));
  c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); b.close && b.close();
  return new Promise(r => c.toBlob(r, 'image/jpeg', qualidade));
}
async function enviarFotos(files) {
  const max = edModo === 'obra' ? 12 : 8;
  const lista = [...files].slice(0, max - edFotos.length);
  if (!lista.length) return;
  const btn = $('#btnSalvarObra') || $('#btnSalvarProd'); if (btn) btn.disabled = true;
  for (const f of lista) {
    try {
      if (/^video\//.test(f.type)) {
        if (edModo !== 'obra') { toast('Vídeo só nas obras.'); continue; }
        if (edFotos.filter(ehVideo).length >= 3) { toast('Máximo de 3 vídeos por obra.'); continue; }
        if (f.size > 50 * 1024 * 1024) { toast(`Vídeo com ${Math.round(f.size / 1048576)} MB: o limite é 50 MB. Corte o vídeo ou use um link do YouTube.`, 6000); continue; }
        const ext = { 'video/webm': 'webm', 'video/quicktime': 'mov' }[f.type] || 'mp4';
        toast(`Enviando vídeo (${Math.round(f.size / 1048576)} MB)… não feche a janela.`, 120000);
        const caminho = `${EMP}/videos/${uid()}.${ext}`;
        await ok(db.storage.from('loja').upload(caminho, f, { contentType: f.type || 'video/mp4', cacheControl: '31536000', upsert: false }));
        edFotos.push(db.storage.from('loja').getPublicUrl(caminho).data.publicUrl);
      } else {
        toast('Enviando foto…', 10000);
        const blob = await reduzir(f);
        const caminho = `${EMP}/${uid()}.jpg`;
        await ok(db.storage.from('loja').upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }));
        edFotos.push(db.storage.from('loja').getPublicUrl(caminho).data.publicUrl);
      }
      desenharFotos();
    } catch (e) { erro(e); }
  }
  if (btn) btn.disabled = false;
  toast('Pronto. Use ◀ ▶ para escolher a posição e clique em Salvar.', 4000);
}
const caminhoStorage = u => { const m = String(u).match(/\/storage\/v1\/object\/public\/loja\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; };
async function apagarArquivos(urls) {
  const cams = urls.map(caminhoStorage).filter(Boolean);
  if (cams.length) await db.storage.from('loja').remove(cams).catch(() => null);
}
async function salvarProduto(form) {
  const id = form.dataset.id, f = new FormData(form), antigo = PRODUTOS.find(x => x.id === id);
  const row = {
    nome: f.get('nome').trim(), categoria: f.get('categoria').trim(), unidade: f.get('unidade').trim(),
    preco: Math.round(toNum(f.get('preco')) * 100) / 100, estoque: Math.round(toNum(f.get('estoque')) * 100) / 100,
    descricao: f.get('descricao').trim() || null, tecnico: f.get('tecnico').trim() || null, beneficios: f.get('beneficios').trim() || null,
    cuidados: f.get('cuidados').trim() || null, fotos: edFotos.slice(0, 8), ordem: parseInt(f.get('ordem'), 10) || 100, publicado: !!f.get('publicado')
  };
  if (row.preco <= 0 && row.publicado) return toast('Informe o preço antes de mostrar no site.');
  $('#btnSalvarProd').disabled = true;
  try {
    if (id) await ok(db.from('loj_produtos').update(row).eq('id', id));
    else await ok(db.from('loj_produtos').insert({ ...row, empresa_id: EMP }));
    if (antigo) await apagarArquivos((antigo.fotos || []).filter(u => !row.fotos.includes(u)));
    edFotos = []; fecharModal(); await recarregarProdutos(); render();
    toast(row.publicado && CFG && CFG.publicado ? '✓ Salvo e já no site' : '✓ Salvo');
  } catch (e) { $('#btnSalvarProd').disabled = false; erro(e); }
}
async function excluirProduto(id) {
  const p = PRODUTOS.find(x => x.id === id); if (!p) return;
  if (Number(p.reservado) > 0) return toast('Este material tem reserva em pedido aberto. Oculte do site em vez de excluir.', 5000);
  if (!confirm(`Excluir "${p.nome}"? Para só tirar do site, desligue "Mostrar no site".`)) return;
  await ok(db.from('loj_produtos').delete().eq('id', id));
  await apagarArquivos(p.fotos || []);
  fecharModal(); await recarregarProdutos(); render(); toast('Material excluído.');
}

/* ---- PEDIDOS ---- */
const ST = {
  aguardando: ['Aguardando pagamento', 'ama'], pago: ['Pago', 'az'], separando: ['Separando', 'lar'], pronto: ['Pronto', 'ok'],
  entregue: ['Entregue', 'ok'], cancelado: ['Cancelado', 'ver'], expirado: ['Expirado', '']
};
function telaPedidos() {
  const filtros = { abertos: 'Em aberto', aguardando: 'Aguardando pagamento', pago: 'Pagos', separando: 'Separando', pronto: 'Prontos', fechados: 'Concluídos', todos: 'Todos' };
  const lista = PEDIDOS.filter(p => UI.fPed === 'todos' || (UI.fPed === 'abertos' ? ABERTOS.includes(p.status) : UI.fPed === 'fechados' ? !ABERTOS.includes(p.status) : p.status === UI.fPed));
  const hoje = PEDIDOS.filter(p => ['pago', 'separando', 'pronto', 'entregue'].includes(p.status) && new Date(p.criado_em).toDateString() === new Date().toDateString());
  $('#conteudo').innerHTML = `
    <div class="tiles">
      <div class="tile"><small>Aguardando pagamento</small><b>${PEDIDOS.filter(p => p.status === 'aguardando').length}</b></div>
      <div class="tile"><small>Para separar</small><b>${PEDIDOS.filter(p => ['pago', 'separando'].includes(p.status)).length}</b></div>
      <div class="tile"><small>Vendido hoje</small><b>${money(hoje.reduce((s, p) => s + Number(p.total), 0))}</b></div>
    </div>
    <div class="card"><h2>🧾 Pedidos do site</h2><p class="sub">Chegam aqui na hora. O pagamento é conferido por vocês: confirme quando o Pix cair ou o cartão for aprovado.</p>
    <div class="filtro-st">${Object.entries(filtros).map(([k, v]) => `<button data-act="fped" data-f="${k}" class="${UI.fPed === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    ${lista.map(cardPedido).join('') || '<div class="vazio">Nenhum pedido aqui.</div>'}</div>`;
}
function cardPedido(o) {
  const [nome, cor] = ST[o.status] || [o.status, ''];
  const conf = o.conferidos || [];
  const exp = o.status === 'aguardando' ? ` · reserva até ${new Date(o.expira_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
  const acoes = {
    aguardando: `<button class="btn pri sm" data-act="ped-st" data-id="${o.id}" data-st="pago">✓ Confirmar pagamento</button><button class="btn sm perigo" data-act="ped-st" data-id="${o.id}" data-st="cancelado">Cancelar</button>`,
    pago: `<button class="btn pri sm" data-act="ped-st" data-id="${o.id}" data-st="separando">Iniciar separação</button><button class="btn sm perigo" data-act="ped-st" data-id="${o.id}" data-st="cancelado">Cancelar</button>`,
    separando: `<button class="btn pri sm" data-act="ped-st" data-id="${o.id}" data-st="pronto" ${conf.length < o.itens.length ? 'disabled title="Marque todos os itens"' : ''}>Concluir separação</button>`,
    pronto: `<button class="btn pri sm" data-act="ped-st" data-id="${o.id}" data-st="entregue">${o.entrega === 'Entrega' ? 'Registrar saída para entrega' : 'Registrar retirada'}</button><button class="btn sm" data-act="ped-st" data-id="${o.id}" data-st="separando">Voltar para separação</button>`
  }[o.status] || '';
  return `<div class="ped ${UI.novos.has(o.id) ? 'novo' : ''}">
    <div class="ped-top"><span class="tag ${cor}">${nome}</span><b>${esc(o.codigo)}</b><small class="hint" style="margin:0">${tempo(o.criado_em)}${exp}</small><span class="total">${money(o.total)}</span></div>
    <div class="cli"><b style="color:var(--ink)">${esc(o.cliente_nome)}</b> · ${foneBR(o.telefone)} · ${o.metodo === 'pix' ? 'Pix' : 'Cartão'} · ${esc(o.entrega)}${o.endereco ? ': ' + esc(o.endereco) : ''}</div>
    ${o.itens.map((i, j) => `<div class="it">${o.status === 'separando' ? `<input type="checkbox" data-act="conf" data-id="${o.id}" data-j="${j}" ${conf.includes(j) ? 'checked' : ''} aria-label="Separado">` : ''}<span>${esc(i.nome)}</span><small>${fmtN(i.qtd)} ${esc(i.unidade)} × ${money(i.preco)}</small></div>`).join('')}
    <div class="btn-row" style="margin-top:10px">${acoes}<button class="btn sm zap" data-act="ped-zap" data-id="${o.id}">WhatsApp</button></div>
  </div>`;
}
async function mudarStatus(id, st) {
  const o = PEDIDOS.find(x => x.id === id); if (!o) return;
  if (st === 'cancelado' && !confirm(`Cancelar o pedido ${o.codigo}? A reserva do material é liberada.`)) return;
  if (st === 'entregue' && !confirm('Confirmar a saída? O estoque físico será baixado.')) return;
  try {
    const row = await ok(db.from('loj_pedidos').update({ status: st }).eq('id', id).select().single());
    Object.assign(o, row); UI.novos.delete(id);
    await recarregarProdutos(); render(); toast('Pedido ' + o.codigo + ': ' + ST[st][0]);
  } catch (e) { erro(e); await recarregarPedidos(); render(); }
}
async function conferir(id, j, marcado) {
  const o = PEDIDOS.find(x => x.id === id); if (!o) return;
  const conf = (o.conferidos || []).filter(k => k !== j); if (marcado) conf.push(j);
  try { const row = await ok(db.from('loj_pedidos').update({ conferidos: conf.sort((a, b) => a - b) }).eq('id', id).select().single()); Object.assign(o, row); render(); }
  catch (e) { erro(e); }
}
function zapPedido(id) {
  const o = PEDIDOS.find(x => x.id === id); if (!o) return;
  const txt = {
    aguardando: o.metodo === 'pix' ? `Olá, ${o.cliente_nome}! Recebemos seu pedido ${o.codigo} (${money(o.total)}). Assim que o Pix cair, começamos a separar.` : `Olá, ${o.cliente_nome}! Recebemos seu pedido ${o.codigo} (${money(o.total)}). Segue o link para pagamento no cartão: `,
    pago: `Olá, ${o.cliente_nome}! Pagamento do pedido ${o.codigo} confirmado. Já vamos separar o material.`,
    separando: `Olá, ${o.cliente_nome}! Estamos separando o pedido ${o.codigo}.`,
    pronto: o.entrega === 'Entrega' ? `Olá, ${o.cliente_nome}! Seu pedido ${o.codigo} está pronto e sai para entrega em breve.` : `Olá, ${o.cliente_nome}! Seu pedido ${o.codigo} está pronto para retirada.`
  }[o.status] || `Olá, ${o.cliente_nome}! Sobre o pedido ${o.codigo}: `;
  abrirWhats(o.telefone, txt);
}

/* ---- SOLICITAÇÕES (pedidos de orçamento do site) ---- */
function telaSolicitacoes() {
  const temOrc = (CTX.empresa.modulos || []).includes('orcamentos');
  const filtros = { nova: 'Novas', em_orcamento: 'Em orçamento', descartada: 'Descartadas', todas: 'Todas' };
  const lista = SOLIC.filter(s => UI.fSol === 'todas' || s.status === UI.fSol);
  $('#conteudo').innerHTML = `<div class="card"><h2>💬 Pedidos de orçamento do site</h2>
    <p class="sub">${temOrc ? 'Toque em <b>Criar orçamento</b> para abrir um orçamento já com cliente, bairro e detalhes preenchidos.' : 'Libere o módulo Orçamentos para transformar estes pedidos em orçamento com um toque.'}</p>
    <div class="filtro-st">${Object.entries(filtros).map(([k, v]) => `<button data-act="fsol" data-f="${k}" class="${UI.fSol === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    ${lista.map(s => {
      const prod = s.produto_id && PRODUTOS.find(p => p.id === s.produto_id), ob = s.obra_id && OBRAS.find(o => o.id === s.obra_id);
      return `<div class="ped ${UI.novos.has(s.id) ? 'novo' : ''}">
        <div class="ped-top"><span class="tag ${s.status === 'nova' ? 'lar' : s.status === 'em_orcamento' ? 'ok' : ''}">${{ nova: 'Nova', em_orcamento: 'Em orçamento', descartada: 'Descartada' }[s.status]}</span>
          <b>${esc(s.servico)}</b><small class="hint" style="margin:0">${esc(s.codigo)} · ${tempo(s.criado_em)}</small></div>
        <div class="cli"><b style="color:var(--ink)">${esc(s.nome)}</b> · ${foneBR(s.telefone)} · 📍 ${esc(s.bairro)}</div>
        <div class="cli">${esc(s.modalidade)}${s.area ? ' · ' + fmtN(s.area) + ' m²' : ''}${prod ? ' · material: ' + esc(prod.nome) : ''}${ob ? ' · inspirado na obra: ' + esc(ob.titulo) : ''}</div>
        ${s.detalhes ? `<div class="cli" style="color:var(--ink);white-space:pre-wrap">${esc(s.detalhes)}</div>` : ''}
        <div class="btn-row" style="margin-top:8px">
          ${s.orcamento_id && temOrc ? `<button class="btn pri sm" data-act="sol-abrir" data-id="${s.id}">📄 Abrir orçamento</button>` : temOrc && s.status !== 'descartada' ? `<button class="btn pri sm" data-act="sol-orc" data-id="${s.id}">📄 Criar orçamento</button>` : ''}
          <button class="btn sm zap" data-act="sol-zap" data-id="${s.id}">WhatsApp</button>
          ${s.status === 'nova' ? `<button class="btn sm" data-act="sol-st" data-id="${s.id}" data-st="descartada">Descartar</button>` : s.status === 'descartada' ? `<button class="btn sm" data-act="sol-st" data-id="${s.id}" data-st="nova">Reabrir</button>` : ''}
        </div></div>`;
    }).join('') || '<div class="vazio">Nenhum pedido de orçamento aqui.</div>'}</div>`;
}
async function criarOrcamento(id, botao) {
  const s = SOLIC.find(x => x.id === id); if (!s) return;
  botao.disabled = true; botao.textContent = 'Criando…';
  try {
    // cliente no cadastro único da empresa (procura pelo WhatsApp)
    const achados = await ok(db.from('core_clientes').select('id,nome,telefone').eq('empresa_id', EMP).limit(500));
    let cli = achados.find(c => String(c.telefone || '').replace(/\D/g, '').endsWith(s.telefone));
    if (!cli) cli = await ok(db.from('core_clientes').insert({ empresa_id: EMP, nome: s.nome, telefone: foneBR(s.telefone), endereco: s.bairro, cidade: CFG && CFG.cidade || null, observacoes: 'Cliente vindo do site', criado_por: CTX.usuario.id }).select('id,nome').single());
    const prod = s.produto_id && PRODUTOS.find(p => p.id === s.produto_id), ob = s.obra_id && OBRAS.find(o => o.id === s.obra_id);
    const obs = [`Pedido do site ${s.codigo}: ${s.servico} (${s.modalidade})`, s.area ? `Área informada: ${fmtN(s.area)} m²` : '', prod ? `Material escolhido: ${prod.nome}` : '', ob ? `Referência: obra "${ob.titulo}"` : '', s.detalhes ? 'Detalhes do cliente: ' + s.detalhes : ''].filter(Boolean).join('\n');
    const orcId = uid();
    const linha = n => ({ id: orcId, empresa_id: EMP, numero: n, cliente_id: cli.id, cliente_nome: s.nome, local: s.bairro, status: 'rascunho', total: 0, criado_por: CTX.usuario.id,
      dados: { id: orcId, numero: String(n), cliente: s.nome, clienteId: cli.id, foneCliente: foneBR(s.telefone), local: s.bairro, obs, origem: { site: s.codigo } } });
    let n = await P.rpc('orc_proximo_numero', { p_empresa: EMP }) || 1;
    let r = await db.from('orc_orcamentos').insert(linha(n));
    if (r.error && r.error.code === '23505') { n = await P.rpc('orc_proximo_numero', { p_empresa: EMP }); r = await db.from('orc_orcamentos').insert(linha(n)); }
    if (r.error) throw r.error;
    await ok(db.from('loj_solicitacoes').update({ status: 'em_orcamento', orcamento_id: orcId }).eq('id', s.id));
    abrirOrcamento(orcId);
  } catch (e) { botao.disabled = false; botao.textContent = '📄 Criar orçamento'; erro(e); }
}
function abrirOrcamento(orcId) {
  try { localStorage.setItem('orc_atual_' + EMP, orcId); } catch (e) {}
  location.href = '../orcamentos/index.html?empresa=' + EMP;
}

/* ---- OBRAS ---- */
const TIPOS_OBRA = ['Piso vinílico', 'Rodapé PVC', 'Ripado PVC', 'Reforma completa'];
function telaObras() {
  $('#conteudo').innerHTML = `<div class="card"><h2>🏗️ Obras realizadas <button class="btn pri sm dir" data-act="obra-nova">+ Publicar obra</button></h2>
    <p class="sub">Aparecem em "Obras" e "Onde trabalhamos" no site. Publique só com autorização do cliente e use o bairro, nunca o endereço.</p>
    ${OBRAS.map(o => `<div class="prod obra ${o.publicado ? '' : 'oculto'}" style="grid-template-columns:52px minmax(0,1fr) auto">
      <div class="th" style="background-image:url('${esc(o.fotos.find(u => !ehVideo(u)) || '')}')"></div>
      <div class="info"><b>${esc(o.titulo)}</b><small>${esc(o.tipo)} · 📍 ${esc(o.local)} · ${o.fotos.filter(u => !ehVideo(u)).length} foto(s)${[...o.fotos, ...(o.videos || [])].filter(ehVideo).length ? ' · ' + [...o.fotos, ...(o.videos || [])].filter(ehVideo).length + ' vídeo(s)' : ''}</small>${o.publicado ? '' : '<span class="tag">oculta</span>'}</div>
      <div class="acoes"><label class="sw"><input type="checkbox" data-obra-pub="${o.id}" ${o.publicado ? 'checked' : ''}><span>Site</span></label><button class="btn sm" data-act="obra-editar" data-id="${o.id}">Editar</button></div></div>`).join('')
      || '<div class="vazio"><b>Nenhuma obra publicada</b>Mostre fotos reais de antes e depois: é o que mais convence o cliente.</div>'}</div>`;
}
function formObra(id) {
  const o = OBRAS.find(x => x.id === id) || { titulo: '', tipo: TIPOS_OBRA[0], local: '', area: '', prazo: '', descricao: '', fotos: [], produtos: [], publicado: true, autorizado: false };
  edFotos = [...o.fotos, ...(o.videos || [])]; edModo = 'obra';
  const tipos = [...new Set([...TIPOS_OBRA, ...OBRAS.map(x => x.tipo)])];
  abrirModal(`${cab(id ? 'Editar obra' : 'Publicar obra')}
    <form id="fObra" data-id="${id || ''}"><div class="grid">
      <div class="full"><label>Título</label><input name="titulo" required maxlength="120" value="${esc(o.titulo)}" placeholder="Ex.: Sala com piso vinílico amadeirado"></div>
      <div><label>Tipo de serviço</label><input name="tipo" list="dlTipos" required maxlength="60" value="${esc(o.tipo)}"><datalist id="dlTipos">${tipos.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
      <div><label>Bairro / local autorizado</label><input name="local" required maxlength="120" value="${esc(o.local)}" placeholder="Ex.: Adrianópolis"></div>
      <div><label>Metragem</label><input name="area" maxlength="40" value="${esc(o.area)}" placeholder="Ex.: 32 m²"></div>
      <div><label>Prazo de execução</label><input name="prazo" maxlength="40" value="${esc(o.prazo)}" placeholder="Ex.: 2 dias"></div>
      <div class="full"><label>Antes, execução e resultado</label><textarea name="descricao" rows="3" maxlength="2000">${esc(o.descricao)}</textarea></div>
      <div class="full"><label>Fotos e vídeos (na ordem em que aparecem nos detalhes da obra)</label><div class="fotos" id="edFotos"></div>
        <p class="hint">Use ◀ ▶ para colocar cada vídeo onde quiser. A capa do cartão é sempre a primeira <b>foto</b>; vídeo só aparece ao abrir a obra.
        Vídeo até 50 MB (mp4, webm ou mov, ~1 min de celular). Maior que isso: publique no YouTube (pode ser "não listado") e <a href="#" data-act="video-yt">cole o link</a>.</p></div>
      <div class="full"><label>Materiais usados</label>${PRODUTOS.map(p => `<label class="chk" style="padding:4px 0"><input type="checkbox" name="produtos" value="${p.id}" ${o.produtos.includes(p.id) ? 'checked' : ''}> ${esc(p.nome)}</label>`).join('') || '<p class="hint">Cadastre materiais para ligar à obra.</p>'}</div>
      <div class="full"><label class="chk" style="white-space:normal"><input type="checkbox" name="autorizado" required ${o.autorizado ? 'checked' : ''}> Tenho autorização do cliente para publicar as fotos e o local.</label></div>
      <div><label class="sw"><input type="checkbox" name="publicado" ${o.publicado ? 'checked' : ''}><span>Mostrar no site</span></label></div>
    </div>
    <div class="btn-row"><button class="btn pri" id="btnSalvarObra">Salvar</button>${id ? `<button type="button" class="btn perigo" data-act="obra-excluir" data-id="${id}">Excluir</button>` : ''}<button type="button" class="btn" data-act="fechar">Cancelar</button></div></form>`, true);
  desenharFotos();
}
async function salvarObra(form) {
  const id = form.dataset.id, f = new FormData(form), antiga = OBRAS.find(x => x.id === id);
  if (!edFotos.some(u => !ehVideo(u))) return toast('Inclua pelo menos uma foto real da obra (ela vira a capa).');
  const row = { titulo: f.get('titulo').trim(), tipo: f.get('tipo').trim(), local: f.get('local').trim(), area: f.get('area').trim() || null, prazo: f.get('prazo').trim() || null,
    descricao: f.get('descricao').trim() || null, fotos: edFotos.slice(0, 12), videos: [], produtos: f.getAll('produtos'), autorizado: !!f.get('autorizado'), publicado: !!f.get('publicado') };
  $('#btnSalvarObra').disabled = true;
  try {
    if (id) await ok(db.from('loj_obras').update(row).eq('id', id)); else await ok(db.from('loj_obras').insert({ ...row, empresa_id: EMP }));
    if (antiga) await apagarArquivos([...antiga.fotos, ...(antiga.videos || [])].filter(u => !row.fotos.includes(u)));
    edFotos = []; fecharModal();
    OBRAS = await ok(db.from('loj_obras').select('*').eq('empresa_id', EMP).order('criado_em', { ascending: false }));
    render(); toast('✓ Obra salva');
  } catch (e) { $('#btnSalvarObra').disabled = false; erro(e); }
}

/* ---- SITE (configuração) ---- */
async function telaSite() {
  const c = CFG || {};
  let pixOrc = {};
  if (!CFG) {
    try { const m = await ok(db.from('core_empresa_modulos').select('config').eq('empresa_id', EMP).eq('modulo', 'orcamentos').maybeSingle()); pixOrc = (m && m.config && m.config.pix) || {}; } catch (e) {}
  }
  const v = (k, d) => esc(c[k] ?? d ?? '');
  $('#conteudo').innerHTML = `
    ${CFG ? `<div class="card"><h2>🌐 Endereço do site</h2>
      <div class="aviso ${CFG.publicado ? 'ok' : ''}" style="margin-bottom:10px">${CFG.publicado ? '✓ O site está <b>no ar</b>. Toda mudança aparece para o cliente na hora.' : 'O site está <b>fora do ar</b>: só a equipe vê os dados aqui.'}</div>
      <div class="link-site"><span>${esc(linkSite())}</span><button class="btn sm" data-act="copiar-link">Copiar</button><a class="btn sm" href="${esc(linkSite())}" target="_blank" rel="noopener">Abrir</a>
      ${CFG.publicado ? '<button class="btn sm zap" data-act="zap-link">Enviar no WhatsApp</button>' : ''}</div></div>` : ''}
    <div class="card"><h2>⚙️ ${CFG ? 'Configurações do site' : 'Criar o site da empresa'}</h2>
    <form id="fSite"><div class="grid">
      <div><label>Endereço (identificador)</label><input name="slug" required pattern="[a-z0-9][a-z0-9\\-]{1,39}" maxlength="40" value="${v('slug', slugify(CTX.empresa.empresa_nome))}"><p class="hint">Letras minúsculas, números e hífen. Fica: …/site/?l=<b>identificador</b></p></div>
      <div><label>Domínio próprio (opcional)</label><input name="dominio" maxlength="100" placeholder="lojadamary.com.br" value="${v('dominio', '')}"><p class="hint">Sem www e sem https. O domínio precisa estar apontado para o site.</p></div>
      <div><label>Nome no site</label><input name="nome" maxlength="80" value="${v('nome', CTX.empresa.empresa_nome)}"></div>
      <div><label>Cidade</label><input name="cidade" maxlength="80" value="${v('cidade', 'Manaus · AM')}"></div>
      <div><label>WhatsApp comercial</label><input name="whatsapp" inputmode="tel" value="${esc(foneBR(c.whatsapp || ''))}" placeholder="(92) 99999-9999"></div>
      <div class="full"><label>Frase de destaque</label><input name="frase" maxlength="160" value="${v('frase', 'Acabamentos, serviços e obras reais. Tudo em um só lugar.')}"></div>
      <div><label>Chave Pix</label><input name="pix_chave" maxlength="77" value="${v('pix_chave', pixOrc.chave)}"><p class="hint">Sem chave, o site só oferece cartão (link enviado pelo WhatsApp).</p></div>
      <div><label>Nome do recebedor Pix</label><input name="pix_nome" maxlength="25" value="${v('pix_nome', pixOrc.nome)}"></div>
      <div><label>Cidade do recebedor Pix</label><input name="pix_cidade" maxlength="15" value="${v('pix_cidade', pixOrc.cidade || 'MANAUS')}"></div>
      <div><label>Desconto no Pix (%)</label><input name="pix_desconto" inputmode="decimal" value="${inNum(c.pix_desconto ?? 0)}"></div>
      <div><label>Parcelas no cartão</label><input name="parcelas" type="number" min="1" max="12" value="${c.parcelas ?? 3}"></div>
      <div><label>Reserva do pedido (minutos)</label><input name="reserva_min" type="number" min="5" max="1440" value="${c.reserva_min ?? 15}"><p class="hint">Pedido não pago nesse prazo expira e libera o estoque.</p></div>
      <div class="full"><label class="sw"><input type="checkbox" name="publicado" ${c.publicado ? 'checked' : ''}><span>Site no ar (visível para clientes)</span></label></div>
    </div><div class="btn-row"><button class="btn pri" id="btnSite">${CFG ? 'Salvar' : 'Criar site'}</button></div></form></div>
    ${CFG ? cardAparencia() : ''}`;
  if (CFG) desenharTema();
}

/* ---- APARÊNCIA: imagens e textos do topo e do rodapé do site ---- */
let TEMA = null;
const SERVICOS_PADRAO = ['Piso vinílico', 'Rodapé PVC', 'Ripado PVC', 'Reforma completa'];
function temaPadrao() { return { topo: { imagens: [], escurecer: 45, titulo: '' }, rodape: { imagens: [], escurecer: 55, texto: '' },
  servicos: { rotulo: 'Instalação', lista: SERVICOS_PADRAO } }; }
function cardAparencia(t = CFG.tema || {}) {
  const p = temaPadrao();
  TEMA = { topo: { ...p.topo, ...(t.topo || {}) }, rodape: { ...p.rodape, ...(t.rodape || {}) } };
  TEMA.topo.imagens = [...TEMA.topo.imagens]; TEMA.rodape.imagens = [...TEMA.rodape.imagens];
  const sv = { ...p.servicos, ...(t.servicos || {}) };
  TEMA.servicos = { rotulo: sv.rotulo || 'Instalação', texto: (Array.isArray(sv.lista) ? sv.lista : []).join('\n') };
  const bloco = (k, nome, extra) => `<div class="tema-bloco"><h3 style="margin:0 0 6px;color:var(--navy);font-size:15px">${nome}</h3>
      <div class="fotos larga" id="tema-${k}"></div>
      <div class="grid" style="margin-top:10px">
        <div><label>Escurecer a imagem: <b id="esc-${k}">${TEMA[k].escurecer}%</b></label><input type="range" min="0" max="85" step="5" value="${TEMA[k].escurecer}" data-tema-esc="${k}" style="height:auto;padding:0;background:none;border:none"><p class="hint">Mais escuro = texto mais fácil de ler.</p></div>
        ${extra}
      </div></div>`;
  return `<div class="card"><h2>🎨 Aparência do site <a class="btn sm dir" href="${esc(linkSite())}" target="_blank" rel="noopener">Ver no site</a></h2>
    <p class="sub">Escolha as imagens de fundo do topo e do rodapé (até 6 em cada; com mais de uma, elas se alternam devagar). Use fotos largas e de boa qualidade das suas obras.</p>
    ${bloco('topo', 'Topo (primeira coisa que o cliente vê)', `<div><label>Título grande</label><input maxlength="80" data-tema-txt="topo.titulo" value="${esc(TEMA.topo.titulo)}" placeholder="Do material à instalação."><p class="hint">A frase menor embaixo é a "Frase de destaque" acima.</p></div>`)}
    <hr style="border:none;border-top:1px solid var(--line);margin:16px 0">
    ${bloco('rodape', 'Rodapé (final da página)', `<div class="full"><label>Texto do rodapé (opcional)</label><textarea rows="2" maxlength="300" data-tema-txt="rodape.texto" placeholder="Ex.: Atendemos toda Manaus. Seg. a sáb., 8h às 18h.">${esc(TEMA.rodape.texto)}</textarea></div>`)}
    <hr style="border:none;border-top:1px solid var(--line);margin:16px 0">
    <div class="tema-bloco"><h3 style="margin:0 0 6px;color:var(--navy);font-size:15px">Serviços</h3>
      <div class="grid">
        <div><label>Nome do serviço</label><input maxlength="30" data-tema-txt="servicos.rotulo" value="${esc(TEMA.servicos.rotulo)}" placeholder="Instalação"><p class="hint">Ex.: Instalação, Montagem, Entrega, Pintura. Aparece nos botões e no topo do site.</p></div>
        <div class="full"><label>Serviços oferecidos (um por linha)</label><textarea rows="4" data-tema-txt="servicos.texto" placeholder="Piso vinílico&#10;Rodapé PVC">${esc(TEMA.servicos.texto)}</textarea><p class="hint">Deixe vazio se a loja só vende produtos: a aba Serviços e os botões de serviço somem do site.</p></div>
      </div></div>
    <div class="btn-row"><button class="btn pri" data-act="tema-salvar">Salvar aparência</button><button class="btn" data-act="tema-limpar">Voltar ao padrão</button></div></div>`;
}
function desenharTema() {
  ['topo', 'rodape'].forEach(k => {
    const box = $('#tema-' + k); if (!box) return;
    const l = TEMA[k].imagens;
    box.innerHTML = l.map((u, i) => `<div class="f" style="background-image:url('${esc(u)}')">${i === 0 ? '<span class="selo capa">1ª</span>' : ''}
        <button type="button" data-act="tema-del" data-k="${k}" data-i="${i}" aria-label="Remover">×</button>
        ${l.length > 1 ? `<div class="ord">${i > 0 ? `<button type="button" data-act="tema-esq" data-k="${k}" data-i="${i}" aria-label="Mover para a esquerda">◀</button>` : ''}${i < l.length - 1 ? `<button type="button" data-act="tema-dir" data-k="${k}" data-i="${i}" aria-label="Mover para a direita">▶</button>` : ''}</div>` : ''}</div>`).join('')
      + (l.length < 6 ? `<label class="add"><b>＋</b>Adicionar imagem<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-tema-up="${k}"></label>` : '')
      + (!l.length ? '<p class="hint" style="align-self:center;margin:0">Sem imagem: fica o fundo escuro padrão.</p>' : '');
  });
}
async function enviarTema(k, files) {
  const lista = [...files].slice(0, 6 - TEMA[k].imagens.length); if (!lista.length) return;
  for (const f of lista) {
    try {
      toast('Enviando imagem…', 10000);
      const blob = await reduzir(f, 2000, 0.8);
      const caminho = `${EMP}/tema/${uid()}.jpg`;
      await ok(db.storage.from('loja').upload(caminho, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }));
      TEMA[k].imagens.push(db.storage.from('loja').getPublicUrl(caminho).data.publicUrl); desenharTema();
    } catch (e) { erro(e); }
  }
  toast('Imagem pronta. Clique em "Salvar aparência".');
}
async function salvarTema() {
  const antigo = CFG.tema || {};
  const novo = { topo: { imagens: TEMA.topo.imagens, escurecer: TEMA.topo.escurecer, titulo: TEMA.topo.titulo.trim() },
                 rodape: { imagens: TEMA.rodape.imagens, escurecer: TEMA.rodape.escurecer, texto: TEMA.rodape.texto.trim() },
                 servicos: { rotulo: TEMA.servicos.rotulo.trim().slice(0, 30) || 'Instalação',
                   lista: [...new Set(TEMA.servicos.texto.split('\n').map(x => x.trim().slice(0, 60)).filter(Boolean))].slice(0, 20) } };
  try {
    CFG = await ok(db.from('loj_config').update({ tema: novo }).eq('empresa_id', EMP).select().single());
    const usadas = [...novo.topo.imagens, ...novo.rodape.imagens];
    await apagarArquivos([...((antigo.topo || {}).imagens || []), ...((antigo.rodape || {}).imagens || [])].filter(u => !usadas.includes(u)));
    toast(CFG.publicado ? '✓ Aparência salva. Já está no site.' : '✓ Aparência salva.');
  } catch (e) {
    if (/tema/.test(e.message || '') && /column|coluna/i.test(e.message || '')) toast('Rode a migração 012_loja_aparencia.sql no Supabase primeiro.', 6000); else erro(e);
  }
}
async function salvarSite(form) {
  const f = new FormData(form);
  let zap = String(f.get('whatsapp') || '').replace(/\D/g, ''); if (/^55\d{10,11}$/.test(zap)) zap = zap.slice(2);
  if (zap && !/^\d{10,11}$/.test(zap)) return toast('WhatsApp: informe DDD + número.');
  const dominio = String(f.get('dominio') || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (dominio && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(dominio)) return toast('Domínio inválido. Ex.: lojadamary.com.br');
  const row = { slug: slugify(f.get('slug')), nome: f.get('nome').trim() || null, cidade: f.get('cidade').trim() || null, frase: f.get('frase').trim() || null,
    whatsapp: zap || null, pix_chave: chavePix(f.get('pix_chave')) || null, pix_nome: f.get('pix_nome').trim() || null, pix_cidade: f.get('pix_cidade').trim() || null,
    pix_desconto: Math.min(50, Math.max(0, toNum(f.get('pix_desconto')))), parcelas: Math.min(12, Math.max(1, parseInt(f.get('parcelas'), 10) || 1)),
    reserva_min: Math.min(1440, Math.max(5, parseInt(f.get('reserva_min'), 10) || 15)), publicado: !!f.get('publicado') };
  // só grava o domínio se a coluna já existe (migração 013 rodada) ou se foi preenchido
  if (dominio || (CFG && 'dominio' in CFG)) row.dominio = dominio || null;
  if (row.publicado && !PRODUTOS.some(p => p.publicado) && !confirm('Nenhum material está marcado para aparecer no site. Colocar no ar mesmo assim?')) return;
  $('#btnSite').disabled = true;
  try {
    CFG = CFG ? await ok(db.from('loj_config').update(row).eq('empresa_id', EMP).select().single())
              : await ok(db.from('loj_config').insert({ ...row, empresa_id: EMP }).select().single());
    render(); toast(CFG.publicado ? '✓ Salvo. O site já mostra as mudanças.' : '✓ Salvo');
  } catch (e) {
    $('#btnSite').disabled = false;
    if (e.code === '23505') toast('Esse endereço ou domínio já é usado por outra empresa. Escolha outro.', 5000); else erro(e);
  }
}

/* chave Pix como o banco espera: CNPJ/CPF só números; celular com +55 */
function chavePix(k) {
  k = String(k || '').trim();
  const d = k.replace(/\D/g, '');
  if (/^[\d.\-\/\s]+$/.test(k) && (d.length === 14 || d.length === 11) && /[.\-\/]/.test(k)) return d;
  if (/^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(k)) return '+55' + d;
  return k;
}

/* ---------------- tempo real (pedidos chegando) ---------------- */
function escutar() {
  db.channel('loja-equipe-' + EMP)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loj_pedidos', filter: 'empresa_id=eq.' + EMP }, async ev => {
      if (ev.eventType === 'INSERT') { UI.novos.add(ev.new.id); toast(`🛒 Novo pedido no site: ${ev.new.codigo} · ${money(ev.new.total)}`, 6000); avisar('Novo pedido no site', ev.new.codigo + ' · ' + money(ev.new.total)); }
      await recarregarPedidos(); await recarregarProdutos(); if (!$('#modal').hidden) return contadores(); render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'loj_solicitacoes', filter: 'empresa_id=eq.' + EMP }, async ev => {
      if (ev.eventType === 'INSERT') { UI.novos.add(ev.new.id); toast(`💬 Novo pedido de orçamento: ${ev.new.servico} · ${ev.new.bairro}`, 6000); avisar('Pedido de orçamento', ev.new.nome + ' · ' + ev.new.servico); }
      await recarregarPedidos(); if (!$('#modal').hidden) return contadores(); render();
    })
    .subscribe();
}
function avisar(titulo, corpo) {
  try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(titulo, { body: corpo, icon: P.raiz + 'icons/icon-192.png' }); } catch (e) {}
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', async e => {
  const ab = e.target.closest('#abas button');
  if (ab) { UI.aba = ab.dataset.aba; render(); scrollTo({ top: 0 }); return; }
  if (e.target.id === 'modal') return fecharModal();
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.tagName === 'A' && b.getAttribute('href') === '#') e.preventDefault();
  const id = b.dataset.id, i = +b.dataset.i;
  try {
    switch (b.dataset.act) {
      case 'fechar': return fecharModal();
      case 'aba': e.preventDefault(); UI.aba = b.dataset.aba; return render();
      case 'prod-novo': return formProduto(null);
      case 'prod-editar': return formProduto(id);
      case 'prod-excluir': return await excluirProduto(id);
      case 'prod-exemplos': b.disabled = true; return await usarExemplos();
      case 'foto-del': edFotos.splice(i, 1); return desenharFotos();
      case 'foto-esq': [edFotos[i - 1], edFotos[i]] = [edFotos[i], edFotos[i - 1]]; return desenharFotos();
      case 'foto-dir': [edFotos[i + 1], edFotos[i]] = [edFotos[i], edFotos[i + 1]]; return desenharFotos();
      case 'foto-url': { e.preventDefault(); const u = (prompt('Cole o link (https://…) da imagem:') || '').trim(); if (!u) return;
        if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return toast('O link precisa começar com https://');
        if (edFotos.length >= (edModo === 'obra' ? 12 : 8)) return toast('Máximo atingido.'); edFotos.push(u); return desenharFotos(); }
      case 'video-yt': { e.preventDefault(); const u = (prompt('Cole o link do vídeo no YouTube:') || '').trim(); if (!u) return;
        if (!ytId(u)) return toast('Use um link de vídeo do YouTube (https://youtube.com/… ou https://youtu.be/…).');
        if (edFotos.filter(ehVideo).length >= 3) return toast('Máximo de 3 vídeos por obra.');
        if (edFotos.length >= 12) return toast('Máximo atingido.'); edFotos.push(u); return desenharFotos(); }
      case 'tema-del': TEMA[b.dataset.k].imagens.splice(i, 1); return desenharTema();
      case 'tema-esq': { const l = TEMA[b.dataset.k].imagens; [l[i - 1], l[i]] = [l[i], l[i - 1]]; return desenharTema(); }
      case 'tema-dir': { const l = TEMA[b.dataset.k].imagens; [l[i + 1], l[i]] = [l[i], l[i + 1]]; return desenharTema(); }
      case 'tema-salvar': b.disabled = true; await salvarTema(); b.disabled = false; return;
      case 'tema-limpar': if (!confirm('Tirar as imagens e textos e voltar ao visual padrão? (só vale depois de "Salvar aparência")')) return;
        b.closest('.card').outerHTML = cardAparencia({}); desenharTema(); return toast('Clique em "Salvar aparência" para aplicar.');
      case 'fped': UI.fPed = b.dataset.f; return render();
      case 'fsol': UI.fSol = b.dataset.f; return render();
      case 'ped-st': return await mudarStatus(id, b.dataset.st);
      case 'ped-zap': return zapPedido(id);
      case 'conf': return;
      case 'sol-orc': return await criarOrcamento(id, b);
      case 'sol-abrir': return abrirOrcamento(SOLIC.find(s => s.id === id).orcamento_id);
      case 'sol-zap': { const s = SOLIC.find(x => x.id === id); return abrirWhats(s.telefone, `Olá, ${s.nome}! Aqui é da ${CFG && CFG.nome || CTX.empresa.empresa_nome}. Recebemos seu pedido de orçamento de ${s.servico} (${s.bairro}). Podemos combinar uma visita?`); }
      case 'sol-st': { await ok(db.from('loj_solicitacoes').update({ status: b.dataset.st }).eq('id', id)); await recarregarPedidos(); return render(); }
      case 'obra-nova': return formObra(null);
      case 'obra-editar': return formObra(id);
      case 'obra-excluir': { const o = OBRAS.find(x => x.id === id); if (!confirm(`Excluir a obra "${o.titulo}"?`)) return;
        await ok(db.from('loj_obras').delete().eq('id', id)); await apagarArquivos([...o.fotos, ...(o.videos || [])]); OBRAS = OBRAS.filter(x => x.id !== id); fecharModal(); render(); return toast('Obra excluída.'); }
      case 'copiar-link': try { await navigator.clipboard.writeText(linkSite()); toast('Link copiado!'); } catch (_) { prompt('Copie o link:', linkSite()); } return;
      case 'zap-link': return abrirWhats('', `Conheça nossos materiais e obras, com preço e estoque atualizados: ${linkSite()}`);
    }
  } catch (err) { erro(err); }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.campo) return salvarCampo(el);
  if (el.dataset.temaUp) { const fs = [...el.files]; el.value = ''; return enviarTema(el.dataset.temaUp, fs); }
  if (el.id === 'inFotos') { const fs = [...el.files]; el.value = ''; return enviarFotos(fs); }
  if (el.dataset.act === 'conf') return conferir(el.dataset.id, +el.dataset.j, el.checked);
  if (el.dataset.obraPub) {
    try { await ok(db.from('loj_obras').update({ publicado: el.checked }).eq('id', el.dataset.obraPub)); const o = OBRAS.find(x => x.id === el.dataset.obraPub); o.publicado = el.checked; render(); toast('✓ Atualizado no site'); }
    catch (err) { el.checked = !el.checked; erro(err); }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset && e.target.dataset.campo && e.target.dataset.campo !== 'publicado') { e.preventDefault(); e.target.blur(); } if (e.key === 'Escape' && !$('#modal').hidden) fecharModal(); });
document.addEventListener('input', e => {
  if (e.target.dataset.temaEsc) { const k = e.target.dataset.temaEsc; TEMA[k].escurecer = +e.target.value; $('#esc-' + k).textContent = e.target.value + '%'; return; }
  if (e.target.dataset.temaTxt) { const [k, c] = e.target.dataset.temaTxt.split('.'); TEMA[k][c] = e.target.value; return; }
  if (e.target.id === 'busca') { UI.busca = e.target.value; const pos = e.target.selectionStart; render(); const n = $('#busca'); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'fProd') return salvarProduto(f);
  if (f.id === 'fObra') return salvarObra(f);
  if (f.id === 'fSite') return salvarSite(f);
});

/* ---------------- início ---------------- */
(async function iniciar() {
  try {
    CTX = await P.exigirModulo('loja'); if (!CTX) return;
    EMP = CTX.empresa.empresa_id;
    P.barraModulo(CTX, 'Loja / Site');
    await carregarTudo();
    if (!CFG) UI.aba = 'site';
    render();
    escutar();
    setInterval(async () => { if (document.hidden) return; const n = await P.rpc('loj_expirar_minha', { p_empresa: EMP }).catch(() => 0); if (n) { await recarregarPedidos(); await recarregarProdutos(); if ($('#modal').hidden) render(); } }, 60000);
    if ('Notification' in window && Notification.permission === 'default') document.addEventListener('click', () => Notification.requestPermission().catch(() => {}), { once: true });
  } catch (e) {
    console.error(e);
    $('#conteudo').innerHTML = `<div class="card"><h2>Não foi possível abrir</h2><p class="sub">${esc(e.message || e)}</p>
      <p class="hint">Se for a primeira vez, rode <b>supabase/migrations/010_loja_site.sql</b> no SQL Editor do Supabase e ligue "Loja / Site" em Administração.</p></div>`;
  }
})();
})();
