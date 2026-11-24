/* =====================================================================
   PLATAFORMA KE — MÓDULO COTAÇÕES
   Pesquisa de preços: itens, lojas, preços lançados à mão e pedidos de
   cotação que as lojas respondem por link (cotar/?c=CODIGO).
===================================================================== */
(() => {
'use strict';
const P = window.Plataforma, db = P.db, esc = P.esc;
const $ = s => document.querySelector(s);
let CTX = null, EMP = null;

const D = { itens: [], lojas: [], precos: [], cotacoes: [], cotItens: [], pedidos: [] };
const UI = { aba: 'mercado', periodo: 90, busca: '', categoria: '', cotAberta: null,
             lanc: { loja: '', data: hojeISO(), fonte: 'telefone', busca: '' } };
const FONTES = { telefone: 'Telefone', balcao: 'Balcão / visita', site: 'Site', whatsapp: 'WhatsApp', nota: 'Nota fiscal', manual: 'Outro', link: 'Link da cotação' };
const CORES = ['#0C3446', '#FF6A00', '#1e8a50', '#7b4bd1', '#c62828', '#0a8fb3', '#b08900', '#d1477a', '#5b6b7a', '#2f9e8f'];

/* ---------------- utilitários ---------------- */
function hojeISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function isoMenos(dias) { const d = new Date(hojeISO() + 'T12:00:00'); d.setDate(d.getDate() - dias); return d.toISOString().slice(0, 10); }
const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const dataCurta = iso => iso ? dataBR(iso).slice(0, 5) : '';
const money = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtN = v => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
function toNum(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(s);
}
const pct = v => (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
function haQuanto(iso) {
  const d = Math.round((new Date(hojeISO()) - new Date(String(iso).slice(0, 10))) / 864e5);
  return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : d < 31 ? `há ${d} dias` : dataBR(iso);
}
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
async function copiar(t) { try { await navigator.clipboard.writeText(t); toast('Copiado!'); } catch (e) { prompt('Copie:', t); } }
const porId = (lista, id) => lista.find(x => x.id === id);
const nomeItem = id => (porId(D.itens, id) || {}).nome || '(item apagado)';
const nomeLoja = id => (porId(D.lojas, id) || {}).nome || '(loja apagada)';
const unItem = id => (porId(D.itens, id) || {}).unidade || 'un';
const urlCotar = token => new URL('../../cotar/?c=' + token, location.href).href;

/* ---------------- dados ---------------- */
async function tudo(tabela, ordem) {
  const lista = []; const passo = 1000;
  for (let de = 0; ; de += passo) {
    let q = db.from(tabela).select('*').eq('empresa_id', EMP);
    if (ordem) q = q.order(ordem, { ascending: false });
    q = q.range ? q.range(de, de + passo - 1) : q;
    const pg = await ok(q);
    lista.push(...pg);
    if (pg.length < passo || !q.range) break;
  }
  return lista;
}
async function carregar() {
  const [itens, lojas, precos, cotacoes, cotItens, pedidos] = await Promise.all([
    tudo('cot_itens'), tudo('cot_lojas'), tudo('cot_precos', 'data'), tudo('cot_cotacoes', 'criado_em'), tudo('cot_cotacao_itens'), tudo('cot_pedidos')]);
  const nome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  Object.assign(D, { itens: itens.sort(nome), lojas: lojas.sort(nome), precos, cotacoes, cotItens, pedidos });
  D.precos.sort((a, b) => (b.data > a.data) - (b.data < a.data) || (b.criado_em > a.criado_em) - (b.criado_em < a.criado_em));
}

/* ---------------- análise de mercado ---------------- */
function precosValidos(desde) { return D.precos.filter(p => p.disponivel && p.preco != null && (!desde || p.data >= desde)); }
function analisarItem(itemId, desde) {
  const obs = precosValidos(desde).filter(p => p.item_id === itemId);   // já em ordem do mais novo
  const ultimo = new Map();
  obs.forEach(p => { if (!ultimo.has(p.loja_id)) ultimo.set(p.loja_id, p); });
  const atuais = [...ultimo.values()].sort((a, b) => a.preco - b.preco);
  if (!atuais.length) return { itemId, atuais, obs };
  const vals = atuais.map(p => +p.preco);
  const min = vals[0], max = vals[vals.length - 1], media = vals.reduce((a, b) => a + b, 0) / vals.length;
  // tendência: média da metade mais recente do período x metade anterior
  let tend = null;
  const ini = desde || (obs.length ? obs[obs.length - 1].data : null);
  if (ini && obs.length >= 2) {
    const dias = Math.max(2, Math.round((new Date(hojeISO()) - new Date(ini)) / 864e5));
    const meio = isoMenos(Math.floor(dias / 2));
    const rec = obs.filter(p => p.data >= meio), ant = obs.filter(p => p.data < meio);
    if (rec.length && ant.length) {
      const m = a => a.reduce((s, p) => s + +p.preco, 0) / a.length;
      tend = (m(rec) / m(ant) - 1) * 100;
    }
  }
  return { itemId, atuais, obs, min, max, media, tend, melhor: atuais[0], dif: min > 0 ? (max / min - 1) * 100 : 0 };
}
function sparkline(obs) {
  const porDia = new Map();
  obs.forEach(p => { const v = +p.preco; if (!porDia.has(p.data) || v < porDia.get(p.data)) porDia.set(p.data, v); });
  const pts = [...porDia.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (pts.length < 2) return '';
  const vs = pts.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), W = 300, H = 38;
  const x = i => 2 + i * (W - 4) / (pts.length - 1), y = v => hi === lo ? H / 2 : 4 + (H - 8) * (1 - (v - lo) / (hi - lo));
  const d = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}" fill="none" stroke="#FF6A00" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function badgeTend(t) {
  if (t == null) return '';
  if (Math.abs(t) < 1) return `<span class="tend igual" title="Preço estável no período">= estável</span>`;
  return t > 0 ? `<span class="tend sobe" title="Média recente comparada com o começo do período">▲ ${pct(t)}</span>`
               : `<span class="tend desce" title="Média recente comparada com o começo do período">▼ ${pct(t)}</span>`;
}

function telaMercado() {
  const desde = UI.periodo ? isoMenos(UI.periodo) : null;
  const cats = [...new Set(D.itens.map(i => i.categoria).filter(Boolean))].sort();
  const busca = UI.busca.trim().toLowerCase();
  const itens = D.itens.filter(i => i.ativo && (!UI.categoria || i.categoria === UI.categoria) && (!busca || i.nome.toLowerCase().includes(busca)));
  const an = itens.map(i => ({ i, a: analisarItem(i.id, desde) }));
  an.sort((x, y) => (y.a.atuais.length > 0) - (x.a.atuais.length > 0) || x.i.nome.localeCompare(y.i.nome, 'pt-BR'));
  const validos = precosValidos(desde);
  const ult = D.precos[0];

  if (!D.itens.length) return `<section class="card"><div class="vazio"><b>Comece cadastrando os itens que você quer acompanhar</b>
    Ex.: piso vinílico, cola, rodapé, placa de drywall…<div class="btn-row" style="justify-content:center">
    <button class="btn pri" data-act="aba" data-aba="itens">📦 Cadastrar itens</button></div></div></section>`;

  // ranking das lojas: em quantos itens cada uma é a mais barata
  const rank = new Map();
  an.forEach(({ a }) => {
    if (a.atuais.length < 2) return;
    a.atuais.forEach(p => {
      const r = rank.get(p.loja_id) || { itens: 0, melhor: 0, acima: 0 };
      r.itens++; if (+p.preco === a.min) r.melhor++; r.acima += a.min > 0 ? (p.preco / a.min - 1) * 100 : 0;
      rank.set(p.loja_id, r);
    });
  });
  const ranking = [...rank.entries()].map(([id, r]) => ({ id, ...r, media: r.acima / r.itens }))
    .sort((a, b) => b.melhor - a.melhor || a.media - b.media);

  return `
  <div class="tiles">
    <div class="tile"><small>Itens com preço</small><b>${an.filter(x => x.a.atuais.length).length}<span style="font-size:14px;color:var(--muted)"> / ${itens.length}</span></b></div>
    <div class="tile"><small>Lojas pesquisadas</small><b>${new Set(validos.map(p => p.loja_id)).size}</b></div>
    <div class="tile"><small>Preços no período</small><b>${validos.length}</b></div>
    <div class="tile"><small>Última atualização</small><b style="font-size:17px">${ult ? haQuanto(ult.data) : '—'}</b></div>
  </div>
  <section class="card">
    <div class="barra-filtros">
      <input id="fBusca" placeholder="🔎 Procurar item" value="${esc(UI.busca)}">
      ${cats.length ? `<select id="fCat"><option value="">Todas as categorias</option>${cats.map(c => `<option${c === UI.categoria ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
      <select id="fPeriodo">${[[30, 'Últimos 30 dias'], [90, 'Últimos 3 meses'], [180, 'Últimos 6 meses'], [365, 'Último ano'], [0, 'Todo o histórico']]
        .map(([v, t]) => `<option value="${v}"${v === UI.periodo ? ' selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <div class="hint">Cada loja conta com o preço mais recente dela no período. Toque num item para ver o histórico e todas as lojas.</div>
  </section>
  <div class="itens-mercado">
    ${an.map(({ i, a }) => `<button class="im" data-act="item" data-id="${i.id}">
      <div class="im-top"><b>${esc(i.nome)}</b>${badgeTend(a.tend)}<small>${esc(i.unidade)}</small></div>
      ${a.atuais.length ? `
        <div class="im-menor">${money(a.min)} <span>/ ${esc(i.unidade)} · menor preço</span></div>
        <div class="im-loja">🏪 ${esc(nomeLoja(a.melhor.loja_id))} <em>· ${haQuanto(a.melhor.data)}</em></div>
        ${a.atuais.length > 1 ? `<div class="im-faixa"><span>Média <b>${money(a.media)}</b></span><span>Maior <b>${money(a.max)}</b></span><span>${a.atuais.length} lojas</span>${a.dif >= 1 ? `<span class="tag lar">diferença de ${fmtN(a.dif)}%</span>` : ''}</div>`
          : `<div class="im-faixa"><span>Só 1 loja pesquisada</span></div>`}
        ${sparkline(a.obs)}`
      : `<div class="im-sem">Nenhum preço ${UI.periodo ? 'neste período' : 'ainda'}.</div>`}
    </button>`).join('') || '<div class="vazio">Nenhum item encontrado.</div>'}
  </div>
  ${ranking.length ? `<section class="card">
    <h2>🏆 Lojas mais em conta</h2>
    <div class="sub">Considera só os itens pesquisados em 2 lojas ou mais.</div>
    <div class="tab-wrap"><table class="t"><thead><tr><th>Loja</th><th class="n">Itens</th><th class="n">Mais barata em</th><th class="n">Em média acima do menor</th></tr></thead>
    <tbody>${ranking.map((r, k) => `<tr${k === 0 ? ' class="melhor"' : ''}><td>${k === 0 ? '🥇 ' : k === 1 ? '🥈 ' : k === 2 ? '🥉 ' : ''}${esc(nomeLoja(r.id))}</td><td class="n">${r.itens}</td><td class="n">${r.melhor}</td><td class="n">${r.media < 0.05 ? '—' : pct(r.media)}</td></tr>`).join('')}</tbody></table></div>
  </section>` : ''}`;
}

function grafico(obs) {
  if (obs.length < 1) return '';
  const datas = obs.map(p => p.data).sort(), d0 = new Date(datas[0]), d1 = new Date(datas[datas.length - 1]);
  const span = Math.max(1, (d1 - d0) / 864e5);
  const vs = obs.map(p => +p.preco), lo0 = Math.min(...vs), hi0 = Math.max(...vs), folga = (hi0 - lo0) * 0.12 || hi0 * 0.1 || 1;
  const lo = Math.max(0, lo0 - folga), hi = hi0 + folga;
  const W = 640, H = 220, L = 58, R = 12, T = 12, B = 28;
  const x = iso => L + (span <= 1 && datas.length === 1 ? (W - L - R) / 2 : ((new Date(iso) - d0) / 864e5) / span * (W - L - R));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const lojas = [...new Set(obs.map(p => p.loja_id))];
  const cor = id => CORES[lojas.indexOf(id) % CORES.length];
  let g = '';
  for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, yy = y(v); g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#e6ecf1"/><text x="${L - 6}" y="${yy + 4}" font-size="11" text-anchor="end" fill="#6b7a88">${money(v).replace('R$', '').trim()}</text>`; }
  g += `<text x="${L}" y="${H - 8}" font-size="11" fill="#6b7a88">${dataBR(datas[0])}</text><text x="${W - R}" y="${H - 8}" font-size="11" text-anchor="end" fill="#6b7a88">${dataBR(datas[datas.length - 1])}</text>`;
  lojas.forEach(id => {
    const ps = obs.filter(p => p.loja_id === id).sort((a, b) => a.data < b.data ? -1 : 1);
    if (ps.length > 1) g += `<path d="${ps.map((p, i) => (i ? 'L' : 'M') + x(p.data).toFixed(1) + ' ' + y(+p.preco).toFixed(1)).join(' ')}" fill="none" stroke="${cor(id)}" stroke-width="1.6" opacity=".55"/>`;
    ps.forEach(p => { g += `<circle cx="${x(p.data).toFixed(1)}" cy="${y(+p.preco).toFixed(1)}" r="4.2" fill="${cor(id)}"><title>${esc(nomeLoja(id))}: ${money(p.preco)} em ${dataBR(p.data)}</title></circle>`; });
  });
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>
    <div class="legenda">${lojas.map(id => `<span><i style="background:${cor(id)}"></i>${esc(nomeLoja(id))}</span>`).join('')}</div>`;
}

function abrirItem(id) {
  const it = porId(D.itens, id); if (!it) return;
  const desde = UI.periodo ? isoMenos(UI.periodo) : null;
  const a = analisarItem(id, desde);
  const hist = D.precos.filter(p => p.item_id === id);
  abrirModal(cab(`📦 ${esc(it.nome)} <span class="tag">${esc(it.unidade)}</span>`) + `
    ${a.atuais.length ? `
      <div class="tiles" style="margin-bottom:12px">
        <div class="tile"><small>Menor</small><b style="color:var(--ok)">${money(a.min)}</b></div>
        <div class="tile"><small>Média</small><b>${money(a.media)}</b></div>
        <div class="tile"><small>Maior</small><b>${money(a.max)}</b></div>
      </div>
      ${grafico(a.obs)}
      <h4 style="margin:14px 0 4px;color:var(--navy)">Preço atual em cada loja</h4>
      <div class="tab-wrap"><table class="t"><thead><tr><th>Loja</th><th class="n">Preço</th><th class="n">vs menor</th><th>Quando</th><th>Como</th></tr></thead><tbody>
      ${a.atuais.map((p, k) => `<tr${k === 0 ? ' class="melhor"' : ''}><td>${esc(nomeLoja(p.loja_id))}</td><td class="n"><b>${money(p.preco)}</b></td>
        <td class="n">${k === 0 ? '<span class="tag ok">menor</span>' : pct((p.preco / a.min - 1) * 100)}</td><td>${dataBR(p.data)}</td><td><span class="tag">${FONTES[p.fonte] || p.fonte}</span></td></tr>`).join('')}
      </tbody></table></div>` : `<div class="vazio">Sem preços ${UI.periodo ? 'neste período' : 'ainda'}.</div>`}
    <h4 style="margin:16px 0 4px;color:var(--navy)">Histórico completo (${hist.length})</h4>
    <div class="tab-wrap"><table class="t"><thead><tr><th>Data</th><th>Loja</th><th class="n">Preço</th><th>Como</th><th></th></tr></thead><tbody>
    ${hist.slice(0, 300).map(p => `<tr><td>${dataBR(p.data)}</td><td>${esc(nomeLoja(p.loja_id))}${p.obs ? `<br><small style="color:var(--muted)">${esc(p.obs)}</small>` : ''}</td>
      <td class="n">${p.disponivel ? money(p.preco) : '<span class="tag">não tem</span>'}</td><td><span class="tag">${FONTES[p.fonte] || p.fonte}</span></td>
      <td class="n"><button class="btn sm perigo" data-act="del-preco" data-id="${p.id}" data-item="${id}" title="Apagar este preço">🗑</button></td></tr>`).join('') || '<tr><td colspan="5" class="falta">Nada lançado.</td></tr>'}
    </tbody></table></div>
    <div class="btn-row"><button class="btn pri" data-act="lancar-item" data-id="${id}">✍️ Lançar preço deste item</button></div>`, true);
}

/* ---------------- lançar preços à mão ---------------- */
function telaPrecos() {
  const L = UI.lanc;
  if (!D.itens.length || !D.lojas.length) return `<section class="card"><div class="vazio"><b>Cadastre primeiro ${!D.itens.length ? 'os itens' : ''}${!D.itens.length && !D.lojas.length ? ' e ' : ''}${!D.lojas.length ? 'as lojas' : ''}</b>
    <div class="btn-row" style="justify-content:center">${!D.itens.length ? '<button class="btn pri" data-act="aba" data-aba="itens">📦 Itens</button>' : ''}${!D.lojas.length ? '<button class="btn pri" data-act="aba" data-aba="lojas">🏪 Lojas</button>' : ''}</div></div></section>`;
  const busca = L.busca.trim().toLowerCase();
  const itens = D.itens.filter(i => i.ativo && (!busca || i.nome.toLowerCase().includes(busca)));
  const ultimoDaLoja = id => D.precos.find(p => p.item_id === id && p.loja_id === L.loja && p.disponivel && p.preco != null);
  const recentes = D.precos.slice(0, 60);
  return `<section class="card">
    <h2>✍️ Lançar preços pesquisados</h2>
    <div class="sub">Ligou, visitou ou viu no site de uma loja? Escolha a loja e digite os preços que encontrou. Só os itens preenchidos são salvos.</div>
    <div class="grid">
      <div><label>Loja</label><select id="lLoja"><option value="">Escolha a loja…</option>${D.lojas.filter(l => l.ativo).map(l => `<option value="${l.id}"${l.id === L.loja ? ' selected' : ''}>${esc(l.nome)}</option>`).join('')}<option value="__nova">＋ Cadastrar nova loja</option></select></div>
      <div><label>Data da pesquisa</label><input id="lData" type="date" value="${L.data}" max="${hojeISO()}"></div>
      <div><label>Como pesquisou</label><select id="lFonte">${['telefone', 'balcao', 'site', 'whatsapp', 'nota', 'manual'].map(f => `<option value="${f}"${f === L.fonte ? ' selected' : ''}>${FONTES[f]}</option>`).join('')}</select></div>
    </div>
    ${L.loja ? `
    <div class="barra-filtros" style="margin-top:14px"><input id="lBusca" placeholder="🔎 Procurar item" value="${esc(L.busca)}"></div>
    <div id="lLista">${itens.map(i => { const u = ultimoDaLoja(i.id); return `<div class="lanc" data-item="${i.id}">
      <div class="nome"><b>${esc(i.nome)}</b><small>por ${esc(i.unidade)}${u ? ` · último nesta loja: ${money(u.preco)} (${dataBR(u.data)})` : ''}</small></div>
      <div class="money"><span>R$</span><input class="lp" inputmode="decimal" placeholder="0,00" aria-label="Preço de ${esc(i.nome)}"></div>
      <label class="chk"><input type="checkbox" class="ln"> não tem</label></div>`; }).join('') || '<div class="vazio">Nenhum item.</div>'}</div>
    <div class="btn-row"><button class="btn pri" data-act="salvar-lanc">💾 Salvar preços</button></div>` : ''}
  </section>
  <section class="card">
    <h2>🕑 Últimos lançamentos</h2>
    ${recentes.length ? `<div class="tab-wrap"><table class="t"><thead><tr><th>Data</th><th>Item</th><th>Loja</th><th class="n">Preço</th><th>Como</th><th></th></tr></thead><tbody>
    ${recentes.map(p => `<tr><td>${dataCurta(p.data)}</td><td>${esc(nomeItem(p.item_id))}</td><td>${esc(nomeLoja(p.loja_id))}</td>
      <td class="n">${p.disponivel ? money(p.preco) : '<span class="tag">não tem</span>'}</td><td><span class="tag">${FONTES[p.fonte] || p.fonte}</span></td>
      <td class="n"><button class="btn sm perigo" data-act="del-preco" data-id="${p.id}" title="Apagar">🗑</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="vazio">Nenhum preço lançado ainda.</div>'}
  </section>`;
}
async function salvarLancamento() {
  const L = UI.lanc;
  if (!L.loja) return toast('Escolha a loja.');
  const linhas = [];
  let invalido = '';
  document.querySelectorAll('#lLista .lanc').forEach(el => {
    const nao = el.querySelector('.ln').checked, v = toNum(el.querySelector('.lp').value);
    if (!nao && !el.querySelector('.lp').value.trim()) return;
    if (!nao && !(v >= 0 && v < 1e7)) { invalido = nomeItem(el.dataset.item); return; }
    linhas.push({ empresa_id: EMP, item_id: el.dataset.item, loja_id: L.loja, preco: nao ? null : Math.round(v * 100) / 100, disponivel: !nao, data: L.data || hojeISO(), fonte: L.fonte, obs: null });
  });
  if (invalido) return toast('Preço inválido em: ' + invalido);
  if (!linhas.length) return toast('Digite pelo menos um preço.');
  await ok(db.from('cot_precos').insert(linhas));
  toast(`${linhas.length} preço(s) salvo(s) para ${nomeLoja(L.loja)}.`);
  await carregar(); render();
}

/* ---------------- itens ---------------- */
function telaItens() {
  const cats = new Map();
  D.itens.forEach(i => { const c = i.categoria || 'Sem categoria'; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(i); });
  const qtd = id => new Set(D.precos.filter(p => p.item_id === id).map(p => p.loja_id)).size;
  return `<section class="card">
    <h2>📦 Itens acompanhados <span class="dir"></span></h2>
    <div class="sub">Os materiais que você quer acompanhar o preço. Use a mesma unidade em todas as lojas (ex.: m², caixa, barra, balde 18 L).</div>
    <div class="btn-row" style="margin-top:0"><button class="btn pri" data-act="item-novo">＋ Novo item</button><button class="btn" data-act="itens-varios">📝 Vários de uma vez</button></div>
    ${D.itens.length ? [...cats.entries()].sort((a, b) => a[0] === 'Sem categoria' ? 1 : b[0] === 'Sem categoria' ? -1 : a[0].localeCompare(b[0])).map(([c, l]) => `
      <div class="grupo-tit">${esc(c)}</div>
      ${l.map(i => `<div class="linha"><div class="info"><b>${esc(i.nome)}${i.ativo ? '' : ' <span class="tag">arquivado</span>'}</b>
        <small>por ${esc(i.unidade)} · ${qtd(i.id)} loja(s) com preço${i.obs ? ' · ' + esc(i.obs) : ''}</small></div>
        <button class="btn sm" data-act="item-editar" data-id="${i.id}">Editar</button></div>`).join('')}`).join('')
    : '<div class="vazio">Nenhum item cadastrado ainda.</div>'}
  </section>`;
}
function formItem(i = {}) {
  const cats = [...new Set(D.itens.map(x => x.categoria).filter(Boolean))];
  abrirModal(cab(i.id ? 'Editar item' : 'Novo item') + `
    <div class="grid">
      <div class="full"><label>Nome do item</label><input id="iNome" value="${esc(i.nome || '')}" placeholder="Ex.: Piso vinílico 2 mm colado"></div>
      <div><label>Unidade de preço</label><input id="iUn" list="dlUn" value="${esc(i.unidade || 'un')}"><datalist id="dlUn">${['un', 'm²', 'm', 'caixa', 'barra', 'balde', 'lata', 'saco', 'rolo', 'placa', 'pacote', 'kg', 'litro'].map(u => `<option value="${u}">`).join('')}</datalist></div>
      <div><label>Categoria <em style="font-weight:400;color:var(--muted)">(opcional)</em></label><input id="iCat" list="dlCat" value="${esc(i.categoria || '')}" placeholder="Ex.: Pisos"><datalist id="dlCat">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="full"><label>Observação <em style="font-weight:400;color:var(--muted)">(marca, medida, aparece para a loja)</em></label><input id="iObs" value="${esc(i.obs || '')}" placeholder="Ex.: Caixa com 3,34 m²"></div>
      ${i.id ? `<label class="chk full"><input type="checkbox" id="iAtivo"${i.ativo ? '' : ' checked'}> Arquivar (some das telas, mas o histórico fica guardado)</label>` : ''}
    </div>
    <div class="btn-row">${i.id ? `<button class="btn perigo" data-act="item-apagar" data-id="${i.id}">🗑 Apagar</button>` : ''}<button class="btn pri" data-act="item-salvar" data-id="${i.id || ''}" style="flex:1">💾 Salvar</button></div>`);
  setTimeout(() => $('#iNome').focus(), 50);
}
async function salvarItem(id) {
  const nome = $('#iNome').value.trim(); if (!nome) return toast('Digite o nome do item.');
  const v = { nome, unidade: $('#iUn').value.trim() || 'un', categoria: $('#iCat').value.trim() || null, obs: $('#iObs').value.trim() || null };
  if (id) { v.ativo = !$('#iAtivo').checked; await ok(db.from('cot_itens').update(v).eq('id', id)); }
  else await ok(db.from('cot_itens').insert({ ...v, empresa_id: EMP }));
  fecharModal(); toast('Item salvo.'); await carregar(); render();
}

/* ---------------- lojas ---------------- */
function telaLojas() {
  const qtd = id => D.precos.filter(p => p.loja_id === id).length;
  return `<section class="card">
    <h2>🏪 Lojas</h2>
    <div class="sub">As lojas de Manaus onde você pesquisa. Com o WhatsApp cadastrado, dá para mandar o pedido de cotação com um toque.</div>
    <div class="btn-row" style="margin-top:0"><button class="btn pri" data-act="loja-nova">＋ Nova loja</button></div>
    ${D.lojas.map(l => `<div class="linha"><div class="info"><b>${esc(l.nome)}${l.ativo ? '' : ' <span class="tag">arquivada</span>'}</b>
      <small>${[l.bairro, l.contato, l.telefone].filter(Boolean).map(esc).join(' · ') || 'sem contato'} · ${qtd(l.id)} preço(s)</small></div>
      ${primeiroFone(l.telefone) ? `<button class="btn sm zap" data-act="loja-zap" data-id="${l.id}">WhatsApp</button>` : ''}
      <button class="btn sm" data-act="loja-editar" data-id="${l.id}">Editar</button></div>`).join('') || '<div class="vazio">Nenhuma loja cadastrada ainda.</div>'}
  </section>`;
}
function formLoja(l = {}, depois) {
  abrirModal(cab(l.id ? 'Editar loja' : 'Nova loja') + `
    <div class="grid">
      <div class="full"><label>Nome da loja</label><input id="jNome" value="${esc(l.nome || '')}" placeholder="Ex.: Casa do Piso – Av. Djalma Batista"></div>
      <div><label>WhatsApp / telefone</label><input id="jTel" inputmode="tel" value="${esc(l.telefone || '')}" placeholder="(92) 9 9999-9999"></div>
      <div><label>Bairro</label><input id="jBairro" value="${esc(l.bairro || '')}" placeholder="Ex.: Chapada"></div>
      <div><label>Falar com</label><input id="jContato" value="${esc(l.contato || '')}" placeholder="Nome do vendedor"></div>
      <div class="full"><label>Observação</label><input id="jObs" value="${esc(l.obs || '')}" placeholder="Ex.: entrega grátis acima de R$ 500"></div>
      ${l.id ? `<label class="chk full"><input type="checkbox" id="jAtivo"${l.ativo ? '' : ' checked'}> Arquivar (o histórico de preços fica guardado)</label>` : ''}
    </div>
    <div class="btn-row">${l.id ? `<button class="btn perigo" data-act="loja-apagar" data-id="${l.id}">🗑 Apagar</button>` : ''}<button class="btn pri" data-act="loja-salvar" data-id="${l.id || ''}" style="flex:1">💾 Salvar</button></div>`);
  formLoja.depois = depois || null;
  setTimeout(() => $('#jNome').focus(), 50);
}
async function salvarLoja(id) {
  const nome = $('#jNome').value.trim(); if (!nome) return toast('Digite o nome da loja.');
  const v = { nome, telefone: $('#jTel').value.trim() || null, bairro: $('#jBairro').value.trim() || null, contato: $('#jContato').value.trim() || null, obs: $('#jObs').value.trim() || null };
  let nova = null;
  if (id) { v.ativo = !$('#jAtivo').checked; await ok(db.from('cot_lojas').update(v).eq('id', id)); }
  else nova = (await ok(db.from('cot_lojas').insert({ ...v, empresa_id: EMP }).select()))[0];
  fecharModal(); toast('Loja salva.'); await carregar();
  if (nova && formLoja.depois) formLoja.depois(nova);
  render();
}

/* ---------------- pedidos de cotação ---------------- */
function statusPedido(p) {
  if (p.respondido_em) return `<span class="tag ok">✓ respondeu ${haQuanto(p.respondido_em)}</span>`;
  if (p.visto_em) return `<span class="tag lar">👀 abriu o link ${haQuanto(p.visto_em)}</span>`;
  return `<span class="tag">aguardando</span>`;
}
function telaCotacoes() {
  if (UI.cotAberta && porId(D.cotacoes, UI.cotAberta)) return telaCotacao(UI.cotAberta);
  return `<section class="card">
    <h2>📨 Pedidos de cotação</h2>
    <div class="sub">Escolha os itens e as lojas: cada loja recebe pelo WhatsApp um link, preenche os preços no celular e o comparativo se monta sozinho aqui.</div>
    <div class="btn-row" style="margin-top:0"><button class="btn pri" data-act="cot-nova">＋ Nova cotação</button></div>
    ${D.cotacoes.map(c => {
      const peds = D.pedidos.filter(p => p.cotacao_id === c.id), resp = peds.filter(p => p.respondido_em).length;
      const venc = c.prazo && c.prazo < hojeISO();
      return `<div class="cot-card" data-act="cot-abrir" data-id="${c.id}"><div class="info"><b>${esc(c.titulo)}</b>
        <small>${D.cotItens.filter(x => x.cotacao_id === c.id).length} itens · criada ${haQuanto(c.criado_em)}${c.prazo ? ' · prazo ' + dataBR(c.prazo) : ''}</small></div>
        ${c.status === 'encerrada' ? '<span class="tag">encerrada</span>' : venc ? '<span class="tag lar">prazo vencido</span>' : '<span class="tag az">aberta</span>'}
        <div style="text-align:right;font-size:12px;color:var(--muted)">${resp}/${peds.length} responderam<div class="prog"><i style="width:${peds.length ? resp / peds.length * 100 : 0}%"></i></div></div></div>`;
    }).join('') || '<div class="vazio">Nenhuma cotação criada ainda.</div>'}
  </section>`;
}
function telaCotacao(id) {
  const c = porId(D.cotacoes, id);
  const itens = D.cotItens.filter(x => x.cotacao_id === id).map(x => ({ ...x, item: porId(D.itens, x.item_id) })).filter(x => x.item)
    .sort((a, b) => a.item.nome.localeCompare(b.item.nome, 'pt-BR'));
  const peds = D.pedidos.filter(p => p.cotacao_id === id).sort((a, b) => nomeLoja(a.loja_id).localeCompare(nomeLoja(b.loja_id), 'pt-BR'));
  const precoDe = (ped, itemId) => D.precos.find(p => p.pedido_id === ped.id && p.item_id === itemId);
  // referência: preço lançado para a loja nos últimos 30 dias, fora desta cotação (não entra nos totais)
  const refDe = (ped, itemId) => D.precos.find(p => p.loja_id === ped.loja_id && p.item_id === itemId && p.pedido_id !== ped.id && p.disponivel && p.preco != null && p.data >= isoMenos(30));
  // comparativo
  const linhas = itens.map(x => {
    const cel = peds.map(p => precoDe(p, x.item_id));
    const ref = peds.map(p => cel.length && !precoDe(p, x.item_id) ? refDe(p, x.item_id) : null);
    const vals = cel.filter(v => v && v.disponivel && v.preco != null).map(v => +v.preco);
    return { x, cel, ref, min: vals.length ? Math.min(...vals) : null };
  });
  const comQtd = itens.some(x => x.qtd);
  const totais = peds.map((p, k) => {
    let t = 0, n = 0;
    linhas.forEach(l => { const v = l.cel[k]; if (v && v.disponivel && v.preco != null) { t += v.preco * (l.x.qtd || 1); n++; } });
    return { t, n };
  });
  const completos = totais.filter(t => t.n === itens.length && t.n > 0).map(t => t.t);
  const melhorTotal = completos.length ? Math.min(...completos) : null;
  const combinado = linhas.reduce((s, l) => s + (l.min != null ? l.min * (l.x.qtd || 1) : 0), 0);
  const faltam = linhas.filter(l => l.min == null).length;
  const aberta = c.status === 'aberta';
  const respostas = peds.filter(p => p.respondido_em || D.precos.some(pr => pr.pedido_id === p.id));

  return `<button class="voltar" data-act="cot-voltar">← Todas as cotações</button>
  <section class="card">
    <h2>📨 ${esc(c.titulo)} ${aberta ? '<span class="tag az">aberta</span>' : '<span class="tag">encerrada</span>'}</h2>
    <div class="sub">Criada em ${dataBR(c.criado_em)}${c.prazo ? ' · prazo para as lojas: <b>' + dataBR(c.prazo) + '</b>' : ''}${c.obs ? ' · ' + esc(c.obs) : ''}</div>
    <h4 style="color:var(--navy);margin:6px 0 2px">Lojas</h4>
    ${peds.map(p => { const l = porId(D.lojas, p.loja_id) || {}; return `<div class="loja-ped">
      <div class="info"><b>${esc(l.nome || '(loja apagada)')}</b><small>${statusPedido(p)}${p.respondente ? ' · por ' + esc(p.respondente) : ''}${p.obs ? ' · “' + esc(p.obs) + '”' : ''}</small></div>
      ${aberta ? `<button class="btn sm zap" data-act="ped-zap" data-id="${p.id}"${primeiroFone(l.telefone) ? '' : ' title="Loja sem WhatsApp cadastrado: escolha o contato no WhatsApp"'}>💬 Enviar</button>
      <button class="btn sm" data-act="ped-copiar" data-id="${p.id}">📋 Link</button>` : ''}
      <button class="btn sm" data-act="ped-manual" data-id="${p.id}" title="A loja passou os preços por telefone? Lance aqui">✍️ Lançar</button>
      <button class="btn sm perigo" data-act="ped-remover" data-id="${p.id}" title="Tirar esta loja da cotação">✕</button></div>`; }).join('') || '<div class="vazio">Nenhuma loja nesta cotação.</div>'}
    <div class="btn-row">
      <button class="btn" data-act="ped-add">＋ Adicionar loja</button>
      ${aberta ? `<button class="btn" data-act="cot-status" data-v="encerrada">🔒 Encerrar cotação</button>` : `<button class="btn" data-act="cot-status" data-v="aberta">🔓 Reabrir</button>`}
      <button class="btn perigo" data-act="cot-apagar">🗑 Apagar</button>
    </div>
  </section>
  <section class="card">
    <h2>📊 Comparativo</h2>
    <div class="sub">${respostas.length ? `Verde = menor preço do item. ${comQtd ? 'O total multiplica pela quantidade pedida.' : ''}` : 'Assim que as lojas responderem, os preços aparecem aqui.'}${linhas.some(l => l.ref.some(Boolean)) ? ' Em cinza: preço que você já tinha pesquisado nos últimos 30 dias (só referência, não entra no total).' : ''}</div>
    ${peds.length && itens.length ? `<div class="tab-wrap"><table class="t">
      <thead><tr><th>Item</th>${comQtd ? '<th class="n">Qtd</th>' : ''}${peds.map(p => `<th class="n">${esc(nomeLoja(p.loja_id))}</th>`).join('')}</tr></thead>
      <tbody>${linhas.map(l => `<tr><td>${esc(l.x.item.nome)} <small style="color:var(--muted)">/${esc(l.x.item.unidade)}</small></td>${comQtd ? `<td class="n">${l.x.qtd ? fmtN(l.x.qtd) : '—'}</td>` : ''}
        ${l.cel.map((v, k) => !v ? (l.ref[k] ? `<td class="n ref" title="Preço lançado em ${dataBR(l.ref[k].data)}, fora desta cotação. Não entra no total.">${money(l.ref[k].preco)}<small>pesquisa ${dataCurta(l.ref[k].data)}</small></td>` : '<td class="n falta">—</td>') : !v.disponivel ? '<td class="n falta" title="A loja não tem">não tem</td>'
          : `<td class="n${+v.preco === l.min ? ' melhor' : ''}"${v.obs ? ` title="${esc(v.obs)}"` : ''}>${money(v.preco)}${v.obs ? ' *' : ''}</td>`).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><td>Total${comQtd ? '' : ' (1 de cada)'}</td>${comQtd ? '<td></td>' : ''}${totais.map(t => `<td class="n${melhorTotal != null && t.n === itens.length && t.t === melhorTotal ? ' melhor' : ''}">${t.n ? money(t.t) : '—'}${t.n && t.n < itens.length ? `<br><small style="font-weight:600;color:var(--muted)">faltam ${itens.length - t.n}</small>` : ''}</td>`).join('')}</tr></tfoot>
    </table></div>
    ${respostas.length ? `<div class="tiles" style="margin-top:12px">
      ${melhorTotal != null ? `<div class="tile"><small>Melhor loja com tudo</small><b style="font-size:17px">${esc(nomeLoja(peds[totais.findIndex(t => t.n === itens.length && t.t === melhorTotal)].loja_id))}</b><div style="color:var(--ok);font-weight:800">${money(melhorTotal)}</div></div>` : ''}
      <div class="tile"><small>Comprando cada item onde é mais barato</small><b style="color:var(--ok)">${money(combinado)}</b>${faltam ? `<div class="hint">${faltam} item(ns) sem preço</div>` : ''}</div>
    </div>` : ''}` : '<div class="vazio">Adicione itens e lojas.</div>'}
  </section>`;
}
function formCotacao() {
  const itens = D.itens.filter(i => i.ativo), lojas = D.lojas.filter(l => l.ativo);
  if (!itens.length || !lojas.length) return toast(!itens.length ? 'Cadastre os itens primeiro (aba Itens).' : 'Cadastre as lojas primeiro (aba Lojas).');
  const prazo = new Date(hojeISO() + 'T12:00:00'); prazo.setDate(prazo.getDate() + 3);
  abrirModal(cab('＋ Nova cotação') + `
    <div class="grid">
      <div class="full"><label>Nome da cotação</label><input id="cTit" placeholder="Ex.: Material obra Smile Flores" value="Cotação ${dataBR(hojeISO())}"></div>
      <div><label>Prazo para as lojas responderem</label><input id="cPrazo" type="date" value="${prazo.toISOString().slice(0, 10)}" min="${hojeISO()}"></div>
      <div><label>Recado para as lojas <em style="font-weight:400;color:var(--muted)">(opcional)</em></label><input id="cObs" placeholder="Ex.: Entrega no Aleixo"></div>
    </div>
    <label style="margin-top:14px">Itens <em style="font-weight:400;color:var(--muted)">— quantidade é opcional</em> <button class="btn sm" data-act="marcar" data-alvo="ci" style="float:right">Marcar todos</button></label>
    <div class="escolha">${itens.map(i => `<div class="op"><input type="checkbox" class="ci" value="${i.id}" id="ci_${i.id}"><label for="ci_${i.id}" class="nm" style="margin:0;font-weight:600;color:var(--ink)">${esc(i.nome)}<small>por ${esc(i.unidade)}</small></label><input class="qtd" data-q="${i.id}" inputmode="decimal" placeholder="Qtd"></div>`).join('')}</div>
    <label style="margin-top:14px">Lojas <button class="btn sm" data-act="marcar" data-alvo="cl" style="float:right">Marcar todas</button></label>
    <div class="escolha">${lojas.map(l => `<div class="op"><input type="checkbox" class="cl" value="${l.id}" id="cl_${l.id}"><label for="cl_${l.id}" class="nm" style="margin:0;font-weight:600;color:var(--ink)">${esc(l.nome)}<small>${esc([l.bairro, l.telefone].filter(Boolean).join(' · ') || 'sem WhatsApp')}</small></label></div>`).join('')}</div>
    <div class="btn-row"><button class="btn pri" data-act="cot-criar" style="flex:1">Criar cotação</button></div>`, true);
}
async function criarCotacao() {
  const titulo = $('#cTit').value.trim(); if (!titulo) return toast('Dê um nome para a cotação.');
  const itens = [...document.querySelectorAll('.ci:checked')].map(c => c.value);
  const lojas = [...document.querySelectorAll('.cl:checked')].map(c => c.value);
  if (!itens.length) return toast('Marque pelo menos um item.');
  if (!lojas.length) return toast('Marque pelo menos uma loja.');
  const c = (await ok(db.from('cot_cotacoes').insert({ empresa_id: EMP, titulo, prazo: $('#cPrazo').value || null, obs: $('#cObs').value.trim() || null }).select()))[0];
  await ok(db.from('cot_cotacao_itens').insert(itens.map(id => {
    const q = toNum(document.querySelector(`[data-q="${id}"]`).value);
    return { cotacao_id: c.id, item_id: id, empresa_id: EMP, qtd: q > 0 ? Math.round(q * 100) / 100 : null };
  })));
  await ok(db.from('cot_pedidos').insert(lojas.map(id => ({ empresa_id: EMP, cotacao_id: c.id, loja_id: id }))));
  fecharModal(); UI.cotAberta = c.id; await carregar(); render();
  toast('Cotação criada! Agora toque em "💬 Enviar" em cada loja.');
}
function mensagemPedido(ped) {
  const c = porId(D.cotacoes, ped.cotacao_id), l = porId(D.lojas, ped.loja_id) || {};
  const its = D.cotItens.filter(x => x.cotacao_id === c.id).map(x => ({ x, i: porId(D.itens, x.item_id) })).filter(o => o.i)
    .sort((a, b) => a.i.nome.localeCompare(b.i.nome, 'pt-BR'))
    .map(({ x, i }) => '- ' + i.nome + (x.qtd ? ` (${fmtN(x.qtd)} ${i.unidade})` : ` (preço por ${i.unidade})`));
  if (its.length > 10) its.splice(8, its.length - 8, `- e mais ${its.length - 8} itens`);
  const contato = (l.contato || '').trim().split(' ')[0];
  return `Olá${contato ? ', ' + contato : ''}! Aqui é da *${CTX.empresa.empresa_nome}*.\n` +
    `Gostaria de uma cotação de preços destes itens:\n\n${its.join('\n')}\n\n` +
    (c.obs ? `Obs.: ${c.obs}\n\n` : '') +
    `Para responder é rápido: toque no link e preencha os preços pelo celular:\n${urlCotar(ped.token)}\n\n` +
    (c.prazo ? `Prazo: até ${dataBR(c.prazo)}.\n` : '') + `Obrigado!`;
}
function formPrecosPedido(pedId) {
  const ped = porId(D.pedidos, pedId), c = porId(D.cotacoes, ped.cotacao_id);
  const itens = D.cotItens.filter(x => x.cotacao_id === c.id).map(x => porId(D.itens, x.item_id)).filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const atual = id => D.precos.find(p => p.pedido_id === pedId && p.item_id === id);
  abrirModal(cab(`✍️ Preços de ${esc(nomeLoja(ped.loja_id))}`) + `
    <div class="sub">A loja passou os preços por telefone ou mensagem? Lance aqui. Se ela responder pelo link depois, a resposta dela substitui esta.</div>
    <div id="pmLista">${itens.map(i => { const a = atual(i.id); return `<div class="lanc" data-item="${i.id}">
      <div class="nome"><b>${esc(i.nome)}</b><small>por ${esc(i.unidade)}</small></div>
      <div class="money"><span>R$</span><input class="lp" inputmode="decimal" placeholder="0,00" value="${a && a.disponivel && a.preco != null ? String(a.preco).replace('.', ',') : ''}"></div>
      <label class="chk"><input type="checkbox" class="ln"${a && !a.disponivel ? ' checked' : ''}> não tem</label></div>`; }).join('')}</div>
    <div class="grid" style="margin-top:10px"><div><label>Como passou</label><select id="pmFonte">${['telefone', 'whatsapp', 'balcao', 'manual'].map(f => `<option value="${f}">${FONTES[f]}</option>`).join('')}</select></div></div>
    <div class="btn-row"><button class="btn pri" data-act="ped-manual-salvar" data-id="${pedId}" style="flex:1">💾 Salvar</button></div>`);
}
async function salvarPrecosPedido(pedId) {
  const ped = porId(D.pedidos, pedId), fonte = $('#pmFonte').value, linhas = [];
  let inval = '';
  document.querySelectorAll('#pmLista .lanc').forEach(el => {
    const nao = el.querySelector('.ln').checked, txt = el.querySelector('.lp').value.trim(), v = toNum(txt);
    if (!nao && !txt) return;
    if (!nao && !(v >= 0 && v < 1e7)) { inval = nomeItem(el.dataset.item); return; }
    linhas.push({ empresa_id: EMP, item_id: el.dataset.item, loja_id: ped.loja_id, preco: nao ? null : Math.round(v * 100) / 100, disponivel: !nao, data: hojeISO(), fonte, pedido_id: pedId, obs: null });
  });
  if (inval) return toast('Preço inválido em: ' + inval);
  await ok(db.from('cot_precos').delete().eq('pedido_id', pedId));
  if (linhas.length) await ok(db.from('cot_precos').insert(linhas));
  fecharModal(); toast('Preços salvos.'); await carregar(); render();
}
function formAddLoja() {
  const c = porId(D.cotacoes, UI.cotAberta);
  const ja = new Set(D.pedidos.filter(p => p.cotacao_id === c.id).map(p => p.loja_id));
  const lojas = D.lojas.filter(l => l.ativo && !ja.has(l.id));
  abrirModal(cab('＋ Adicionar loja à cotação') + (lojas.length ? `<div class="escolha">${lojas.map(l => `<div class="op"><input type="checkbox" class="cl" value="${l.id}" id="al_${l.id}"><label for="al_${l.id}" class="nm" style="margin:0;font-weight:600;color:var(--ink)">${esc(l.nome)}<small>${esc(l.bairro || '')}</small></label></div>`).join('')}</div>`
    : '<div class="vazio">Todas as lojas já estão nesta cotação.</div>') +
    `<div class="btn-row"><button class="btn" data-act="loja-nova-cot">＋ Cadastrar loja nova</button>${lojas.length ? '<button class="btn pri" data-act="ped-add-salvar" style="flex:1">Adicionar</button>' : ''}</div>`);
}

/* ---------------- 🤖 robô de pesquisa na internet ----------------
   O robô (tarefa agendada do Claude) grava robo/achados.json no GitHub.
   Aqui o dono vê os achados e guarda no histórico o que fizer sentido. */
const NET = { dados: null, erro: null, carregado: false };
async function carregarInternet() {
  try {
    const r = await fetch(P.raiz + 'robo/achados.json?t=' + Date.now(), { cache: 'no-store' });
    NET.dados = r.ok ? await r.json() : null; NET.erro = r.ok ? null : (r.status === 404 ? 'vazio' : 'HTTP ' + r.status);
  } catch (e) { NET.dados = null; NET.erro = 'rede'; }
  NET.carregado = true;
}
const normal = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
function itemParecido(termo) {
  try { const m = JSON.parse(localStorage.getItem('cot_robo_mapa') || '{}'); if (m[termo] && porId(D.itens, m[termo])) return m[termo]; } catch (e) {}
  // palavras inteiras em comum ÷ palavras no total (assim "colado" não casa com "cola")
  const LIXO = new Set(['de', 'da', 'do', 'para', 'com', 'e', 'x']);
  const pal = s => new Set(normal(s).split(/\s+/).filter(p => p && !LIXO.has(p)));
  const A = pal(termo);
  let melhor = null, nota = 0;
  D.itens.filter(i => i.ativo).forEach(i => {
    const B = pal(i.nome), comum = [...A].filter(p => B.has(p)).length, k = comum / (new Set([...A, ...B]).size || 1);
    if (k > nota) { nota = k; melhor = i.id; }
  });
  return nota >= 0.4 ? melhor : '';
}
const valorOferta = o => o.preco_unidade != null ? +o.preco_unidade : null;
function jaGuardado(o, itemId) {
  const l = D.lojas.find(x => normal(x.nome) === normal(o.loja));
  return !!l && D.precos.some(p => p.item_id === itemId && p.loja_id === l.id && p.fonte === 'site' && p.data === (o.data || '') && +p.preco === valorOferta(o));
}
/* ---- filtros da aba Internet (barra lateral) ---- */
const MARCAS = ['Tekbond', 'Kisafix', 'Cascola', 'Quartzolit', 'Vedacit', 'Vedapren', 'Coral', 'Suvinil', 'Eucatex', 'Eucafloor', 'Iquine',
  'Nova Tintas', 'Leinertex', 'Durafloor', 'Tarkett', 'Biancogres', 'Casa Grassi', 'Ruffino', 'Pix Revestimentos', 'Tubrax', 'Graddus',
  'Kalla Decor', 'Santa Luzia', 'Formix', 'Placo', 'Knauf', 'Mapei', 'Euro Decor', 'Dryko', 'Hiperpren', 'NFR', 'Scandian', 'Kapazi',
  'Protec', 'UniPega', 'Flexfloor', 'Moldufama', 'Armstrong', 'Hunter Douglas', 'Eurogramas'];
NET.f = { q: '', itens: new Set(), locais: new Set(), sites: new Set(), marcas: new Set(), min: '', max: '', frete: false, promo: false, semConferir: false, ordem: 'preco', aberto: false };
const siteDe = o => String(o.loja || '').split(/\s+[–-]\s+/)[0].trim() || 'Outro';
function marcaDe(o) {
  if (o.marca) return o.marca;
  // ignora o aviso "(equivalente, não é X)" e fica com a marca que aparece primeiro no título
  const t = normal(String(o.titulo || '').replace(/\(equivalente[^)]*\)/gi, '') + ' ' + o.loja);
  let m = null, pos = 1e9;
  MARCAS.forEach(x => { const i = t.indexOf(normal(x).trim()); if (i >= 0 && i < pos) { pos = i; m = x; } });
  return m === 'Vedapren' ? 'Vedacit' : (m || 'Outras');
}
const temFrete = o => !!o.frete_manaus || /frete gr[aá]tis/i.test(o.obs || '');
function passaFiltro(o, termo) {
  const F = NET.f, v = valorOferta(o);
  if (F.itens.size && !F.itens.has(termo)) return false;
  if (F.locais.size && !F.locais.has(o.local === 'Manaus' ? 'Manaus' : 'online')) return false;
  if (F.sites.size && !F.sites.has(siteDe(o))) return false;
  if (F.marcas.size && !F.marcas.has(marcaDe(o))) return false;
  if (F.frete && !temFrete(o)) return false;
  if (F.promo && !ehPromo(o)) return false;
  if (F.semConferir && /conferir/i.test(o.obs || '')) return false;
  const mn = toNum(F.min), mx = toNum(F.max);
  if (!isNaN(mn) && (v == null || v < mn)) return false;
  if (!isNaN(mx) && (v == null || v > mx)) return false;
  if (F.q.trim()) { const q = normal(F.q); if (!normal(o.titulo + ' ' + o.loja + ' ' + termo).includes(q.trim())) return false; }
  return true;
}
function ehPromo(o) { return !!(o && (o.promocao || /promo[çc][ãa]o|oferta do dia|black friday|cupom/i.test(o.obs || ''))); }
function nFiltros() { const F = NET.f; return F.itens.size + F.locais.size + F.sites.size + F.marcas.size + (F.min ? 1 : 0) + (F.max ? 1 : 0) + (F.frete ? 1 : 0) + (F.promo ? 1 : 0) + (F.semConferir ? 1 : 0) + (F.q.trim() ? 1 : 0); }
function painelFiltros(d) {
  const F = NET.f, todas = d.itens.flatMap(i => (i.ofertas || []).map(o => ({ o, t: i.termo })));
  const conta = fn => { const m = new Map(); todas.forEach(x => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR')); };
  const grupo = (titulo, chave, lista, rot = x => x) => `<div class="nf-g"><div class="nf-t">${titulo}</div>
    ${lista.map(([v, n]) => `<label class="nf-op"><input type="checkbox" data-nf="${chave}" value="${esc(v)}"${F[chave].has(v) ? ' checked' : ''}><span>${esc(rot(v))}</span><small>${n}</small></label>`).join('')}</div>`;
  const n = nFiltros();
  return `<aside class="net-filtros${F.aberto ? ' aberto' : ''}">
    <button class="nf-abrir" data-act="nf-toggle">⚙️ Filtros${n ? ` <span class="tag lar">${n}</span>` : ''} <span>${F.aberto ? '▲' : '▼'}</span></button>
    <div class="nf-corpo">
      <div class="nf-g"><input id="nfBusca" placeholder="🔎 Procurar (marca, loja…)" value="${esc(F.q)}"></div>
      <div class="nf-g"><div class="nf-t">Ordenar</div>
        <select id="nfOrdem"><option value="preco"${F.ordem === 'preco' ? ' selected' : ''}>Menor preço primeiro</option><option value="loja"${F.ordem === 'loja' ? ' selected' : ''}>Por loja (A–Z)</option></select></div>
      ${grupo('Onde', 'locais', conta(x => x.o.local === 'Manaus' ? 'Manaus' : 'online'), v => v === 'Manaus' ? '📍 Manaus' : '🌐 Fora (internet)')}
      ${grupo('Item', 'itens', d.itens.map(i => [i.termo, (i.ofertas || []).length]))}
      <div class="nf-g"><div class="nf-t">Preço por unidade (R$)</div>
        <div class="nf-preco"><input id="nfMin" inputmode="decimal" placeholder="mín." value="${esc(F.min)}"><span>até</span><input id="nfMax" inputmode="decimal" placeholder="máx." value="${esc(F.max)}"></div>
        <div class="hint">Use junto com um item só (cada item tem a sua unidade).</div></div>
      ${grupo('Marca', 'marcas', conta(x => marcaDe(x.o)).sort((a, b) => (a[0] === 'Outras') - (b[0] === 'Outras')))}
      ${grupo('Loja / site', 'sites', conta(x => siteDe(x.o)))}
      <div class="nf-g"><div class="nf-t">Outros</div>
        <label class="nf-op"><input type="checkbox" id="nfPromo"${F.promo ? ' checked' : ''}><span>🔥 Só promoções</span></label>
        <label class="nf-op"><input type="checkbox" id="nfFrete"${F.frete ? ' checked' : ''}><span>🚚 Com frete informado / grátis</span></label>
        <label class="nf-op"><input type="checkbox" id="nfConf"${F.semConferir ? ' checked' : ''}><span>Esconder preços "conferir"</span></label></div>
      ${n ? '<button class="btn sm" data-act="nf-limpar" style="width:100%">✕ Limpar filtros</button>' : ''}
    </div>
  </aside>`;
}

function telaInternet() {
  if (!NET.carregado) { carregarInternet().then(render); return '<div class="carregando">Buscando o que o robô encontrou…</div>'; }
  const d = NET.dados;
  if (!d || !Array.isArray(d.itens)) return `<section class="card"><div class="vazio"><b>O robô ainda não trouxe resultados</b>
    ${NET.erro === 'rede' ? 'Sem internet agora. Tente de novo.' : 'Ele pesquisa todo dia de manhã e os achados aparecem aqui.'}</div></section>`;
  const comOferta = d.itens.filter(i => (i.ofertas || []).length);
  return `<section class="card">
    <h2>🤖 Preços encontrados na internet</h2>
    <div class="sub">O robô pesquisa <b>todo dia às 7h30</b> em <b>📍 Manaus</b> (lojas da cidade, Bemol, OLX Manaus…) e <b>🌐 fora</b>
      (Mercado Livre, Amazon, Magalu, Shopee, MadeiraMadeira…). <b>Confira antes de guardar</b>: o preço de fora normalmente não inclui o frete até Manaus.</div>
    <div class="tiles"><div class="tile"><small>Última pesquisa</small><b style="font-size:17px">${d.atualizado_em ? haQuanto(d.atualizado_em) : '—'}</b><div class="hint">${d.atualizado_em ? new Date(d.atualizado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</div></div>
      <div class="tile"><small>🔥 Promoções</small><b>${d.itens.reduce((s, i) => s + (i.ofertas || []).filter(ehPromo).length, 0)}</b><div class="hint">${d.itens.some(i => (i.ofertas || []).some(ehPromo)) ? 'use o filtro "Só promoções"' : 'nenhuma nesta pesquisa'}</div></div>
      <div class="tile"><small>Itens com ofertas</small><b>${comOferta.length}<span style="font-size:14px;color:var(--muted)"> / ${d.itens.length}</span></b></div>
      <div class="tile"><small>Ofertas 📍 Manaus / 🌐 fora</small><b>${d.itens.reduce((s, i) => s + (i.ofertas || []).filter(o => o.local === 'Manaus').length, 0)}<span style="font-size:14px;color:var(--muted)"> / ${d.itens.reduce((s, i) => s + (i.ofertas || []).filter(o => o.local !== 'Manaus').length, 0)}</span></b></div></div>
  </section>
  <div class="net-layout">
  ${painelFiltros(d)}
  <div class="net-res">
  ${(() => { const vis = d.itens.filter(it => (it.ofertas || []).some(o => passaFiltro(o, it.termo)) || (!nFiltros() )); return vis.length ? '' : '<section class="card"><div class="vazio"><b>Nenhuma oferta com esses filtros</b>Tire algum filtro na barra ao lado.</div></section>'; })()}
  ${d.itens.map((it, k) => {
    const ord = a => a.slice().sort(NET.f.ordem === 'loja' ? (x, y) => String(x.loja).localeCompare(String(y.loja), 'pt-BR') : (x, y) => (valorOferta(x) ?? 1e12) - (valorOferta(y) ?? 1e12));
    const todasSemFiltro = it.ofertas || [];
    const todas = todasSemFiltro.filter(o => passaFiltro(o, it.termo));
    if (nFiltros() && !todas.length) return '';
    const man = ord(todas.filter(o => o.local === 'Manaus')), fora = ord(todas.filter(o => o.local !== 'Manaus'));
    const suspeito = o => /conferir/i.test(o.obs || '');
    const menor = l => l.find(o => valorOferta(o) != null && !suspeito(o)) || null;
    const mM = menor(man), mF = menor(fora);
    const mapa = itemParecido(it.termo);
    const linha = (o, destaque) => `<tr${destaque ? ' class="melhor"' : ''}><td><b>${esc(o.loja)}</b>${ehPromo(o) ? '<br><span class="tag lar">🔥 promoção</span>' : ''}</td>
      <td>${o.url && /^https?:\/\//.test(o.url) ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.titulo || 'abrir')}</a>` : esc(o.titulo || '')}${o.promocao ? `<br><small style="color:var(--orange-ink);font-weight:700">🔥 ${esc(o.promocao)}</small>` : ''}${o.obs ? `<br><small style="color:var(--muted)">${esc(o.obs)}</small>` : ''}${o.frete_manaus ? `<br><small style="color:var(--orange-ink)">🚚 ${esc(o.frete_manaus)}</small>` : ''}</td>
      <td class="n">${money(o.preco)}<br><small style="color:var(--muted)">${esc(o.oferta_un || '')}</small></td>
      <td class="n"><b>${valorOferta(o) != null ? money(valorOferta(o)) : '—'}</b></td>
      <td class="n">${mapa && jaGuardado(o, mapa) ? '<span class="tag ok">guardado</span>' : ''}</td></tr>`;
    const grupo = (titulo, lista, vazio) => `<tr class="grupo"><td colspan="5">${titulo} <small>(${lista.length})</small></td></tr>` +
      (lista.length ? lista.map(o => linha(o, o === menor(lista))).join('') : `<tr><td colspan="5" class="falta">${vazio}</td></tr>`);
    let comp = '';
    if (mM && mF) {
      const dif = (valorOferta(mM) / valorOferta(mF) - 1) * 100;
      comp = Math.abs(dif) < 1 ? '<span class="tag">mesmo preço</span>'
        : dif > 0 ? `<span class="tag lar">Manaus ${fmtN(dif)}% mais caro</span>` : `<span class="tag ok">Manaus ${fmtN(-dif)}% mais barato</span>`;
    }
    const mostrarM = !NET.f.locais.size || NET.f.locais.has('Manaus'), mostrarF = !NET.f.locais.size || NET.f.locais.has('online');
    return `<section class="card">
      <h2>${esc(it.termo)} <span class="tag">${esc(it.unidade || '')}</span>
        ${todas.length ? `<button class="btn sm dir" data-act="net-guardar" data-k="${k}">💾 Guardar no histórico</button>` : ''}</h2>
      <div class="comp">
        <div class="comp-c"><small>📍 Menor em Manaus</small><b>${mM ? money(valorOferta(mM)) : '—'}</b><span>${mM ? esc(mM.loja) : 'sem preço publicado'}</span></div>
        <div class="comp-c"><small>🌐 Menor fora</small><b>${mF ? money(valorOferta(mF)) : '—'}</b><span>${mF ? esc(mF.loja) + (mF.frete_manaus ? ' · 🚚 ' + esc(mF.frete_manaus) : ' · + frete') : 'sem oferta'}</span></div>
        ${comp ? `<div class="comp-c comp-dif">${comp}</div>` : ''}
      </div>
      ${mapa ? `<div class="hint" style="margin:8px 0">Vai para o item: <b>${esc(nomeItem(mapa))}</b></div>` : ''}
      ${it.nota ? `<div class="sub">${esc(it.nota)}</div>` : ''}
      ${todas.length ? `<div class="tab-wrap"><table class="t"><thead><tr><th>Onde</th><th>Anúncio</th><th class="n">Preço</th><th class="n">Por ${esc(it.unidade || 'un')}</th><th></th></tr></thead><tbody>
        ${mostrarM ? grupo('📍 Manaus', man, 'Nenhum preço publicado em Manaus nesta pesquisa. Use a aba Pedir cotação.') : ''}
        ${mostrarF ? grupo('🌐 Fora (internet)', fora, 'Nada encontrado fora.') : ''}
      </tbody></table></div>` : '<div class="vazio" style="padding:12px">Nada confiável encontrado nesta pesquisa.</div>'}
    </section>`;
  }).join('')}
  </div></div>`;
}
function formGuardarNet(k) {
  const it = NET.dados.itens[k], ofs = (it.ofertas || []).map((o, j) => ({ o, j })).filter(x => valorOferta(x.o) != null);
  if (!ofs.length) return toast('Nenhuma oferta com preço por ' + (it.unidade || 'unidade') + ' para guardar.');
  const sel = itemParecido(it.termo);
  abrirModal(cab('💾 Guardar no histórico') + `
    <div class="sub">Os preços entram no histórico como <b>Site</b>, com a data da pesquisa. Cada site vira uma "loja" (marcada como internet).</div>
    <label>Em qual item seu?</label>
    <select id="ngItem"><option value="">Escolha…</option>${D.itens.filter(i => i.ativo).map(i => `<option value="${i.id}"${i.id === sel ? ' selected' : ''}>${esc(i.nome)} (${esc(i.unidade)})</option>`).join('')}<option value="__novo">＋ Criar o item "${esc(it.termo)}"</option></select>
    <label style="margin-top:14px">Ofertas</label>
    <div class="escolha">${ofs.map(({ o, j }) => `<div class="op"><input type="checkbox" class="ng" value="${j}" id="ng_${j}" checked>
      <label for="ng_${j}" class="nm" style="margin:0;font-weight:600;color:var(--ink)">${esc(o.loja)} — ${money(valorOferta(o))}/${esc(it.unidade || 'un')}<small>${esc(o.titulo || '')}${o.local === 'Manaus' ? ' · 📍 Manaus' : ' · 🌐 fora' + (o.frete_manaus ? ' · 🚚 ' + esc(o.frete_manaus) : '')}</small></label></div>`).join('')}</div>
    <div class="btn-row"><button class="btn pri" data-act="net-guardar-ok" data-k="${k}" style="flex:1">💾 Guardar marcados</button></div>`);
}
async function guardarNet(k) {
  const it = NET.dados.itens[k];
  let itemId = $('#ngItem').value;
  const marcados = [...document.querySelectorAll('.ng:checked')].map(c => it.ofertas[+c.value]);
  if (!itemId) return toast('Escolha o item.');
  if (!marcados.length) return toast('Marque pelo menos uma oferta.');
  if (itemId === '__novo') itemId = (await ok(db.from('cot_itens').insert({ empresa_id: EMP, nome: it.termo.slice(0, 160), unidade: (it.unidade || 'un').slice(0, 20), categoria: null, obs: null }).select()))[0].id;
  try { const m = JSON.parse(localStorage.getItem('cot_robo_mapa') || '{}'); m[it.termo] = itemId; localStorage.setItem('cot_robo_mapa', JSON.stringify(m)); } catch (e) {}
  await carregar();
  let n = 0, pulados = 0;
  for (const o of marcados) {
    if (jaGuardado(o, itemId)) { pulados++; continue; }
    let l = D.lojas.find(x => normal(x.nome) === normal(o.loja));
    if (!l) { l = (await ok(db.from('cot_lojas').insert({ empresa_id: EMP, nome: String(o.loja).slice(0, 120), telefone: null, bairro: o.local === 'Manaus' ? 'Manaus (internet)' : 'Internet', contato: null, obs: 'Criada pelo robô de pesquisa' }).select()))[0]; D.lojas.push(l); }
    const data = /^\d{4}-\d{2}-\d{2}$/.test(o.data || '') ? o.data : String(NET.dados.atualizado_em || hojeISO()).slice(0, 10);
    await ok(db.from('cot_precos').insert({ empresa_id: EMP, item_id: itemId, loja_id: l.id, preco: Math.round(valorOferta(o) * 100) / 100, disponivel: true, data, fonte: 'site', pedido_id: null, obs: String(o.url || o.titulo || '').slice(0, 300) || null }));
    n++;
  }
  fecharModal(); await carregar(); render();
  toast(`${n} preço(s) guardado(s)${pulados ? `, ${pulados} já estava(m) guardado(s)` : ''}.`);
}

/* ---------------- telas e eventos ---------------- */
function renderMantendoRolagem() { const y = scrollY, ps = document.querySelector('.nf-corpo'), py = ps ? ps.scrollTop : 0; render(); scrollTo(0, y); const n = document.querySelector('.nf-corpo'); if (n) n.scrollTop = py; }
function render() {
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('on', b.dataset.aba === UI.aba));
  const tela = { mercado: telaMercado, precos: telaPrecos, cotacoes: telaCotacoes, internet: telaInternet, itens: telaItens, lojas: telaLojas }[UI.aba];
  $('#conteudo').innerHTML = tela();
}

document.addEventListener('click', async e => {
  const ab = e.target.closest('#abas button');
  if (ab) { UI.aba = ab.dataset.aba; if (UI.aba !== 'cotacoes') UI.cotAberta = null; render(); scrollTo({ top: 0 }); return; }
  if (e.target.id === 'modal') return fecharModal();
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  try {
    switch (b.dataset.act) {
      case 'fechar': return fecharModal();
      case 'aba': UI.aba = b.dataset.aba; return render();
      case 'recarregar': await carregar(); if (UI.aba === 'internet') await carregarInternet(); render(); return toast('Atualizado.');
      case 'net-guardar': return formGuardarNet(+b.dataset.k);
      case 'nf-toggle': NET.f.aberto = !NET.f.aberto; return render();
      case 'nf-limpar': Object.assign(NET.f, { q: '', itens: new Set(), locais: new Set(), sites: new Set(), marcas: new Set(), min: '', max: '', frete: false, promo: false, semConferir: false }); return render();
      case 'net-guardar-ok': return await guardarNet(+b.dataset.k);
      case 'item': return abrirItem(id);
      case 'lancar-item': fecharModal(); UI.aba = 'precos'; UI.lanc.busca = nomeItem(id); render(); return;
      case 'del-preco':
        if (!confirm('Apagar este preço?')) return;
        await ok(db.from('cot_precos').delete().eq('id', id)); await carregar();
        if (b.dataset.item) abrirItem(b.dataset.item); render(); return toast('Preço apagado.');
      case 'salvar-lanc': return await salvarLancamento();
      case 'item-novo': return formItem();
      case 'item-editar': return formItem(porId(D.itens, id));
      case 'item-salvar': return await salvarItem(id);
      case 'item-apagar':
        if (!confirm('Apagar este item e TODO o histórico de preços dele?\n\nSe quiser só esconder, use "Arquivar".')) return;
        await ok(db.from('cot_itens').delete().eq('id', id)); fecharModal(); await carregar(); render(); return toast('Item apagado.');
      case 'itens-varios':
        return abrirModal(cab('📝 Vários itens de uma vez') + `<div class="sub">Um item por linha. Se quiser, separe a unidade e a categoria com ponto e vírgula.</div>
          <textarea id="vLista" rows="9" placeholder="Piso vinílico 2 mm; m²; Pisos&#10;Cola para piso vinílico; balde; Pisos&#10;Rodapé poliestireno 7 cm; barra; Rodapés&#10;Placa de drywall ST 1,20 × 1,80; placa"></textarea>
          <div class="btn-row"><button class="btn pri" data-act="itens-varios-salvar" style="flex:1">Adicionar</button></div>`);
      case 'itens-varios-salvar': {
        const ja = new Set(D.itens.map(i => i.nome.toLowerCase()));
        const novos = $('#vLista').value.split('\n').map(l => l.split(';').map(s => s.trim())).filter(p => p[0] && !ja.has(p[0].toLowerCase()))
          .map(([nome, un, cat]) => ({ empresa_id: EMP, nome: nome.slice(0, 160), unidade: (un || 'un').slice(0, 20), categoria: cat ? cat.slice(0, 60) : null, obs: null }));
        if (!novos.length) return toast('Nada novo para adicionar.');
        await ok(db.from('cot_itens').insert(novos)); fecharModal(); await carregar(); render(); return toast(novos.length + ' item(ns) adicionado(s).');
      }
      case 'loja-nova': return formLoja();
      case 'loja-editar': return formLoja(porId(D.lojas, id));
      case 'loja-salvar': return await salvarLoja(id);
      case 'loja-apagar':
        if (!confirm('Apagar esta loja e TODOS os preços dela?\n\nSe quiser só esconder, use "Arquivar".')) return;
        await ok(db.from('cot_lojas').delete().eq('id', id)); fecharModal(); await carregar(); render(); return toast('Loja apagada.');
      case 'loja-zap': { const l = porId(D.lojas, id); return abrirWhats(primeiroFone(l.telefone), `Olá${l.contato ? ', ' + l.contato.split(' ')[0] : ''}! Aqui é da *${CTX.empresa.empresa_nome}*.`); }
      case 'cot-nova': return formCotacao();
      case 'marcar': { const cs = [...document.querySelectorAll('.' + b.dataset.alvo)]; const todos = cs.every(c => c.checked); cs.forEach(c => c.checked = !todos); return; }
      case 'cot-criar': return await criarCotacao();
      case 'cot-abrir': UI.cotAberta = id; render(); return scrollTo({ top: 0 });
      case 'cot-voltar': UI.cotAberta = null; return render();
      case 'cot-status': await ok(db.from('cot_cotacoes').update({ status: b.dataset.v }).eq('id', UI.cotAberta)); await carregar(); render();
        return toast(b.dataset.v === 'aberta' ? 'Cotação reaberta: as lojas podem responder de novo.' : 'Cotação encerrada: os links não aceitam mais respostas.');
      case 'cot-apagar':
        if (!confirm('Apagar esta cotação? Os links param de funcionar.\n\nOs preços que as lojas mandaram continuam no histórico do mercado.')) return;
        await ok(db.from('cot_cotacoes').delete().eq('id', UI.cotAberta)); UI.cotAberta = null; await carregar(); render(); return toast('Cotação apagada.');
      case 'ped-zap': { const p = porId(D.pedidos, id), l = porId(D.lojas, p.loja_id) || {}; return abrirWhats(primeiroFone(l.telefone), mensagemPedido(p)); }
      case 'ped-copiar': return copiar(urlCotar(porId(D.pedidos, id).token));
      case 'ped-manual': return formPrecosPedido(id);
      case 'ped-manual-salvar': return await salvarPrecosPedido(id);
      case 'ped-remover':
        if (!confirm('Tirar esta loja da cotação? O link dela para de funcionar.')) return;
        await ok(db.from('cot_pedidos').delete().eq('id', id)); await carregar(); render(); return;
      case 'ped-add': return formAddLoja();
      case 'ped-add-salvar': {
        const lojas = [...document.querySelectorAll('.cl:checked')].map(c => c.value);
        if (!lojas.length) return toast('Marque uma loja.');
        await ok(db.from('cot_pedidos').insert(lojas.map(l => ({ empresa_id: EMP, cotacao_id: UI.cotAberta, loja_id: l }))));
        fecharModal(); await carregar(); render(); return;
      }
      case 'loja-nova-cot': return formLoja({}, async nova => { await ok(db.from('cot_pedidos').insert({ empresa_id: EMP, cotacao_id: UI.cotAberta, loja_id: nova.id })); await carregar(); render(); });
    }
  } catch (err) { erro(err); }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'nfBusca') { NET.f.q = t.value; clearTimeout(NET._t); NET._t = setTimeout(() => { const pos = t.selectionStart; renderMantendoRolagem(); const n = $('#nfBusca'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); return; }
  if (t.id === 'fBusca') { UI.busca = t.value; const pos = t.selectionStart; render(); const n = $('#fBusca'); n.focus(); n.setSelectionRange(pos, pos); }
  if (t.id === 'lBusca') {
    UI.lanc.busca = t.value; const q = t.value.trim().toLowerCase();
    document.querySelectorAll('#lLista .lanc').forEach(el => { el.hidden = !!q && !nomeItem(el.dataset.item).toLowerCase().includes(q); });
  }
  if (t.classList.contains('lp') && t.value.trim()) { const c = t.closest('.lanc').querySelector('.ln'); if (c) c.checked = false; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.nf) { const S = NET.f[t.dataset.nf]; t.checked ? S.add(t.value) : S.delete(t.value); return renderMantendoRolagem(); }
  if (t.id === 'nfOrdem') { NET.f.ordem = t.value; return renderMantendoRolagem(); }
  if (t.id === 'nfFrete') { NET.f.frete = t.checked; return renderMantendoRolagem(); }
  if (t.id === 'nfPromo') { NET.f.promo = t.checked; return renderMantendoRolagem(); }
  if (t.id === 'nfConf') { NET.f.semConferir = t.checked; return renderMantendoRolagem(); }
  if (t.id === 'nfMin' || t.id === 'nfMax') { NET.f[t.id === 'nfMin' ? 'min' : 'max'] = t.value; return renderMantendoRolagem(); }
  if (t.id === 'fCat') { UI.categoria = t.value; render(); }
  if (t.id === 'fPeriodo') { UI.periodo = +t.value; render(); }
  if (t.id === 'lData') UI.lanc.data = t.value;
  if (t.id === 'lFonte') UI.lanc.fonte = t.value;
  if (t.id === 'lLoja') {
    if (t.value === '__nova') { t.value = UI.lanc.loja; return formLoja({}, nova => { UI.lanc.loja = nova.id; }); }
    // não perder o que já foi digitado ao trocar de loja
    const digitados = [...document.querySelectorAll('#lLista .lp')].some(i => i.value.trim());
    if (digitados && !confirm('Trocar de loja apaga os preços digitados e ainda não salvos. Continuar?')) { t.value = UI.lanc.loja; return; }
    UI.lanc.loja = t.value; render();
    const bq = $('#lBusca'); if (bq && UI.lanc.busca) bq.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (t.classList.contains('ln') && t.checked) { const i = t.closest('.lanc').querySelector('.lp'); if (i) i.value = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) fecharModal(); });
// respostas novas das lojas: atualiza ao voltar para a aba do navegador
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !EMP || !$('#modal').hidden) return;
  if (document.querySelector('#lLista .lp') && [...document.querySelectorAll('#lLista .lp')].some(i => i.value.trim())) return;
  try { await carregar(); render(); } catch (e) {}
});

(async () => {
  try {
    CTX = await P.exigirModulo('cotacoes'); if (!CTX) return;
    EMP = CTX.empresa.empresa_id;
    P.barraModulo(CTX, 'Cotações');
    $('#subtitulo').textContent = CTX.empresa.empresa_nome + ' · preços do mercado';
    await carregar(); render();
  } catch (e) { erro(e); $('#conteudo').innerHTML = '<div class="carregando">Não foi possível carregar. Verifique a internet e se a atualização 005 foi rodada no Supabase.</div>'; }
})();
})();
