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
    // Campos que dependem do desenho da página: com posição disponível, só valem se achados por coluna.
    ['natureza', 'expedidor', 'recebedor', 'peso', 'icms', 'base_icms', 'aliquota_icms', 'valor_carga', 'valor_impostos', 'situacao_tributaria', 'produto'].forEach(k => { if (!(k in pc)) delete c[k]; });
    Object.assign(c, pc);
    if (pc.valor_frete_bruto) { const i = avisos.findIndex(a => /Valor total/.test(a)); if (i >= 0) avisos.splice(i, 1); }
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
const RE_PARTE = /^(REMETENTE|REM\s*:|DESTINAT[ÁA]RIO|DEST\s*:|EXPEDIDOR|RECEBEDOR|TOMADOR\s*:|TOMADOR DO SERVI[ÇC]O\s*:|PRODUTO PREDOMINANTE|COMPONENTES|INFORMA[ÇC][ÕO]ES|DOCUMENTOS|OBSERVA|IN[ÍI]CIO DA|T[ÉE]RMINO DA)/i;
// Posição horizontal estimada de um trecho dentro da célula (proporcional aos caracteres).
const xDe = (c, i) => c.x0 + (c.x1 - c.x0) * i / Math.max(1, c.s.length);
// Valor logo ABAIXO de um cabeçalho, na mesma coluna (DACTE em tabela: rótulo em cima, valor embaixo).
function abaixoDe(cel, re, { linhas = 3, filtro = null, folga = 6 } = {}) {
  for (const H of cel) {
    const m = re.exec(H.s); if (!m) continue;
    // valor na mesma célula, logo depois do rótulo ("PESO BRUTO (KG) 27.500,00")
    const resto = limpa(H.s.slice(m.index + m[0].length).replace(/^\s*\(?KG\)?/i, ''));
    if (resto && !RE_LABEL.test(resto.slice(0, 16)) && (!filtro || filtro.test(resto))) return resto;
    const ha = xDe(H, m.index) - folga, hb = Math.max(xDe(H, m.index + m[0].length), ha + 30) + folga;
    const cand = cel.filter(c => c.row > H.row && c.row <= H.row + linhas && Math.min(c.x1, hb) - Math.max(c.x0, ha) > 0);
    const hc = (ha + hb) / 2, dist = c => Math.abs((c.x0 + c.x1) / 2 - hc);
    cand.sort((a, b) => a.row - b.row || dist(a) - dist(b));
    for (const c of cand) {
      // célula larga que cobre várias colunas: pega só o trecho que fica sob o cabeçalho
      let t = c.s;
      if (c.x1 - c.x0 > (hb - ha) * 2.2 && c.x0 < ha - 10) {
        const ws = [...t.matchAll(/\S+/g)].filter(w => { const xa = xDe(c, w.index), xb = xDe(c, w.index + w[0].length); return Math.min(xb, hb) - Math.max(xa, ha) > 0; });
        t = ws.map(w => w[0]).join(' ');
      }
      t = limpa(t); if (!t) continue;
      if (filtro && !filtro.test(t)) continue;
      if (!filtro && RE_LABEL.test(t.slice(0, 16)) && t === t.toUpperCase() && /^(DOCUMENTOS|INFORMA|COMPONENTES|OBSERVA|VALOR|BASE|PESO)/i.test(t)) continue;
      return t;
    }
  }
  return '';
}
const RE_VAL = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,4})?/;
const valAbaixo = (cel, re, o = {}) => { const t = abaixoDe(cel, re, { folga: 30, ...o, filtro: /\d/ }); const m = /(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d+(?:[.,]\d{1,4})?)/.exec(t); return m ? num(m[1].includes(',') ? m[1] : m[1]) : ''; };
const cidUf = t => {
  let m = /^([A-Z]{2})\s*[-\/]\s*([A-Za-zÀ-ú' .]{2,40})$/.exec(t); if (m && UF_LIST.includes(m[1].toUpperCase())) return { uf: m[1].toUpperCase(), mun: limpa(m[2]) };
  m = /([A-Za-zÀ-ú][A-Za-zÀ-ú' .]{1,40}?)\s*[-\/]\s*([A-Z]{2})\b/.exec(t); if (m && UF_LIST.includes(m[2].toUpperCase())) return { mun: limpa(m[1]), uf: m[2].toUpperCase() };
  return null;
};
// Participantes: coluna = do rótulo até o próximo rótulo da mesma linha; CNPJ conta pela posição estimada.
const PARTES = [['remetente', /^(REMETENTE\b|REM\s*:)/i], ['destinatario', /^(DESTINAT[ÁA]RIO\b|DEST\s*:)/i], ['expedidor', /^(EXPEDIDOR\b)/i], ['recebedor', /^(RECEBEDOR\b)/i], ['tomador', /^(TOMADOR\s*:|TOMADOR DO SERVI[ÇC]O\s*:)/i]];
const RE_ROT_PARTE = /^(REMETENTE|REM\s*:|DESTINAT[ÁA]RIO|DEST\s*:|EXPEDIDOR|RECEBEDOR|TOMADOR\s*:|TOMADOR DO SERVI[ÇC]O\s*:|PRODUTO PREDOMINANTE|COMPONENTES|INFORMA[ÇC][ÕO]ES|DOCUMENTOS)/i;
function partes(cel) {
  const out = {}, maxX = Math.max(...cel.map(c => c.x1));
  for (const [k, re] of PARTES) {
    const L = cel.find(c => re.test(c.s)); if (!L) continue;
    const mesmaLinha = cel.filter(c => c.row === L.row && c.x0 > L.x0 + 5).sort((a, b) => a.x0 - b.x0);
    const xa = L.x0 - 8, xb = (mesmaLinha.find(c => RE_ROT_PARTE.test(c.s))?.x0 ?? maxX + 1) - 4;
    const m = re.exec(L.s); let nome = limpa(L.s.slice(m[0].length).split(/\s{2,}/)[0]);
    let doc = '';
    const fimRow = (cel.find(c => c.row > L.row && RE_ROT_PARTE.test(c.s))?.row ?? L.row + 8);
    const bloco = cel.filter(c => c.row > L.row && c.row < Math.min(fimRow, L.row + 8)).sort((a, b) => a.row - b.row || a.x0 - b.x0);
    for (const c of bloco) {
      for (const d of c.s.matchAll(new RegExp(RE_CNPJ.source, 'g'))) { const x = xDe(c, d.index); if (x >= xa && x < xb && !doc) doc = fmtDoc(so(d[1])); }
      if (!nome && c.x0 >= xa && c.x0 < xb) { const t = limpa(c.s.replace(/^(NOME|RAZ[ÃA]O SOCIAL)\s*[:/]?/i, '')); if (t.length > 2 && !/^\d/.test(t) && !/^(CNPJ|CPF|ENDERE|MUNIC|CIDADE|CEP|FONE|INSCRI|UF\b|PA[IÍ]S|IE\b)/i.test(t)) nome = t.slice(0, 120); }
    }
    if (nome || doc) out[k] = { nome, doc };
  }
  return out;
}
function lerCelulas(cel) {
  const c = {};
  const P = partes(cel);
  for (const k of ['remetente', 'destinatario', 'expedidor', 'recebedor', 'tomador']) if (P[k]) { if (P[k].nome) c[k] = P[k].nome; if (P[k].doc && /^(remetente|destinatario|tomador)$/.test(k)) c[k + '_doc'] = P[k].doc; }
  // Tomador por código (REM/DEST/EXPED/RECEB) quando não há bloco próprio
  const tcod = abaixoDe(cel, /TOMADOR DO SERVI[ÇC]O/i, { linhas: 2 }).toUpperCase();
  const mapa = { REM: 'remetente', REMETENTE: 'remetente', DEST: 'destinatario', 'DESTINATÁRIO': 'destinatario', DESTINATARIO: 'destinatario', EXPED: 'expedidor', EXPEDIDOR: 'expedidor', RECEB: 'recebedor', RECEBEDOR: 'recebedor' };
  if (mapa[tcod] && !c.tomador && P[mapa[tcod]]) { c.tomador = P[mapa[tcod]].nome; if (P[mapa[tcod]].doc) c.tomador_doc = P[mapa[tcod]].doc; }
  const ini = cidUf(abaixoDe(cel, /IN[ÍI]CIO DA PRESTA[ÇC][ÃA]O|ORIGEM DA PRESTA[ÇC][ÃA]O/i)), fim = cidUf(abaixoDe(cel, /T[ÉE]RMINO DA PRESTA[ÇC][ÃA]O|DESTINO DA PRESTA[ÇC][ÃA]O/i));
  if (ini) { c.origem_municipio = ini.mun; c.origem_uf = ini.uf; }
  if (fim) { c.destino_municipio = fim.mun; c.destino_uf = fim.uf; }
  const cf = abaixoDe(cel, /CFOP/i, { filtro: /^\d{4}/ }); if (cf) { c.cfop = cf.slice(0, 4); const nat = limpa(cf.slice(4).replace(/^[\s\-–]+/, '')); if (nat) c.natureza = nat; }
  const pr = abaixoDe(cel, /PROTOCOLO DE AUTORIZA/i, { filtro: /\d{15}/, folga: 60 }); if (pr) c.protocolo = /\d{15}/.exec(pr)[0];
  const em = abaixoDe(cel, /DATA E HORA DE EMISS|DATA DE EMISS|EMISS[ÃA]O/i, { filtro: /\d{2}\/\d{2}\/\d{4}/ });
  if (em) { const m = /(\d{2})\/(\d{2})\/(\d{4})(?:\D{1,4}(\d{2}):(\d{2}))?/.exec(em); c.emissao = `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}`; }
  const md = abaixoDe(cel, /^MODAL$/i, { linhas: 2 }); if (md) { const t = md.toUpperCase(); c.modal = /MULTI/.test(t) ? 'Multimodal' : /RODO/.test(t) ? 'Rodoviário' : /A[ÉE]REO/.test(t) ? 'Aéreo' : /AQUA/.test(t) ? 'Aquaviário' : /FERRO/.test(t) ? 'Ferroviário' : c.modal; }
  const ts = abaixoDe(cel, /TIPO D[OE] SERVI[ÇC]O/i, { linhas: 2 }); if (ts && /^[A-Za-zÀ-ú ]{4,30}$/.test(ts)) c.tipo_servico = ts[0].toUpperCase() + ts.slice(1).toLowerCase();
  const pp = abaixoDe(cel, /PRODUTO PREDOMINANTE/i, { linhas: 2 }); if (pp && !RE_LABEL.test(pp.slice(0, 14))) c.produto = pp.slice(0, 120);
  const vc = valAbaixo(cel, /VALOR (TOTAL )?DA (CARGA|MERCADORIA)|VALOR MERCADORIA/i, { linhas: 2, folga: 110 }); if (vc) c.valor_carga = vc;
  const peso = valAbaixo(cel, /PESO (REAL|BRUTO)/i, { linhas: 2 }) || valAbaixo(cel, /PESO TAXADO|PESO\b/i, { linhas: 2 }); if (peso) c.peso = peso;
  const vol = valAbaixo(cel, /^VOLUMES?$|QTDE?\.? VOLUMES/i, { linhas: 2 }); if (vol) { c.quantidade = vol; c.unidade = 'VOLUMES'; }
  const tot = valAbaixo(cel, /VALOR TOTAL D[OA] (SERVI[ÇC]O|PRESTA[ÇC][ÃA]O)/i) || valAbaixo(cel, /VALOR [ÀA] RECEBER/i); if (tot) c.valor_frete_bruto = tot;
  const st = abaixoDe(cel, /SITUA[ÇC][ÃA]O TRIBUT[ÁA]RIA/i, { linhas: 2 }); if (st) c.situacao_tributaria = limpa(st.split(/(?=BASE DE|AL[ÍI]Q|VALOR DO)/i)[0]).slice(0, 60);
  const bc = valAbaixo(cel, /BASE DE C[ÁA]LCULO/i, { linhas: 2 }); if (bc) c.base_icms = bc;
  const al = valAbaixo(cel, /AL[ÍI]QUOTA|AL[ÍI]Q\.?(\s*ICMS)?/i, { linhas: 2 }); if (al && Number(al) <= 30) c.aliquota_icms = al;
  const ic = valAbaixo(cel, /VALOR (DO )?ICMS/i, { linhas: 2 }); if (ic) { c.icms = ic; c.valor_impostos = ic; }
  // Componentes: "NOME  VALOR" na mesma linha
  const comp = re => { const C = cel.find(x => re.test(x.s)); if (!C) return ''; const m = new RegExp(re.source + '\\s*([\\d.,]+)$', 'i').exec(C.s); if (m) return num(m[m.length - 1]); const v = cel.filter(x => x.row === C.row && x.x0 > C.x1).sort((a, b) => a.x0 - b.x0)[0]; return v && /^[\d.,]+$/.test(v.s) ? num(v.s.includes(',') ? v.s : v.s) : ''; };
  const ped = comp(/^PED[ÁA]GIO/i); if (ped) c.pedagio = ped;
  // Emitente: célula do topo na coluna do CNPJ do emitente (antes de endereço/fone)
  const cn = cel.find(x => /CNPJ/i.test(x.s) && x.row < 12);
  if (cn) { const acima = cel.filter(x => x.row < cn.row && Math.min(x.x1, cn.x1 + 40) - Math.max(x.x0, cn.x0 - 40) > 0).sort((a, b) => a.row - b.row); const e = acima.find(x => x.s.length > 4 && /[A-Za-z]{3}/.test(x.s) && !/^(RUA|R\.|AV|AVENIDA|ROD|FONE|CEP|TEL)/i.test(x.s) && !/\bCEP\b|\d{4,}/.test(x.s) && !/DACTE|DOCUMENTO AUXILIAR/i.test(x.s)); if (e) c.emitente = e.s.slice(0, 120); }
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
// Cada página separada (um PDF pode trazer vários CT-es, um por página).
async function paginasDoPdf(buf) {
  const L = await carregarPdfjs(), pdf = await L.getDocument({ data: buf }).promise, out = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 60); p++) {
    const pg = await pdf.getPage(p), tc = await pg.getTextContent(), alt = pg.getViewport({ scale: 1 }).height, itens = [];
    tc.items.forEach(it => { if (it.str && it.str.trim()) { const hh = Math.abs(it.transform[3]) || it.height || 8; itens.push({ x0: it.transform[4], x1: it.transform[4] + (it.width || it.str.length * hh * .5), y: alt - it.transform[5], h: hh, s: it.str }); } });
    const cel = montarCelulas(itens);
    const linhas = []; cel.forEach(c => { (linhas[c.row] ||= []).push(c.s); });
    out.push({ pagina: p, texto: linhas.map(l => (l || []).join('   ')).join('\n'), celulas: cel });
  }
  pdf.destroy();
  return out;
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
    const pags = await paginasDoPdf(new Uint8Array(await file.arrayBuffer()));
    if (pags.reduce((a, p) => a + p.texto.replace(/\s/g, '').length, 0) < 80) throw Error('Este PDF não tem texto (é uma imagem escaneada). Envie uma foto do DACTE para a leitura por imagem.');
    // Agrupa páginas por CT-e (página sem chave própria = continuação da anterior).
    const grupos = [];
    for (const pg of pags) {
      const ch = chavesNoTexto(pg.texto).find(k => k.slice(20, 22) === '57' || k.slice(20, 22) === '67');
      const g = grupos[grupos.length - 1];
      if (!ch && g) { g.paginas.push(pg.pagina); g.texto += '\n' + pg.texto; g.celulas = g.celulas.concat(pg.celulas.map(c => ({ ...c, row: c.row + 10000 * g.paginas.length }))); continue; }
      if (ch && g && g.chave === ch) { g.paginas.push(pg.pagina); continue; }
      grupos.push({ chave: ch || '', paginas: [pg.pagina], texto: pg.texto, celulas: pg.celulas });
    }
    const documentos = grupos.map(g => ({ ...lerTexto(g.texto, [], g.celulas), paginas: g.paginas, texto: g.texto }));
    return { ...documentos[0], documentos, fonte: 'PDF do DACTE', confianca: 'média', arquivo: 'pdf' };
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
/* ---------- nota fiscal (NF-e) ---------- */
// Devolve { notas:[{chave, numero, serie, emitente_cnpj, emitente, destinatario, valor, emissao}], fonte, arquivo }.
function notaDeChave(ch) { const a = abrirChave(ch); return { chave: ch, numero: a.numero, serie: a.serie, emitente_cnpj: fmtDoc(a.cnpj), emitente: '', destinatario: '', valor: '', emissao: '' }; }
function lerNotaXml(raw) {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error('XML com DTD/entidades não é aceito.');
  const doc = new DOMParser().parseFromString(raw, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('XML inválido.');
  const tag = (el, n) => el ? el.getElementsByTagNameNS('*', n)[0] || null : null, txt = (el, n) => (tag(el, n)?.textContent || '').trim();
  const notas = [...doc.getElementsByTagNameNS('*', 'infNFe')].map(inf => {
    const ch = so(inf.getAttribute('Id')); if (!/^\d{44}$/.test(ch)) return null;
    const ide = tag(inf, 'ide'), emit = tag(inf, 'emit'), dest = tag(inf, 'dest'), tot = tag(inf, 'ICMSTot');
    return { ...notaDeChave(ch), numero: txt(ide, 'nNF') || abrirChave(ch).numero, serie: txt(ide, 'serie') || abrirChave(ch).serie,
      emitente_cnpj: fmtDoc(txt(emit, 'CNPJ') || txt(emit, 'CPF')), emitente: txt(emit, 'xNome'), destinatario: txt(dest, 'xNome'),
      valor: num(txt(tot, 'vNF')), emissao: (txt(ide, 'dhEmi') || txt(ide, 'dEmi')).slice(0, 16) };
  }).filter(Boolean);
  if (!notas.length) {
    if (doc.getElementsByTagNameNS('*', 'infCte').length) throw Error('Este XML é de CT-e, não de nota fiscal.');
    throw Error('Não achei a nota fiscal (NF-e) neste XML.');
  }
  return notas;
}
function notasDoTexto(txt) {
  const chaves = chavesNoTexto(txt), nfe = chaves.filter(k => k.slice(20, 22) === '55' || k.slice(20, 22) === '65');
  const valor = (/VALOR\s+TOTAL\s+DA\s+NOTA[^\d]{0,80}?([\d.]+,\d{2})/i.exec(txt) || [])[1];
  return { cte: chaves.some(k => k.slice(20, 22) === '57'), notas: nfe.map(k => ({ ...notaDeChave(k), valor: nfe.length === 1 && valor ? num(valor) : '' })) };
}
async function lerNota(file, { progresso } = {}) {
  if (!file) throw Error('Nenhum arquivo.');
  const nome = file.name || '', tipo = file.type || '';
  let notas = [], fonte = '', cte = false;
  if (/xml/i.test(tipo) || /\.xml$/i.test(nome)) { if (file.size > 5 * 1024 * 1024) throw Error('XML acima de 5 MB.'); notas = lerNotaXml(await file.text()); fonte = 'XML da NF-e'; }
  else if (/pdf/i.test(tipo) || /\.pdf$/i.test(nome)) {
    const pags = await paginasDoPdf(new Uint8Array(await file.arrayBuffer())), vistos = new Set();
    if (pags.reduce((a, p) => a + p.texto.replace(/\s/g, '').length, 0) < 80) throw Error('Este PDF da nota não tem texto (é escaneado). Envie o XML ou uma foto da nota.');
    for (const pg of pags) { const r = notasDoTexto(pg.texto); cte ||= r.cte; r.notas.forEach(x => { if (!vistos.has(x.chave)) { vistos.add(x.chave); notas.push(x); } }); }
    fonte = 'PDF da nota (DANFE)';
  } else if (/^image\//i.test(tipo)) {
    const bar = await chaveDoCodigoDeBarras(file);
    let r = notasDoTexto(bar.join('\n'));
    if (!r.notas.length) { progresso?.(0, 'Lendo a foto da nota…'); const { texto } = await textoDaFoto(file, p => progresso?.(p, `Lendo a foto da nota… ${p}%`)); r = notasDoTexto(texto); }
    notas = r.notas; cte = r.cte; fonte = 'Foto da nota (DANFE)';
  } else throw Error('Use PDF, foto (JPG/PNG/WEBP) ou XML da nota fiscal.');
  if (!notas.length) throw Error(cte ? 'Este arquivo é um CT-e, não a nota fiscal. Anexe o DANFE ou o XML da NF-e.' : 'Não achei a chave de acesso da nota fiscal (44 números) neste arquivo.');
  return { notas, fonte, arquivo: /xml/i.test(tipo) || /\.xml$/i.test(nome) ? 'xml' : /^image\//i.test(tipo) ? 'foto' : 'pdf' };
}

window.CteLeitor = { lerArquivo, lerNota, lerTexto, lerXml, dvOk, abrirChave, chavesNoTexto, montarCelulas };
})();
