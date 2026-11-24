/* Leitor de CT-e (DACTE em PDF, foto ou XML) — roda inteiro no navegador.
   Nada é consultado na SEFAZ. O resultado só preenche o formulário; quem confirma é o gestor.
   - XML: leitura exata das tags do CT-e.
   - PDF: texto do DACTE via pdf.js (mesma biblioteca do Romaneio).
   - Foto: código de barras da chave (BarcodeDetector, quando o navegador tem) + OCR em português
     (Tesseract.js, baixado na primeira foto; a imagem não sai do aparelho).
   A chave de acesso é conferida pelo dígito verificador e "abre" número, série, modelo,
   CNPJ do emitente e mês/ano de emissão. */
(() => {
'use strict';
const UFS = { 11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF' };
const MODAIS = { '01':'Rodoviário','02':'Aéreo','03':'Aquaviário','04':'Ferroviário','05':'Dutoviário','06':'Multimodal' };
const TPSERV = { '0':'Normal','1':'Subcontratação','2':'Redespacho','3':'Redespacho intermediário','4':'Serviço vinculado a multimodal' };
const UNID = { '00':'M3','01':'KG','02':'TON','03':'UNIDADE','04':'LITROS','05':'MMBTU' };
const so = s => String(s || '').replace(/\D/g, '');
const fmtDoc = d => d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d;
const num = s => { s = String(s || '').trim(); if (!s) return ''; if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); const v = Number(s); return Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : ''; };
const limpa = s => String(s || '').replace(/\s+/g, ' ').replace(/^[\s:.\-–]+|[\s:.\-–]+$/g, '').trim();

/* ---------- chave de acesso ---------- */
function dvOk(ch) {
  if (!/^\d{44}$/.test(ch)) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(ch[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11, dv = r < 2 ? 0 : 11 - r;
  return dv === Number(ch[43]);
}
function abrirChave(ch) {
  return { uf: UFS[ch.slice(0, 2)] || '', ano: '20' + ch.slice(2, 4), mes: ch.slice(4, 6), cnpj: ch.slice(6, 20), modelo: ch.slice(20, 22), serie: String(Number(ch.slice(22, 25))), numero: String(Number(ch.slice(25, 34))) };
}
// Todas as sequências de 44 dígitos (com espaços/pontos no meio) com DV correto.
function chavesNoTexto(txt) {
  const out = new Set(), t = String(txt || '');
  for (const m of t.matchAll(/\d[\d .\-]{42,80}\d/g)) {
    const d = so(m[0]);
    for (let i = 0; i + 44 <= d.length; i++) { const c = d.slice(i, i + 44); if (dvOk(c)) out.add(c); }
  }
  return [...out];
}

/* ---------- XML ---------- */
function lerXml(raw) {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error('XML com DTD/entidades não é aceito.');
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('XML inválido.');
  const all = (root, name) => [...(root || doc).getElementsByTagName('*')].filter(x => x.localName === name);
  const el = (root, name) => all(root, name)[0];
  const v = (root, ...names) => { for (const n of names) { const e = el(root, n); if (e && e.textContent.trim()) return e.textContent.trim(); } return ''; };
  const inf = el(doc, 'infCte'); if (!inf) throw Error('Este XML não é de um CT-e.');
  const ide = el(inf, 'ide'), emit = el(inf, 'emit');
  let chave = so(inf.getAttribute('Id')); if (!dvOk(chave)) chave = so(v(doc, 'chCTe'));
  const parte = tag => { const e = el(inf, tag); if (!e) return {}; const en = [...e.children].find(c => /^ender/.test(c.localName)); return { nome: v(e, 'xNome'), doc: so(v(e, 'CNPJ', 'CPF')), mun: en ? v(en, 'xMun') : '', uf: en ? v(en, 'UF') : '', end: en ? limpa([v(en, 'xLgr'), v(en, 'nro'), v(en, 'xBairro')].filter(Boolean).join(', ')) : '' }; };
  const rem = parte('rem'), dest = parte('dest'), exped = parte('exped'), receb = parte('receb');
  // Tomador: toma3/toma4 (código 0 rem, 1 exped, 2 receb, 3 dest, 4 outro)
  let toma = {}; const t3 = el(inf, 'toma3') || el(inf, 'toma'), t4 = el(inf, 'toma4');
  if (t4) toma = { nome: v(t4, 'xNome'), doc: so(v(t4, 'CNPJ', 'CPF')) };
  else if (t3) toma = [rem, exped, receb, dest][Number(v(t3, 'toma'))] || {};
  const vPrest = el(inf, 'vPrest'), comps = all(vPrest, 'Comp').map(c => ({ n: v(c, 'xNome'), v: Number(v(c, 'vComp')) || 0 }));
  const ped = comps.filter(c => /ped[aá]gio/i.test(c.n)).reduce((a, c) => a + c.v, 0), total = Number(v(vPrest, 'vTPrest')) || 0;
  const icms = el(inf, 'ICMS'), carga = el(inf, 'infCarga');
  const qs = all(carga, 'infQ').map(q => ({ u: v(q, 'cUnid'), t: v(q, 'tpMed'), q: v(q, 'qCarga') }));
  const kg = qs.find(q => q.u === '01' && /bruto|peso/i.test(q.t)) || qs.find(q => q.u === '01');
  const notas = all(inf, 'infNFe').map(x => v(x, 'chave')).filter(Boolean).concat(all(inf, 'infNF').map(x => v(x, 'nDoc')).filter(Boolean));
  const dh = v(ide, 'dhEmi');
  const placas = all(inf, 'placa').map(x => x.textContent.trim().toUpperCase());
  const c = {
    chave_acesso: chave, numero: v(ide, 'nCT'), serie: v(ide, 'serie'), modelo: v(ide, 'mod'), emissao: dh ? dh.slice(0, 16) : '',
    cfop: v(ide, 'CFOP'), natureza: v(ide, 'natOp'), modal: MODAIS[v(ide, 'modal')] || '', tipo_servico: TPSERV[v(ide, 'tpServ')] || '', protocolo: v(doc, 'nProt'),
    emitente: v(emit, 'xNome'), emitente_doc: fmtDoc(so(v(emit, 'CNPJ', 'CPF'))),
    remetente: rem.nome || '', remetente_doc: fmtDoc(rem.doc || ''), destinatario: dest.nome || '', destinatario_doc: fmtDoc(dest.doc || ''),
    tomador: toma.nome || '', tomador_doc: fmtDoc(toma.doc || ''), expedidor: exped.nome || '', recebedor: receb.nome || '',
    origem_municipio: v(ide, 'xMunIni'), origem_uf: v(ide, 'UFIni'), origem_local: (exped.end || rem.end || ''),
    destino_municipio: v(ide, 'xMunFim'), destino_uf: v(ide, 'UFFim'), destino_local: (receb.end || dest.end || ''),
    produto: v(carga, 'proPred'), peso: kg ? num(kg.q) : '', quantidade: qs[0] ? num(qs[0].q) : '', unidade: qs[0] ? (UNID[qs[0].u] || '') : '',
    valor_carga: num(v(carga, 'vCarga')), notas: notas.join('\n'),
    pedagio: ped ? String(ped) : '', outros_componentes: total && comps.length ? String(Math.round((total - ped - (comps.find(c => /frete/i.test(c.n))?.v || 0)) * 100) / 100 || '') : '',
    base_icms: num(v(icms, 'vBC')), aliquota_icms: num(v(icms, 'pICMS')), icms: num(v(icms, 'vICMS')), situacao_tributaria: v(icms, 'CST'),
    valor_frete_bruto: total ? String(total) : '', valor_impostos: num(v(icms, 'vICMS')) || '0'
  };
  if (c.outros_componentes === '0') c.outros_componentes = '';
  return { campos: c, fonte: 'XML do CT-e', avisos: placas.length ? [`Placa(s) no XML: ${placas.join(', ')}`] : [], confianca: 'alta' };
}

/* ---------- texto (PDF ou OCR) ---------- */
const LABELS = ['REMETENTE', 'DESTINAT[ÁA]RIO', 'EXPEDIDOR', 'RECEBEDOR', 'TOMADOR', 'COMPONENTES', 'INFORMA[ÇC][ÕO]ES DA CARGA', 'PRODUTO PREDOMINANTE', 'DOCUMENTOS ORIGIN', 'OBSERVA', 'IN[ÍI]CIO DA PRESTA', 'T[ÉE]RMINO DA PRESTA', 'VALOR TOTAL', 'BASE DE C[ÁA]LCULO', 'CFOP', 'NATUREZA', 'PROTOCOLO', 'CHAVE DE ACESSO', 'MODAL', 'TIPO DO SERVI', 'TIPO DO CT', 'SITUA[ÇC][ÃA]O TRIBUT', 'MUNIC[ÍI]PIO', 'ENDERE[ÇC]O', 'CNPJ', 'INSCRI', 'FONE', 'CEP', 'PA[ÍI]S', 'UF'];
const RE_LABEL = new RegExp('\\b(' + LABELS.join('|') + ')', 'i');
const RE_CNPJ = /\b(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})\b/;
const RE_MOEDA = /(\d{1,3}(?:\.\d{3})*,\d{2})\b/;
function aposRotulo(txt, rotulo, alcance = 260) {
  const m = new RegExp(rotulo, 'i').exec(txt); if (!m) return '';
  return txt.slice(m.index + m[0].length, m.index + m[0].length + alcance);
}
function nomeDepois(txt, rotulo) {
  // nome = primeiro trecho de texto "de verdade" depois do rótulo, antes do próximo rótulo
  const t = aposRotulo(txt, rotulo, 320).replace(/^[^A-Za-zÀ-ú0-9]*(?:DO SERVI[ÇC]O)?[\s:]*/i, '');
  for (const linha of t.split(/\n|\s{3,}/)) {
    const s = limpa(linha.replace(/^(NOME|RAZ[ÃA]O SOCIAL)\s*[:/]?/i, ''));
    if (!s || s.length < 3 || /^\d/.test(s) || RE_LABEL.test(s.slice(0, 18))) { if (RE_LABEL.test(s.slice(0, 18)) && s.length > 2) break; continue; }
    return s.split(/\s{2,}/)[0].slice(0, 120);
  }
  return '';
}
function docDepois(txt, rotulo) { const m = RE_CNPJ.exec(aposRotulo(txt, rotulo, 420)); return m ? fmtDoc(so(m[1])) : ''; }
function cidadeUfDepois(txt, rotulo) {
  const t = aposRotulo(txt, rotulo, 160);
  const m = /([A-ZÀ-Ú][A-ZÀ-Ú' .]{1,40}?)\s*[-\/]\s*([A-Z]{2})\b/i.exec(t.replace(/\n/g, ' '));
  return m && UF_LIST.includes(m[2].toUpperCase()) ? { mun: limpa(m[1]).toUpperCase(), uf: m[2].toUpperCase() } : null;
}
const UF_LIST = Object.values(UFS);
function moedaDepois(txt, rotulo, alcance = 90) { const m = RE_MOEDA.exec(aposRotulo(txt, rotulo, alcance)); return m ? num(m[1]) : ''; }

function lerTexto(txt, extraChaves = [], celulas = null) {
  const T = String(txt || '').replace(/\r/g, '');
  const U = T.toUpperCase();
  const avisos = [], c = {};
  // Chave: prioriza a do código de barras; depois o texto (modelo 57 = CT-e)
  const cands = [...new Set([...extraChaves, ...chavesNoTexto(T)])];
  const chave = cands.find(k => k.slice(20, 22) === '57') || cands.find(k => k.slice(20, 22) === '67') || '';
  if (chave) {
    const k = abrirChave(chave);
    Object.assign(c, { chave_acesso: chave, numero: k.numero, serie: k.serie, modelo: k.modelo, emitente_doc: fmtDoc(k.cnpj) });
  } else avisos.push('Chave de acesso não encontrada (ou com dígito verificador errado). Digite-a olhando o documento.');
  const nfes = cands.filter(k => k.slice(20, 22) === '55'); if (nfes.length) c.notas = nfes.join('\n');
  // Datas e identificação
  const em = /EMISS[ÃA]O[\s\S]{0,60}?(\d{2})\/(\d{2})\/(\d{4})(?:\D{1,6}(\d{2}):(\d{2}))?/i.exec(T) || /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/.exec(T);
  if (em) c.emissao = `${em[3]}-${em[2]}-${em[1]}T${em[4] || '00'}:${em[5] || '00'}`;
  const prot = /PROTOCOLO[\s\S]{0,60}?(\d{15})/i.exec(T); if (prot) c.protocolo = prot[1];
  const cfop = /CFOP[\s\S]{0,40}?\b([1-7]\d{3})\b/i.exec(T); if (cfop) c.cfop = cfop[1];
  const nat = /(?:CFOP|NATUREZA DA (?:OPERA[ÇC][ÃA]O|PRESTA[ÇC][ÃA]O))[\s\S]{0,40}?\b[1-7]\d{3}\s*[-–]\s*([^\n]{5,90})/i.exec(T); if (nat) c.natureza = limpa(nat[1]).split(/\s{2,}/)[0];
  if (/\bRODOVI[ÁA]RIO\b/i.test(T)) c.modal = 'Rodoviário'; else if (/\bA[ÉE]REO\b/i.test(T)) c.modal = 'Aéreo';
  const ts = /TIPO DO SERVI[ÇC]O[\s\S]{0,30}?\b(NORMAL|SUBCONTRATA[ÇC][ÃA]O|REDESPACHO(?: INTERMEDI[ÁA]RIO)?)/i.exec(T); if (ts) c.tipo_servico = ts[1][0] + ts[1].slice(1).toLowerCase();
  // Participantes
  c.remetente = nomeDepois(T, 'REMETENTE'); c.remetente_doc = docDepois(T, 'REMETENTE');
  c.destinatario = nomeDepois(T, 'DESTINAT[ÁA]RIO'); c.destinatario_doc = docDepois(T, 'DESTINAT[ÁA]RIO');
  c.expedidor = nomeDepois(T, 'EXPEDIDOR'); c.recebedor = nomeDepois(T, 'RECEBEDOR');
  c.tomador = nomeDepois(T, 'TOMADOR DO SERVI[ÇC]O|TOMADOR'); c.tomador_doc = docDepois(T, 'TOMADOR DO SERVI[ÇC]O|TOMADOR');
  if (c.emitente_doc) { // nome do emitente: linha antes do CNPJ dele, no cabeçalho
    const d = so(c.emitente_doc), linhas = T.split('\n');
    const i = linhas.findIndex(l => so(l).includes(d));
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) { const s = limpa((linhas[j] || '').split(/\s{3,}/).find(x => !/DACTE|DOCUMENTO AUXILIAR/i.test(x)) || ''); if (s.length > 4 && /[A-Z]{3}/.test(s) && !RE_LABEL.test(s.slice(0, 12)) && !/DACTE|DOCUMENTO AUXILIAR/i.test(s)) { c.emitente = s.split(/\s{2,}/)[0].slice(0, 120); break; } }
  }
  // Trajeto
  const ini = cidadeUfDepois(T, 'IN[ÍI]CIO DA PRESTA[ÇC][ÃA]O|ORIGEM DA PRESTA[ÇC][ÃA]O'), fim = cidadeUfDepois(T, 'T[ÉE]RMINO DA PRESTA[ÇC][ÃA]O|DESTINO DA PRESTA[ÇC][ÃA]O');
  if (ini) { c.origem_municipio = ini.mun; c.origem_uf = ini.uf; }
  if (fim) { c.destino_municipio = fim.mun; c.destino_uf = fim.uf; }
  if (!ini || !fim) avisos.push('Origem/destino da prestação não identificados com segurança: confira.');
  // Carga
  const pp = /PRODUTO PREDOMINANTE[\s:]*([^\n]*)\n?([^\n]*)/i.exec(T);
  if (pp) { const s = limpa(pp[1]).split(/\s{2,}/)[0]; c.produto = (s && !RE_LABEL.test(s.slice(0, 12)) ? s : limpa(pp[2]).split(/\s{2,}/)[0]).slice(0, 120); }
  c.valor_carga = moedaDepois(T, 'VALOR TOTAL DA (?:CARGA|MERCADORIA)', 40);
  const peso = /PESO\s*(?:BRUTO|TAXADO|REAL|AFERIDO|BASE DE C[ÁA]LCULO)?[\s\S]{0,40}?(\d{1,3}(?:\.\d{3})*(?:,\d{1,4})?)\s*(?:KG)?/i.exec(T); if (peso) c.peso = num(peso[1]);
  // Valores
  const total = moedaDepois(T, 'VALOR TOTAL DA PRESTA[ÇC][ÃA]O(?: DO SERVI[ÇC]O)?', 120) || moedaDepois(T, 'VALOR A RECEBER', 90) || moedaDepois(T, 'TOTAL DA PRESTA', 90);
  if (total) c.valor_frete_bruto = total; else avisos.push('Valor total da prestação não encontrado: digite o frete.');
  c.pedagio = moedaDepois(T, 'PED[ÁA]GIO', 40);
  c.base_icms = moedaDepois(T, 'BASE DE C[ÁA]LCULO', 80);
  const ali = /AL[ÍI]Q(?:UOTA)?[\s\S]{0,30}?(\d{1,2}(?:,\d{1,2})?)\s*%?/i.exec(T); if (ali) c.aliquota_icms = num(ali[1]);
  c.icms = moedaDepois(T, 'VALOR DO ICMS|VALOR ICMS', 70);
  if (c.icms) c.valor_impostos = c.icms;
  const cst = /SITUA[ÇC][ÃA]O TRIBUT[ÁA]RIA[\s\S]{0,30}?\b(\d{2}\s*-\s*[^\n]{3,60}|\d{2})/i.exec(T); if (cst) c.situacao_tributaria = limpa(limpa(cst[1]).split(/\s{2,}|(?=BASE DE|AL[ÍI]Q|VALOR DO)/i)[0]);
  const placas = [...new Set((U.match(/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/g) || []).map(p => p.replace('-', '')))];
  if (placas.length) avisos.push(`Placa(s) no documento: ${placas.join(', ')}`);
  // Conferência cruzada: número impresso × número da chave
  if (chave) {
    const nImp = /N[ºO°.]?\s*(?:DO CT-?E)?[\s:]*0*(\d{1,9})\b/i.exec(aposRotulo(T, 'N[ÚU]MERO|\\bN[ºO°]\\b', 40) || '');
    if (nImp && nImp[1] !== c.numero) avisos.push(`Número impresso (${nImp[1]}) difere do número da chave (${c.numero}). Usei o da chave.`);
  }
  if (celulas && celulas.length) {
    const pc = lerCelulas(celulas);
    Object.assign(c, pc);
    if (pc.origem_municipio && pc.destino_municipio) { const i = avisos.findIndex(a => /Origem\/destino/.test(a)); if (i >= 0) avisos.splice(i, 1); }
  }
  // Sanidade: rótulo nunca é valor; UF precisa existir.
  for (const k of Object.keys(c)) if (typeof c[k] === 'string' && /^(T[ÉE]RMINO|IN[ÍI]CIO|OUTRAS CARACTER|VALOR TOTAL|REMETENTE|DESTINAT|TOMADOR)/i.test(c[k]) && !/^(valor|notas)/.test(k)) delete c[k];
  ['origem_uf', 'destino_uf'].forEach(k => { if (c[k] && !UF_LIST.includes(c[k])) delete c[k]; });
  for (const k of Object.keys(c)) if (c[k] === '' || c[k] == null) delete c[k];
  return { campos: c, avisos };
}

/* ---------- leitura por posição (DACTE tem rótulos em caixas, valores abaixo) ----------
   itens: [{x0, x1, y (de cima para baixo), h, s}] -> linhas -> células (trechos separados por espaço grande) */
function montarCelulas(itens) {
  itens = itens.filter(i => i.s && i.s.trim()).sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const linhas = [];
  for (const it of itens) {
    const tol = Math.max(2, (it.h || 8) * .45);
    let L = linhas.find(l => Math.abs(l.y - it.y) <= tol);
    if (!L) { L = { y: it.y, itens: [] }; linhas.push(L); }
    L.itens.push(it);
  }
  linhas.sort((a, b) => a.y - b.y);
  const cel = [];
  linhas.forEach((L, row) => {
    L.itens.sort((a, b) => a.x0 - b.x0);
    let cur = null;
    for (const it of L.itens) {
      const gap = cur ? it.x0 - cur.x1 : 1e9, ch = Math.max(2, (it.h || 8) * .55);
      if (cur && gap < ch * 1.6) { cur.s += (gap > ch * .25 ? ' ' : '') + it.s; cur.x1 = Math.max(cur.x1, it.x1); }
      else { cur = { row, x0: it.x0, x1: it.x1, y: it.y, s: it.s }; cel.push(cur); }
    }
  });
  cel.forEach(c => { c.s = limpa(c.s); });
  return cel;
}
// Valores "do rótulo": resto da própria célula ou, se vazio, as células logo abaixo na mesma coluna.
function blocoDoRotulo(cel, re, linhasMax = 6, parar = RE_LABEL) {
  const i = cel.findIndex(c => re.test(c.s)); if (i < 0) return null;
  const L = cel[i], m = re.exec(L.s), resto = limpa(L.s.slice(m.index + m[0].length).replace(/^\s*(DO SERVI[ÇC]O|DA PRESTA[ÇC][ÃA]O)/i, ''));
  const fora = [];
  if (resto) fora.push(resto);
  const xa = L.x0 - 25, xb = Math.max(L.x1, L.x0 + 140);
  const proxLinhas = cel.filter(c => c.row > L.row && c.row <= L.row + linhasMax && c.x0 < xb && c.x1 > xa).sort((a, b) => a.row - b.row || a.x0 - b.x0);
  for (const c of proxLinhas) { if (parar.test(c.s.slice(0, 22)) && !RE_CNPJ.test(c.s) && !/^(CNPJ|CPF|ENDERE|MUNIC|CEP|FONE|INSCRI|UF\b|PA[IÍ]S)/i.test(c.s)) break; fora.push(c.s); }
  return fora;
}
const RE_PARTE = /^(REMETENTE|DESTINAT[ÁA]RIO|EXPEDIDOR|RECEBEDOR|TOMADOR|PRODUTO PREDOMINANTE|COMPONENTES|INFORMA[ÇC][ÕO]ES|DOCUMENTOS|OBSERVA|IN[ÍI]CIO DA|T[ÉE]RMINO DA)/i;
function parteDasCelulas(cel, re) {
  const b = blocoDoRotulo(cel, re, 7, RE_PARTE); if (!b) return null;
  let nome = '', doc = '';
  for (const s of b) {
    const d = RE_CNPJ.exec(s); if (d && !doc) doc = fmtDoc(so(d[1]));
    const t = limpa(s.replace(/^(NOME|RAZ[ÃA]O SOCIAL)\s*[:/]?/i, ''));
    if (!nome && t.length > 2 && !/^\d/.test(t) && !/^(CNPJ|CPF|ENDERE|MUNIC|CEP|FONE|INSCRI|UF\b|PA[IÍ]S|IE\b)/i.test(t)) nome = t.slice(0, 120);
  }
  return { nome, doc };
}
function lerCelulas(cel) {
  const c = {};
  for (const [k, re] of [['remetente', /\bREMETENTE\b/i], ['destinatario', /\bDESTINAT[ÁA]RIO\b/i], ['expedidor', /\bEXPEDIDOR\b/i], ['recebedor', /\bRECEBEDOR\b/i], ['tomador', /\bTOMADOR( DO SERVI[ÇC]O)?\b/i]]) {
    const p = parteDasCelulas(cel, re); if (!p) continue;
    if (p.nome) c[k] = p.nome; if (p.doc && /^(remetente|destinatario|tomador)$/.test(k)) c[k + '_doc'] = p.doc;
  }
  const cid = re => { const b = blocoDoRotulo(cel, re, 3, RE_PARTE); if (!b) return null; for (const s of b) { const m = /([A-ZÀ-Ú][A-ZÀ-Ú' .]{1,40}?)\s*[-\/]\s*([A-Z]{2})\b/i.exec(s); if (m && UF_LIST.includes(m[2].toUpperCase())) return { mun: limpa(m[1]).toUpperCase(), uf: m[2].toUpperCase() }; } return null; };
  const ini = cid(/IN[ÍI]CIO DA PRESTA[ÇC][ÃA]O|ORIGEM DA PRESTA[ÇC][ÃA]O/i), fim = cid(/T[ÉE]RMINO DA PRESTA[ÇC][ÃA]O|DESTINO DA PRESTA[ÇC][ÃA]O/i);
  if (ini) { c.origem_municipio = ini.mun; c.origem_uf = ini.uf; }
  if (fim) { c.destino_municipio = fim.mun; c.destino_uf = fim.uf; }
  const pp = blocoDoRotulo(cel, /PRODUTO PREDOMINANTE/i, 2); if (pp && pp[0] && !RE_LABEL.test(pp[0].slice(0, 14))) c.produto = pp[0].slice(0, 120);
  const st = blocoDoRotulo(cel, /SITUA[ÇC][ÃA]O TRIBUT[ÁA]RIA/i, 2); if (st && st[0]) c.situacao_tributaria = limpa(st[0].split(/(?=BASE DE|AL[ÍI]Q|VALOR DO)/i)[0]).slice(0, 60);
  const vc = blocoDoRotulo(cel, /VALOR TOTAL DA (CARGA|MERCADORIA)/i, 2); if (vc) for (const x of vc) { const m = RE_MOEDA.exec(x); if (m) { c.valor_carga = num(m[1]); break; } }
  return c;
}

/* ---------- PDF ---------- */
let pdfjs = null;
function carregarPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = new Promise((res, rej) => {
    if (window.pdfjsLib) return res(window.pdfjsLib);
    const s = document.createElement('script'); s.src = '../../vendor/pdfjs/pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = '../../vendor/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); };
    s.onerror = () => { pdfjs = null; rej(Error('O leitor de PDF não carregou.')); };
    document.head.appendChild(s);
  });
  return pdfjs;
}
async function textoDoPdf(buf) {
  const L = await carregarPdfjs(), pdf = await L.getDocument({ data: buf }).promise, saida = [], itens = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
    const pg = await pdf.getPage(p), tc = await pg.getTextContent(), grupos = [], alt = pg.getViewport({ scale: 1 }).height;
    tc.items.forEach(it => { if (it.str && it.str.trim()) { const hh = Math.abs(it.transform[3]) || it.height || 8; itens.push({ x0: it.transform[4], x1: it.transform[4] + (it.width || it.str.length * hh * .5), y: (p - 1) * 5000 + alt - it.transform[5], h: hh, s: it.str }); } });
    tc.items.forEach(it => {
      const s = it.str; if (!s || !s.trim()) return;
      const x = it.transform[4], y = it.transform[5];
      let g = grupos.find(g => Math.abs(g.y - y) < 2.5); if (!g) { g = { y, partes: [] }; grupos.push(g); }
      g.partes.push({ x, s });
    });
    grupos.sort((a, b) => b.y - a.y).forEach(g => { g.partes.sort((a, b) => a.x - b.x); saida.push(g.partes.map(q => q.s.trim()).join('   ')); });
  }
  pdf.destroy();
  return { texto: saida.join('\n'), celulas: montarCelulas(itens) };
}

/* ---------- foto ---------- */
async function chaveDoCodigoDeBarras(blob) {
  try {
    if (!('BarcodeDetector' in window)) return [];
    const fmts = await window.BarcodeDetector.getSupportedFormats();
    if (!fmts.includes('code_128')) return [];
    const bmp = await createImageBitmap(blob), det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code'] });
    const r = await det.detect(bmp); bmp.close?.();
    return r.flatMap(b => chavesNoTexto(b.rawValue) .concat(/chCTe=(\d{44})/.exec(b.rawValue || '') ? [/chCTe=(\d{44})/.exec(b.rawValue)[1]] : [])).filter(dvOk);
  } catch { return []; }
}
let tess = null;
function carregarTesseract() {
  if (tess) return tess;
  tess = new Promise((res, rej) => {
    if (window.Tesseract) return res(window.Tesseract);
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => res(window.Tesseract); s.onerror = () => { tess = null; rej(Error('Não foi possível baixar o leitor de fotos (verifique a internet).')); };
    document.head.appendChild(s);
  });
  return tess;
}
// Cinza + contraste + ampliação: melhora muito o OCR de fotos de celular.
async function prepararFoto(blob) {
  const bmp = await createImageBitmap(blob), k = Math.min(2.2, 2600 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * Math.max(1, k)), h = Math.round(bmp.height * Math.max(1, k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const im = x.getImageData(0, 0, w, h), d = im.data;
  for (let i = 0; i < d.length; i += 4) { let g = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114; g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 135)); d[i] = d[i + 1] = d[i + 2] = g; }
  x.putImageData(im, 0, 0); return c;
}
async function textoDaFoto(blob, progresso) {
  const T = await carregarTesseract(), canvas = await prepararFoto(blob);
  const r = await T.recognize(canvas, 'por', { logger: m => { if (m.status === 'recognizing text' && progresso) progresso(Math.round(m.progress * 100)); } });
  const itens = (r.data.words || []).filter(w => w.confidence > 30).map(w => ({ x0: w.bbox.x0, x1: w.bbox.x1, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0, s: w.text }));
  return { texto: r.data.text || '', celulas: itens.length ? montarCelulas(itens) : null };
}

/* ---------- entrada única ---------- */
async function lerArquivo(file, { progresso } = {}) {
  if (!file) throw Error('Nenhum arquivo.');
  const nome = file.name || '', tipo = file.type || '';
  if (/xml/i.test(tipo) || /\.xml$/i.test(nome)) { if (file.size > 5 * 1024 * 1024) throw Error('XML acima de 5 MB.'); return { ...lerXml(await file.text()), arquivo: 'xml' }; }
  if (/pdf/i.test(tipo) || /\.pdf$/i.test(nome)) {
    const { texto: txt, celulas } = await textoDoPdf(new Uint8Array(await file.arrayBuffer()));
    if (txt.replace(/\s/g, '').length < 80) throw Error('Este PDF não tem texto (é uma imagem escaneada). Envie uma foto do DACTE para a leitura por imagem.');
    const r = lerTexto(txt, [], celulas); return { ...r, fonte: 'PDF do DACTE', confianca: 'média', texto: txt, arquivo: 'pdf' };
  }
  if (/^image\//i.test(tipo)) {
    const bar = await chaveDoCodigoDeBarras(file);
    progresso?.(0, 'Lendo a foto (na primeira vez o leitor é baixado)…');
    const { texto: txt, celulas } = await textoDaFoto(file, p => progresso?.(p, `Lendo a foto… ${p}%`));
    const r = lerTexto(txt, bar, celulas);
    if (bar.length) r.avisos.unshift('Chave lida pelo código de barras (conferida pelo dígito verificador).');
    return { ...r, fonte: 'Foto do DACTE', confianca: 'baixa', texto: txt, arquivo: 'foto' };
  }
  throw Error('Use PDF, foto (JPG/PNG/WEBP) ou XML do CT-e.');
}
window.CteLeitor = { lerArquivo, lerTexto, lerXml, dvOk, abrirChave, chavesNoTexto, montarCelulas };
})();
