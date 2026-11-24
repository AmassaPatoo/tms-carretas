// Intermediário da SEFAZ (Vercel, região São Paulo).
// Algumas SEFAZ (SP, Ambiente Nacional) pedem o certificado do cliente por
// renegociação TLS, que o servidor do Supabase não suporta. Aqui é Node
// (OpenSSL), que suporta. Só encaminha o pedido SOAP e devolve a resposta.
// Variáveis: SEFAZ_CERT_PFX (base64), SEFAZ_CERT_SENHA, PROXY_TOKEN.
const https = require('node:https');
const crypto = require('node:crypto');
const tls = require('node:tls');
const zlib = require('node:zlib');
const ICP_ZIP = 'https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip';

const PERMITIDOS = /^https:\/\/([a-z0-9-]+\.)*(fazenda\.sp\.gov\.br|nfe\.fazenda\.gov\.br|cte\.fazenda\.gov\.br|svrs\.rs\.gov\.br|sefaz\.[a-z]{2}\.gov\.br|sefazrs\.rs\.gov\.br|fazenda\.mg\.gov\.br|sefa\.pr\.gov\.br|fazenda\.pr\.gov\.br|cte\.ms\.gov\.br|sefazvirtual\.fazenda\.gov\.br|svc\.fazenda\.gov\.br)(:443)?\//i;
// Lê um .zip (só o necessário: diretório central + deflate/stored).
function unzip(buf) {
  const out = {}; let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  if (fim < 0) return out;
  let p = buf.readUInt32LE(fim + 16); const n = buf.readUInt16LE(fim + 10);
  for (let i = 0; i < n; i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20), ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nome = buf.toString('latin1', p + 46, p + 46 + ln); p += 46 + ln + le + lc;
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), dados = buf.subarray(ini, ini + tam);
    try { out[nome] = metodo === 8 ? zlib.inflateRawSync(dados) : dados; } catch { /* item ruim */ }
  }
  return out;
}
let acs = null;
async function acsIcpBrasil() {
  if (acs) return acs;
  const r = await fetch(ICP_ZIP, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('Não baixei a lista de ACs ICP-Brasil (HTTP ' + r.status + ')');
  const lista = [];
  for (const [nome, b] of Object.entries(unzip(Buffer.from(await r.arrayBuffer())))) {
    if (!/\.(crt|cer|pem)$/i.test(nome) || !b.length) continue;
    const t = b.toString('latin1');
    if (t.includes('-----BEGIN CERTIFICATE-----')) lista.push(...(t.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []));
    else lista.push('-----BEGIN CERTIFICATE-----\n' + b.toString('base64').replace(/(.{64})/g, '$1\n') + '\n-----END CERTIFICATE-----\n');
  }
  if (!lista.length) throw new Error('Lista de ACs ICP-Brasil vazia');
  acs = [...tls.rootCertificates, ...lista];
  return acs;
}
let agente = null;
async function agenteSefaz() {
  if (agente) return agente;
  const pfx = Buffer.from((process.env.SEFAZ_CERT_PFX || '').replace(/\s+/g, ''), 'base64');
  if (!pfx.length) throw Object.assign(new Error('Certificado não configurado no intermediário.'), { codigo: 'sem_certificado' });
  // As SEFAZ usam certificados ICP-Brasil: confia na lista oficial do ITI (além das ACs padrão).
  const ca = [...(await acsIcpBrasil()), ...((process.env.SEFAZ_CA_PEM || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [])];
  // TLS 1.2: é nela que as SEFAZ pedem o certificado por renegociação (o OpenSSL do Node atende).
  agente = new https.Agent({ pfx, passphrase: process.env.SEFAZ_CERT_SENHA || '', ca, keepAlive: true, maxSockets: 8, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
  return agente;
}
function igual(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
async function enviar(url, corpo, tipo) {
  const agent = await agenteSefaz();
  return new Promise((ok, falha) => {
    const req = https.request(url, { method: 'POST', agent, headers: { 'Content-Type': tipo, 'Content-Length': Buffer.byteLength(corpo) }, timeout: 25000 }, (res) => {
      const partes = []; res.on('data', (c) => partes.push(c)); res.on('end', () => ok({ status: res.statusCode, corpo: Buffer.concat(partes).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado na SEFAZ')));
    req.on('error', falha); req.end(corpo);
  });
}
module.exports = async (req, res) => {
  const responder = (st, obj) => { res.statusCode = st; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return responder(405, { erro: 'Use POST' });
  const token = process.env.PROXY_TOKEN || '';
  if (token.length < 24 || !igual(req.headers['x-proxy-token'] || '', token)) return responder(401, { erro: 'Não autorizado' });
  let b = req.body; if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b.url !== 'string' || typeof b.corpo !== 'string' || !PERMITIDOS.test(b.url) || b.corpo.length > 200000) return responder(400, { erro: 'Pedido inválido' });
  try { const r = await enviar(b.url, b.corpo, b.tipo || 'application/soap+xml; charset=utf-8'); return responder(200, r); }
  catch (e) { return responder(502, { erro: e.message, codigo: e.codigo || e.code || 'erro' }); }
};
