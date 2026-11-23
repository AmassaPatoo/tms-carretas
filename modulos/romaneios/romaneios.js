/* =====================================================================
   PLATAFORMA KE — MÓDULO ROMANEIOS
   Pega o pedido/nota do fornecedor e gera um documento da SUA empresa
   (nome, CNPJ, seus preços) para quem vai entregar ou fazer o serviço.
   O custo do fornecedor fica só aqui dentro: nunca vai para o PDF.
===================================================================== */
(() => {
'use strict';
const P = window.Plataforma, db = P.db, esc = P.esc;
const $ = s => document.querySelector(s);
let CTX = null, EMP = null, EMPRESA = {}, CFG = { endereco: '', margem: '30' };
let doc = null, salvoNoBanco = false, lista = [], clientes = [], anexo = null;

/* ---------------- utilitários ---------------- */
function hojeISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const money = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pad4 = n => String(n || 0).padStart(4, '0');
function toNum(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}
const inNum = v => v ? String(Math.round(v * 100) / 100).replace('.', ',') : '';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Math.random().toString(36).slice(2) + Date.now());
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800); }
function abrirModal(html, largo) { $('#modalBox').className = 'modal-box' + (largo ? ' largo' : ''); $('#modalBox').innerHTML = html; $('#modal').hidden = false; document.body.classList.add('lock'); }
function fecharModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; document.body.classList.remove('lock'); }
const cab = t => `<h3>${t}<button class="x" data-act="fechar" aria-label="Fechar">×</button></h3>`;
async function ok(p) { const { data, error } = await p; if (error) throw error; return data; }
function erro(e) { console.error(e); toast('Erro: ' + (e && e.message || e)); }
function primeiroFone(f) {
  const partes = String(f || '').split(/\s*(?:\/|,|;|\||\be\b|\bou\b)\s*/i).map(p => p.replace(/\D/g, '')).filter(p => p.length >= 10);
  let d = partes[0] || ''; if (d.length === 10 || d.length === 11) d = '55' + d;
  return (d.length === 12 || d.length === 13) ? d : '';
}
function ehCelular() { return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && matchMedia('(pointer:coarse)').matches); }
function abrirWhats(fone, texto) {
  const t = encodeURIComponent(texto || '');
  if (ehCelular()) return window.open('https://wa.me/' + (fone || '') + '?text=' + t, '_blank');
  window.open('https://web.whatsapp.com/send?' + (fone ? 'phone=' + fone + '&' : '') + 'text=' + t, 'ke-whatsapp');
}

/* ---------------- documento ---------------- */
const novoItem = () => ({ id: uid(), desc: '', qtd: '1', un: 'un', custo: '', venda: '' });
function novoDoc(numero) {
  return { id: uid(), numero: numero || 1, tipo: 'entrega', data: hojeISO(), previsao: '',
    cliente: '', clienteId: null, foneCliente: '', endereco: '', responsavel: '', foneResp: '',
    itens: [novoItem()], mostrarPrecos: true, obs: '', fonte: { fornecedor: '', numero: '', obs: '' } };
}
const itemTotal = i => toNum(i.qtd) * toNum(i.venda);
const itemCusto = i => toNum(i.qtd) * toNum(i.custo);
function totais() {
  const its = doc.itens.filter(i => i.desc.trim() || toNum(i.venda) || toNum(i.custo));
  const venda = its.reduce((s, i) => s + itemTotal(i), 0), custo = its.reduce((s, i) => s + itemCusto(i), 0);
  return { venda, custo, lucro: venda - custo, temCusto: its.some(i => toNum(i.custo) > 0) };
}
async function proximoNumero() { return (await P.rpc('rom_proximo_numero', { p_empresa: EMP })) || 1; }

let tSalvar = null;
function salvar() { clearTimeout(tSalvar); tSalvar = setTimeout(() => persistir().catch(erro), 800); }
async function persistir() {
  if (!doc) return;
  const t = totais();
  const vazio = !doc.cliente.trim() && t.venda <= 0 && !doc.itens.some(i => i.desc.trim());
  if (vazio && !salvoNoBanco) return;
  const row = { id: doc.id, empresa_id: EMP, numero: doc.numero, tipo: doc.tipo, data: doc.data || hojeISO(),
    cliente_id: doc.clienteId || null, cliente_nome: doc.cliente.trim() || null, total: Math.round(t.venda * 100) / 100, dados: doc };
  const { error } = await db.from('rom_documentos').upsert(row);
  if (error && error.code === '23505') { doc.numero = await proximoNumero(); return persistir(); }
  if (error) throw error;
  salvoNoBanco = true;
}

/* ---------------- importar do fornecedor ---------------- */
let pdfjs = null;
function carregarPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = '../../vendor/pdfjs/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../../vendor/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => { pdfjs = null; rej(new Error('pdf.js não carregou')); };
    document.head.appendChild(s);
  });
  return pdfjs;
}
/* Lê o texto do PDF e monta as linhas (agrupando pela altura na página) */
async function linhasDoPdf(buf) {
  const L = await carregarPdfjs();
  const pdf = await L.getDocument({ data: buf }).promise;
  const linhas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pg = await pdf.getPage(p), tc = await pg.getTextContent();
    const grupos = [];
    tc.items.forEach(it => {
      const s = it.str; if (!s || !s.trim()) return;
      const x = it.transform[4], y = it.transform[5];
      let g = grupos.find(g => Math.abs(g.y - y) < 3);
      if (!g) { g = { y, partes: [] }; grupos.push(g); }
      g.partes.push({ x, s });
    });
    grupos.sort((a, b) => b.y - a.y).forEach(g => {
      g.partes.sort((a, b) => a.x - b.x);
      linhas.push({ y: g.y + (pdf.numPages - p) * 10000, txt: g.partes.map(q => q.s.trim()).join('  ') });
    });
  }
  pdf.destroy();
  return linhas;
}
const RE_MONEY = /R\$\s*([\d.]+,\d{2})/g;
const RE_UN = /\b(UNID|UND|UN|M2|M²|ML|KG|CX|CAIXA|PCT|PC|PÇ|PÇS|BARRA|BR|RL|ROLO|LT|LATA|BALDE|GL|SC|SACO|M)\b/i;
const UNMAP = { UNID: 'un', UND: 'un', UN: 'un', M2: 'm²', 'M²': 'm²', ML: 'm', M: 'm', KG: 'kg', CX: 'cx', CAIXA: 'cx', PCT: 'pct', PC: 'pç', 'PÇ': 'pç', 'PÇS': 'pç', BARRA: 'barra', BR: 'barra', RL: 'rolo', ROLO: 'rolo', LT: 'lata', LATA: 'lata', BALDE: 'balde', GL: 'galão', SC: 'saco', SACO: 'saco' };
/* Tenta achar os itens: linha com quantidade e valores em R$; o texto vizinho vira a descrição */
function extrairItens(linhas) {
  let ini = linhas.findIndex(l => /produto|descri/i.test(l.txt) && /(qtd|qtde|quant)/i.test(l.txt));
  let fim = linhas.findIndex((l, i) => i > ini && /^(\s*)(total|qtde\.? total|subtotal|valor total|condi)/i.test(l.txt));
  if (ini < 0) ini = -1; if (fim < 0) fim = linhas.length;
  const area = linhas.slice(ini + 1, fim);
  const itens = [], soltas = [];
  area.forEach(l => {
    const valores = [...l.txt.matchAll(RE_MONEY)].map(m => toNum(m[1]));
    const antes = l.txt.split('R$')[0];
    const nums = antes.match(/\d+(?:[.,]\d+)?/g) || [];
    if (valores.length && nums.length) {
      const qtd = toNum(nums[nums.length - 1]);
      const ult = valores[valores.length - 1];
      let unit = valores.find(v => qtd > 0 && Math.abs(qtd * v - ult) <= Math.max(0.05, ult * 0.01));
      if (unit == null) unit = valores.length >= 3 ? valores[valores.length - 2] : valores[0];
      const un = (l.txt.match(RE_UN) || [])[1];
      // descrição: texto antes da quantidade, sem o número do item e sem códigos
      let desc = antes.replace(new RegExp(nums[nums.length - 1].replace(/[.,]/g, '\\$&') + '\\s*$'), '');
      desc = desc.replace(/^\s*\d{1,3}\s+/, '').split(/\s{2,}/).filter(p => !/^[A-Z]{2,5}-$|^\d{2,6}-\d{1,2}$|^\d{4,}$/.test(p.trim())).join(' ');
      itens.push({ y: l.y, desc: desc.replace(RE_UN, '').trim(), qtd, unit, un: un ? (UNMAP[un.toUpperCase()] || 'un') : 'un', extra: [] });
    } else soltas.push(l);
  });
  // cada linha solta vai para o item mais próximo (descrição quebrada em várias linhas)
  soltas.forEach(l => {
    if (!itens.length || /^(#|c[oó]digo|produto)/i.test(l.txt)) return;
    let m = itens[0]; itens.forEach(i => { if (Math.abs(i.y - l.y) < Math.abs(m.y - l.y)) m = i; });
    if (Math.abs(m.y - l.y) < 40) m.extra.push(l);
  });
  return itens.map(i => {
    const acima = i.extra.filter(l => l.y > i.y).sort((a, b) => b.y - a.y).map(l => l.txt);
    const abaixo = i.extra.filter(l => l.y < i.y).sort((a, b) => b.y - a.y).map(l => l.txt);
    const limpa = t => t.split(/\s{2,}/).filter(p => !/^[A-Z]{2,5}-$|^\d{2,6}-\d{1,2}$|^\d{4,}$/.test(p.trim())).join(' ');
    const desc = [...acima, i.desc, ...abaixo].map(limpa).join(' ').replace(/\s+/g, ' ').replace(/\s*-\s*$/, '').trim();
    return { id: uid(), desc, qtd: inNum(i.qtd) || '1', un: i.un, custo: inNum(i.unit), venda: '' };
  }).filter(i => i.desc || toNum(i.custo));
}
function infoFornecedor(linhas) {
  const txt = linhas.map(l => l.txt).join('\n');
  const num = (txt.match(/(?:or[çc]amento|pedido|venda|nota)\s*(?:n[ºo°.]*|n[uú]mero)?\s*:?\s*(\d{3,})/i) || [])[1] || '';
  const forn = linhas.slice(0, 3).map(l => l.txt).find(t => /[A-Z]{3,}/.test(t) && !/^\d/.test(t)) || '';
  return { fornecedor: forn.split(/\s{2,}/)[0].slice(0, 120), numero: num };
}
async function importarArquivo(arq) {
  if (!arq) return;
  if (anexo && anexo.url) URL.revokeObjectURL(anexo.url);
  anexo = { nome: arq.name, tipo: arq.type, url: URL.createObjectURL(arq) };
  if (/pdf/i.test(arq.type) || /\.pdf$/i.test(arq.name)) {
    try {
      const linhas = await linhasDoPdf(new Uint8Array(await arq.arrayBuffer()));
      const its = extrairItens(linhas), inf = infoFornecedor(linhas);
      if (!doc.fonte.fornecedor) doc.fonte.fornecedor = inf.fornecedor;
      if (!doc.fonte.numero) doc.fonte.numero = inf.numero;
      if (its.length) {
        const m = toNum(CFG.margem);
        its.forEach(i => { if (m > 0 && toNum(i.custo)) i.venda = inNum(Math.round(toNum(i.custo) * (1 + m / 100) * 100) / 100); });
        doc.itens = doc.itens.filter(i => i.desc.trim() || toNum(i.custo) || toNum(i.venda)).concat(its);
        toast(`${its.length} item(ns) lido(s) do PDF. Confira as descrições, quantidades e preços.`);
      } else toast('Não consegui ler os itens desse PDF. Digite os itens olhando o documento ao lado.');
    } catch (e) { erro(e); }
  } else toast('Foto anexada: digite os itens olhando a imagem. (A foto não é salva nem vai para o PDF.)');
  render(); salvar();
}

/* ---------------- telas ---------------- */
function render() {
  if (!doc) return;
  const t = totais();
  const opCli = clientes.map(c => `<option value="${esc(c.nome)}">`).join('');
  $('#conteudo').innerHTML = `
  <section class="card privado">
    <h2>📎 Pedido do fornecedor <span class="tag lar">🔒 só você vê</span></h2>
    <div class="sub">Anexe o PDF do pedido/orçamento do fornecedor: os itens, quantidades e custos são lidos sozinhos. Foto de nota também pode ser anexada para você digitar olhando. Nada daqui vai para o documento do cliente.</div>
    <div class="importar">
      <label class="drop" id="drop"><b>📄 Escolher PDF ou foto</b>ou arraste o arquivo aqui<input type="file" id="arq" accept="application/pdf,image/*" hidden></label>
      <div style="flex:1;min-width:220px">
        <div class="grid">
          <div><label>Fornecedor</label><input data-k="fonte.fornecedor" value="${esc(doc.fonte.fornecedor)}" placeholder="Ex.: Ferragens Rebelo"></div>
          <div><label>Nº do pedido/nota</label><input data-k="fonte.numero" value="${esc(doc.fonte.numero)}" placeholder="Ex.: 36730"></div>
        </div>
        <div class="grid" style="margin-top:10px"><div><label>Margem padrão (%)</label><input id="margem" inputmode="decimal" value="${esc(CFG.margem)}"><div class="hint">Preço de venda = custo + margem, quando você não digita o preço.</div></div></div>
      </div>
    </div>
    ${anexo ? `<div class="hint" style="margin-top:10px">Anexo: <b>${esc(anexo.nome)}</b> <button class="btn sm" data-act="tirar-anexo">✕ tirar</button></div>
      <div class="anexo-wrap">${/image/.test(anexo.tipo) ? `<img class="anexo" src="${anexo.url}" alt="Documento do fornecedor">` : `<iframe class="anexo" src="${anexo.url}#toolbar=0" style="width:100%;height:420px"></iframe>`}</div>` : ''}
  </section>

  <section class="card">
    <h2>🧾 Documento da sua empresa</h2>
    <div class="sub">Sai com o nome, CNPJ e telefone da <b>${esc(EMPRESA.nome || CTX.empresa.empresa_nome)}</b>${EMPRESA.documento ? ' (' + esc(EMPRESA.documento) + ')' : ''}.</div>
    <div class="grid">
      <div class="full"><label>Tipo</label><div class="seg">
        <button data-act="tipo" data-v="entrega" class="${doc.tipo === 'entrega' ? 'on' : ''}">🚚 Romaneio de entrega</button>
        <button data-act="tipo" data-v="servico" class="${doc.tipo === 'servico' ? 'on' : ''}">🛠️ Ordem de serviço</button></div></div>
      <div><label>Nº</label><input data-k="numero" inputmode="numeric" value="${doc.numero}"></div>
      <div><label>Data</label><input type="date" data-k="data" value="${doc.data}"></div>
      <div><label>${doc.tipo === 'entrega' ? 'Previsão de entrega' : 'Data do serviço'}</label><input type="date" data-k="previsao" value="${doc.previsao}"></div>
      <div class="full"><label>Cliente</label><input data-k="cliente" list="dlCli" value="${esc(doc.cliente)}" placeholder="Nome do cliente"><datalist id="dlCli">${opCli}</datalist></div>
      <div><label>Telefone do cliente</label><input data-k="foneCliente" inputmode="tel" value="${esc(doc.foneCliente)}"></div>
      <div class="full"><label>Endereço de ${doc.tipo === 'entrega' ? 'entrega' : 'execução'}</label><input data-k="endereco" value="${esc(doc.endereco)}" placeholder="Rua, nº, bairro, referência"></div>
      <div><label>${doc.tipo === 'entrega' ? 'Quem vai entregar' : 'Quem vai fazer o serviço'}</label><input data-k="responsavel" value="${esc(doc.responsavel)}" placeholder="Nome"></div>
      <div><label>WhatsApp de quem vai</label><input data-k="foneResp" inputmode="tel" value="${esc(doc.foneResp)}"></div>
    </div>
  </section>

  <section class="card">
    <h2>📦 Itens</h2>
    <div class="sub">A coluna <b style="color:var(--orange-ink)">Custo</b> é só para você calcular o lucro: no documento sai apenas o <b>seu preço</b>.</div>
    <div class="it-head"><span>Descrição</span><span class="n">Qtd</span><span>Un</span><span class="n custo-h">🔒 Custo un.</span><span class="n">Seu preço un.</span><span class="n">Total</span><span></span></div>
    <div id="itens">${doc.itens.map(i => `<div class="it-row" data-id="${i.id}">
      <input class="d" data-f="desc" value="${esc(i.desc)}" placeholder="Descrição do item">
      <input class="n" data-f="qtd" inputmode="decimal" value="${esc(i.qtd)}" placeholder="Qtd">
      <input data-f="un" value="${esc(i.un)}" placeholder="un" list="dlUn">
      <input class="n custo" data-f="custo" inputmode="decimal" value="${esc(i.custo)}" placeholder="🔒 custo">
      <input class="n" data-f="venda" inputmode="decimal" value="${esc(i.venda)}" placeholder="seu preço">
      <span class="tot">${money(itemTotal(i))}</span>
      <button class="x" data-act="del-item" title="Remover">×</button></div>`).join('')}</div>
    <datalist id="dlUn">${['un', 'm²', 'm', 'cx', 'pç', 'pct', 'kg', 'barra', 'lata', 'balde', 'rolo', 'saco', 'placa'].map(u => `<option value="${u}">`).join('')}</datalist>
    <div class="btn-row"><button class="btn" data-act="add-item">＋ Adicionar item</button><button class="btn" data-act="aplicar-margem">％ Aplicar margem nos itens sem preço</button></div>
    <div class="resumo">
      <div class="tile"><small>Total do documento</small><b id="rTotal">${money(t.venda)}</b></div>
      ${t.temCusto ? `<div class="tile priv"><small>🔒 Custo do fornecedor</small><b id="rCusto">${money(t.custo)}</b></div>
      <div class="tile priv"><small>🔒 Seu lucro</small><b id="rLucro" style="color:${t.lucro >= 0 ? 'var(--ok)' : 'var(--danger)'}">${money(t.lucro)}${t.venda ? ` <span style="font-size:13px">(${(t.lucro / t.venda * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)</span>` : ''}</b></div>` : ''}
    </div>
  </section>

  <section class="card">
    <h2>📄 No documento</h2>
    <label class="chk" style="font-size:14px;color:var(--ink)"><input type="checkbox" id="mostrarPrecos"${doc.mostrarPrecos ? ' checked' : ''}> Mostrar os preços (desmarque para sair só a lista de itens e quantidades)</label>
    <div style="margin-top:10px"><label>Observações</label><textarea data-k="obs" rows="3" placeholder="Ex.: entregar após as 14h; conferir as caixas na entrega">${esc(doc.obs)}</textarea></div>
    <div class="aviso-fiscal">ℹ️ Este documento é um <b>romaneio / ordem de serviço</b> da sua empresa, com o aviso "Documento sem valor fiscal". Ele não substitui a nota fiscal, que só é emitida pelo sistema da Sefaz.</div>
  </section>`;
  $('#barra').hidden = false;
  atualizarTotais();
}
function atualizarTotais() {
  const t = totais();
  $('#bTotal').textContent = money(t.venda);
  $('#bLucro').textContent = t.temCusto ? `🔒 lucro ${money(t.lucro)}` : '';
  document.querySelectorAll('.it-row').forEach(r => { const i = doc.itens.find(x => x.id === r.dataset.id); if (i) r.querySelector('.tot').textContent = money(itemTotal(i)); });
  const rt = $('#rTotal'); if (rt) rt.textContent = money(t.venda);
  const rc = $('#rCusto'); if (rc) rc.textContent = money(t.custo);
  const rl = $('#rLucro'); if (rl) { rl.innerHTML = money(t.lucro) + (t.venda ? ` <span style="font-size:13px">(${(t.lucro / t.venda * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)</span>` : ''); rl.style.color = t.lucro >= 0 ? 'var(--ok)' : 'var(--danger)'; }
  document.title = `${doc.tipo === 'entrega' ? 'Romaneio' : 'OS'} ${pad4(doc.numero)} · ${doc.cliente || 'Romaneios'}`;
}

/* ---------------- PDF ---------------- */
function nomeArquivo() {
  const c = (doc.cliente || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${doc.tipo === 'entrega' ? 'Romaneio' : 'OS'}-${pad4(doc.numero)}-${c}.pdf`;
}
function gerarPDF() {
  const J = window.jspdf && window.jspdf.jsPDF; if (!J) { toast('O gerador de PDF não carregou.'); return null; }
  const pdf = new J({ unit: 'mm', format: 'a4' });
  const W = 210, L = 14, R = 196, C = { navy: [12, 52, 70], orange: [255, 106, 0], ink: [22, 33, 45], muted: [108, 121, 134], line: [222, 230, 236], pale: [244, 247, 250] };
  const T = (s, x, y, o = {}) => { pdf.setFont('helvetica', o.b ? 'bold' : 'normal'); pdf.setFontSize(o.s || 10); pdf.setTextColor(...(o.c || C.ink)); pdf.text(String(s ?? ''), x, y, { align: o.a || 'left', maxWidth: o.w }); };
  const wrap = (s, w, size) => { pdf.setFontSize(size); return pdf.splitTextToSize(String(s || ''), w); };
  const nome = EMPRESA.nome || CTX.empresa.empresa_nome, ec = EMPRESA.config || {};
  const titulo = doc.tipo === 'entrega' ? 'ROMANEIO DE ENTREGA' : 'ORDEM DE SERVIÇO';
  // cabeçalho
  pdf.setFillColor(...C.navy); pdf.rect(0, 0, W, 38, 'F');
  pdf.setFillColor(...C.orange); pdf.rect(0, 38, W, 1.6, 'F');
  let tx = L;
  if (ec.logo && /^data:image\//.test(ec.logo)) {
    try { const lw = ec.logoW || 1, lh = ec.logoH || 1, k = Math.min(22 / lw, 22 / lh); pdf.setFillColor(255, 255, 255); pdf.roundedRect(L, 8, 24, 24, 2, 2, 'F'); pdf.addImage(ec.logo, 'PNG', L + 1 + (22 - lw * k) / 2, 9 + (22 - lh * k) / 2, lw * k, lh * k); tx = L + 29; } catch (e) {}
  }
  T(nome, tx, 15, { s: 15, b: true, c: [255, 255, 255], w: 105 });
  const linhaEmp = [EMPRESA.documento ? 'CNPJ ' + EMPRESA.documento : '', EMPRESA.telefone || ''].filter(Boolean).join('  •  ');
  T(linhaEmp, tx, 21.5, { s: 8.5, c: [205, 222, 232] });
  T([CFG.endereco, EMPRESA.cidade].filter(Boolean).join(' – '), tx, 26.5, { s: 8.5, c: [205, 222, 232], w: 110 });
  T(titulo, R, 15, { s: 13, b: true, c: [255, 255, 255], a: 'right' });
  T('Nº ' + pad4(doc.numero), R, 21.5, { s: 11, b: true, c: C.orange, a: 'right' });
  T('Emissão: ' + dataBR(doc.data), R, 27, { s: 8.5, c: [205, 222, 232], a: 'right' });
  if (doc.previsao) T((doc.tipo === 'entrega' ? 'Entrega: ' : 'Serviço: ') + dataBR(doc.previsao), R, 31.5, { s: 8.5, c: [205, 222, 232], a: 'right' });
  // dados
  let y = 47;
  pdf.setFillColor(...C.pale); pdf.roundedRect(L, y - 5, R - L, 27, 2, 2, 'F');
  const campo = (rot, val, x, yy, w) => { T(rot.toUpperCase(), x, yy, { s: 6.8, b: true, c: C.muted }); T(val || '—', x, yy + 4.6, { s: 9.5, b: true, w }); };
  campo('Cliente', doc.cliente, L + 4, y, 95); campo('Telefone', doc.foneCliente, 126, y, 66);
  campo(doc.tipo === 'entrega' ? 'Endereço de entrega' : 'Local do serviço', doc.endereco, L + 4, y + 11.5, 108);
  campo(doc.tipo === 'entrega' ? 'Entregador' : 'Responsável', [doc.responsavel, doc.foneResp].filter(Boolean).join(' – '), 126, y + 11.5, 66);
  y += 30;
  // tabela
  const pr = doc.mostrarPrecos;
  const col = pr ? { d: L + 12, q: 128, u: 140, pu: 168, t: R - 3 } : { d: L + 12, q: 166, u: 180 };
  const cabTab = () => {
    pdf.setFillColor(...C.navy); pdf.rect(L, y, R - L, 8, 'F');
    T('#', L + 3, y + 5.3, { s: 8, b: true, c: [255, 255, 255] }); T('DESCRIÇÃO', col.d, y + 5.3, { s: 8, b: true, c: [255, 255, 255] });
    T('QTD', col.q, y + 5.3, { s: 8, b: true, c: [255, 255, 255], a: 'right' }); T('UN', col.u, y + 5.3, { s: 8, b: true, c: [255, 255, 255] });
    if (pr) { T('UNITÁRIO', col.pu, y + 5.3, { s: 8, b: true, c: [255, 255, 255], a: 'right' }); T('TOTAL', col.t, y + 5.3, { s: 8, b: true, c: [255, 255, 255], a: 'right' }); }
    y += 8;
  };
  cabTab();
  const its = doc.itens.filter(i => i.desc.trim() || toNum(i.venda));
  its.forEach((i, k) => {
    const ls = wrap(i.desc || '—', (pr ? col.q - 16 : col.q - 16) - col.d, 9), h = Math.max(7.5, ls.length * 4.2 + 3.4);
    if (y + h > 250) { pdf.addPage(); y = 16; cabTab(); }
    if (k % 2) { pdf.setFillColor(...C.pale); pdf.rect(L, y, R - L, h, 'F'); }
    T(String(k + 1), L + 3, y + 5, { s: 8.5, c: C.muted });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...C.ink); pdf.text(ls, col.d, y + 5);
    T(fmtN(toNum(i.qtd)), col.q, y + 5, { s: 9, a: 'right' }); T(i.un || 'un', col.u, y + 5, { s: 9 });
    if (pr) { T(money(toNum(i.venda)), col.pu, y + 5, { s: 9, a: 'right' }); T(money(itemTotal(i)), col.t, y + 5, { s: 9, b: true, a: 'right' }); }
    y += h; pdf.setDrawColor(...C.line); pdf.line(L, y, R, y);
  });
  y += 4;
  if (pr) {
    if (y > 248) { pdf.addPage(); y = 20; }
    pdf.setFillColor(...C.navy); pdf.roundedRect(120, y, R - 120, 12, 2, 2, 'F');
    T('TOTAL', 125, y + 7.8, { s: 9, b: true, c: [255, 255, 255] }); T(money(totais().venda), R - 4, y + 8, { s: 13, b: true, c: [255, 255, 255], a: 'right' });
    y += 18;
  } else { T(`${its.length} item(ns)`, R, y + 3, { s: 9, c: C.muted, a: 'right' }); y += 10; }
  if (doc.obs.trim()) {
    const ls = wrap(doc.obs.trim(), R - L - 8, 9); if (y + ls.length * 4.4 + 10 > 262) { pdf.addPage(); y = 20; }
    T('OBSERVAÇÕES', L, y, { s: 8, b: true, c: C.navy }); y += 5;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...C.ink); pdf.text(ls, L, y); y += ls.length * 4.4 + 4;
  }
  // assinaturas
  if (y > 240) { pdf.addPage(); y = 30; }
  y = Math.max(y + 16, 250);
  pdf.setDrawColor(...C.muted); pdf.line(L + 4, y, 92, y); pdf.line(118, y, R - 4, y);
  T(doc.tipo === 'entrega' ? 'Entregue por' : 'Executado por', (L + 92) / 2 + 2, y + 4.5, { s: 8, b: true, a: 'center' });
  T(doc.responsavel || nome, (L + 92) / 2 + 2, y + 8.5, { s: 7.5, c: C.muted, a: 'center' });
  T('Recebido / conferido por', (118 + R) / 2 - 2, y + 4.5, { s: 8, b: true, a: 'center' });
  T('Nome, data e assinatura do cliente', (118 + R) / 2 - 2, y + 8.5, { s: 7.5, c: C.muted, a: 'center' });
  // rodapé
  const n = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p); pdf.setDrawColor(...C.line); pdf.line(L, 284, R, 284);
    T(`DOCUMENTO SEM VALOR FISCAL – controle de ${doc.tipo === 'entrega' ? 'entrega' : 'serviço'} de ${nome}`, L, 288.5, { s: 7, c: C.muted });
    T(`Página ${p} de ${n}`, R, 288.5, { s: 7, c: C.muted, a: 'right' });
  }
  return pdf;
}
async function enviar() {
  const pdf = gerarPDF(); if (!pdf) return;
  await persistir().catch(erro);
  const arq = nomeArquivo(), blob = pdf.output('blob');
  const quem = doc.tipo === 'entrega' ? 'a entrega' : 'o serviço';
  const texto = `Olá${doc.responsavel ? ', ' + doc.responsavel.split(' ')[0] : ''}! Segue ${doc.tipo === 'entrega' ? 'o romaneio' : 'a ordem de serviço'} nº ${pad4(doc.numero)} da *${EMPRESA.nome || CTX.empresa.empresa_nome}* para ${quem}` +
    (doc.cliente ? ` do cliente ${doc.cliente}` : '') + (doc.endereco ? `.\nEndereço: ${doc.endereco}` : '') + (doc.previsao ? `\nData: ${dataBR(doc.previsao)}` : '') + '\n\nO PDF está em anexo.';
  try {
    const file = new File([blob], arq, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: texto, title: arq }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  pdf.save(arq);
  abrirWhats(primeiroFone(doc.foneResp), texto);
  toast('PDF baixado: anexe na conversa do WhatsApp que abriu.');
}

/* ---------------- lista de documentos ---------------- */
async function abrirLista() {
  lista = await ok(db.from('rom_documentos').select('id,numero,tipo,data,cliente_nome,total,atualizado_em').eq('empresa_id', EMP).order('atualizado_em', { ascending: false }));
  abrirModal(cab('📂 Documentos') + (lista.length ? lista.map(d => `<div class="doc-linha" data-act="abrir" data-id="${d.id}">
      <div class="info"><b>${d.tipo === 'entrega' ? '🚚 Romaneio' : '🛠️ OS'} ${pad4(d.numero)} · ${esc(d.cliente_nome || 'sem cliente')}</b><small>${dataBR(d.data)} · ${money(d.total)}</small></div>
      <button class="btn sm" data-act="duplicar" data-id="${d.id}" title="Copiar como novo">⧉</button>
      <button class="btn sm perigo" data-act="apagar" data-id="${d.id}" title="Apagar">🗑</button></div>`).join('') : '<div class="vazio">Nenhum documento ainda.</div>'), true);
}
async function carregarDoc(id) {
  const r = await ok(db.from('rom_documentos').select('*').eq('id', id).maybeSingle());
  if (!r) return false;
  doc = Object.assign(novoDoc(r.numero), r.dados || {}, { id: r.id, numero: r.numero });
  doc.fonte = Object.assign({ fornecedor: '', numero: '', obs: '' }, doc.fonte || {});
  salvoNoBanco = true; anexo = null; render(); return true;
}
async function novo() {
  await persistir().catch(erro);
  doc = novoDoc(await proximoNumero()); salvoNoBanco = false; anexo = null; render(); scrollTo({ top: 0 });
}

/* ---------------- eventos ---------------- */
function setPath(o, k, v) { const p = k.split('.'); let x = o; while (p.length > 1) x = x[p.shift()]; x[p[0]] = v; }
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.k) {
    setPath(doc, t.dataset.k, t.dataset.k === 'numero' ? (parseInt(t.value, 10) || doc.numero) : t.value);
    if (t.dataset.k === 'cliente') {
      const c = clientes.find(c => c.nome.toLowerCase() === t.value.trim().toLowerCase());
      doc.clienteId = c ? c.id : null;
      if (c) {
        if (!doc.foneCliente && c.telefone) { doc.foneCliente = c.telefone; const f = $('[data-k=foneCliente]'); if (f) f.value = c.telefone; }
        if (!doc.endereco && (c.endereco || c.cidade)) { doc.endereco = [c.endereco, c.cidade].filter(Boolean).join(', '); const f = $('[data-k=endereco]'); if (f) f.value = doc.endereco; }
      }
    }
    atualizarTotais(); salvar(); return;
  }
  if (t.id === 'margem') { CFG.margem = t.value; salvarCfg(); return; }
  const row = t.closest('.it-row');
  if (row && t.dataset.f) {
    const i = doc.itens.find(x => x.id === row.dataset.id); if (!i) return;
    i[t.dataset.f] = t.value; atualizarTotais(); salvar();
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'arq') return importarArquivo(t.files[0]);
  if (t.id === 'mostrarPrecos') { doc.mostrarPrecos = t.checked; salvar(); }
  // ao sair do custo: se não tem preço, aplica a margem
  const row = t.closest('.it-row');
  if (row && t.dataset.f === 'custo') {
    const i = doc.itens.find(x => x.id === row.dataset.id), m = toNum(CFG.margem);
    if (i && !toNum(i.venda) && toNum(i.custo) && m > 0) { i.venda = inNum(Math.round(toNum(i.custo) * (1 + m / 100) * 100) / 100); row.querySelector('[data-f=venda]').value = i.venda; atualizarTotais(); salvar(); }
  }
});
document.addEventListener('dragover', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
document.addEventListener('dragleave', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) d.classList.remove('over'); });
document.addEventListener('drop', e => { const d = e.target.closest && e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.remove('over'); importarArquivo(e.dataTransfer.files[0]); } });
document.addEventListener('click', async e => {
  if (e.target.id === 'modal') return fecharModal();
  const b = e.target.closest('[data-act]'); if (!b) return;
  try {
    switch (b.dataset.act) {
      case 'fechar': return fecharModal();
      case 'tipo': doc.tipo = b.dataset.v; render(); return salvar();
      case 'add-item': doc.itens.push(novoItem()); render(); { const r = document.querySelectorAll('.it-row'); r[r.length - 1].querySelector('.d').focus(); } return;
      case 'del-item': { const id = b.closest('.it-row').dataset.id; doc.itens = doc.itens.filter(i => i.id !== id); if (!doc.itens.length) doc.itens.push(novoItem()); render(); return salvar(); }
      case 'aplicar-margem': {
        const m = toNum(CFG.margem); let n = 0;
        doc.itens.forEach(i => { if (!toNum(i.venda) && toNum(i.custo)) { i.venda = inNum(Math.round(toNum(i.custo) * (1 + m / 100) * 100) / 100); n++; } });
        render(); salvar(); return toast(n ? `Margem de ${fmtN(m)}% aplicada em ${n} item(ns).` : 'Todos os itens já têm preço (ou não têm custo).');
      }
      case 'tirar-anexo': if (anexo) URL.revokeObjectURL(anexo.url); anexo = null; return render();
      case 'pdf': { const p = gerarPDF(); if (p) { await persistir().catch(erro); p.save(nomeArquivo()); toast('PDF baixado!'); } return; }
      case 'enviar': return await enviar();
      case 'lista': return await abrirLista();
      case 'novo': return await novo();
      case 'abrir': if (e.target.closest('button')) return; await persistir().catch(erro); fecharModal(); await carregarDoc(b.dataset.id); return scrollTo({ top: 0 });
      case 'duplicar': {
        e.stopPropagation(); await persistir().catch(erro);
        const r = await ok(db.from('rom_documentos').select('*').eq('id', b.dataset.id).maybeSingle());
        doc = Object.assign(novoDoc(await proximoNumero()), r.dados || {}, { id: uid(), data: hojeISO(), previsao: '' });
        doc.numero = await proximoNumero(); doc.itens = doc.itens.map(i => ({ ...i, id: uid() }));
        salvoNoBanco = false; fecharModal(); render(); await persistir(); return toast('Cópia criada como nº ' + pad4(doc.numero) + '.');
      }
      case 'apagar':
        e.stopPropagation(); if (!confirm('Apagar este documento?')) return;
        await ok(db.from('rom_documentos').delete().eq('id', b.dataset.id));
        if (doc && doc.id === b.dataset.id) { doc = novoDoc(await proximoNumero()); salvoNoBanco = false; render(); }
        return await abrirLista();
    }
  } catch (err) { erro(err); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) fecharModal(); });
addEventListener('pagehide', () => { persistir().catch(() => {}); });

/* configurações (endereço da empresa e margem) */
let tCfg = null;
function salvarCfg() {
  try { localStorage.setItem('rom_cfg_' + EMP, JSON.stringify(CFG)); } catch (e) {}
  clearTimeout(tCfg); tCfg = setTimeout(async () => {
    const { error } = await db.from('core_empresa_modulos').update({ config: CFG }).eq('empresa_id', EMP).eq('modulo', 'romaneios');
    if (error) console.warn('config só local:', error.message);
  }, 800);
}
async function carregarCfg() {
  const [emp, mod] = await Promise.all([
    ok(db.from('core_empresas').select('*').eq('id', EMP).maybeSingle()),
    db.from('core_empresa_modulos').select('config').eq('empresa_id', EMP).eq('modulo', 'romaneios').maybeSingle().then(r => r.data)]);
  EMPRESA = emp || { nome: CTX.empresa.empresa_nome };
  let local = {}; try { local = JSON.parse(localStorage.getItem('rom_cfg_' + EMP) || '{}'); } catch (e) {}
  CFG = Object.assign({ endereco: '', margem: '30' }, local, (mod && mod.config) || {});
}
function formEmpresa() {
  abrirModal(cab('⚙️ Dados da empresa no documento') + `
    <div class="sub">Nome, CNPJ e telefone vêm do cadastro da empresa (Administração). Aqui você completa o endereço.</div>
    <div class="grid"><div class="full"><label>Endereço da empresa</label><input id="cfgEnd" value="${esc(CFG.endereco)}" placeholder="Rua, nº, bairro – CEP"></div></div>
    <div class="btn-row"><button class="btn pri" data-act="cfg-ok" style="flex:1">Salvar</button></div>`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'cfg') formEmpresa();
  if (b.dataset.act === 'cfg-ok') { CFG.endereco = $('#cfgEnd').value.trim(); salvarCfg(); fecharModal(); toast('Endereço salvo.'); }
});

(async () => {
  try {
    CTX = await P.exigirModulo('romaneios'); if (!CTX) return;
    EMP = CTX.empresa.empresa_id;
    P.barraModulo(CTX, 'Romaneios');
    await carregarCfg();
    $('#subtitulo').textContent = (EMPRESA.nome || CTX.empresa.empresa_nome) + ' · entrega e ordem de serviço';
    const hb = document.querySelector('.topbar');
    hb.insertAdjacentHTML('beforeend', '<button class="tb-btn" data-act="cfg" title="Endereço da empresa no documento">⚙️</button>');
    clientes = await db.from('core_clientes').select('id,nome,telefone,endereco,cidade').eq('empresa_id', EMP).order('nome').then(r => r.data || []);
    const ult = await ok(db.from('rom_documentos').select('id').eq('empresa_id', EMP).order('atualizado_em', { ascending: false }).limit(1));
    if (!(ult.length && await carregarDoc(ult[0].id))) { doc = novoDoc(await proximoNumero()); render(); }
    if (!CFG.endereco) toast('Dica: toque em ⚙️ e informe o endereço da empresa para sair no documento.');
  } catch (e) { erro(e); $('#conteudo').innerHTML = '<div class="carregando">Não foi possível carregar. Verifique a internet e se a atualização 006 foi rodada no Supabase.</div>'; }
})();
})();
