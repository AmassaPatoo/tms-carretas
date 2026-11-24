// =====================================================================
//  PLATAFORMA KE — função "sefaz" (Supabase Edge Function)
//  Consulta na SEFAZ, com o certificado digital A1 da empresa:
//   • NF-e: autorizada / cancelada / denegada (NFeConsultaProtocolo4, na SEFAZ que autorizou)
//   • CT-e: autorizado / cancelado (CTeConsultaV4)
//   • SEFAZ-AM: selo eletrônico / desembaraço da NF-e e notas não seladas do CT-e (API GAF)
//
//  Segredos (Supabase → Edge Functions → Secrets):
//   SEFAZ_CERT_PFX    certificado A1 (.pfx) em base64          (obrigatório)
//   SEFAZ_CERT_SENHA  senha do certificado                      (obrigatório)
//   SEFAZ_AM_PERFIL   perfis na SEFAZ-AM, em ordem de tentativa (opcional, padrão "1,2")
//                     1 = emitente do documento · 2 = CNPJ autorizado no XML · 3 = terminal credenciado
//   SEFAZ_CA_PEM      certificados extras de AC em PEM          (opcional)
//
//  O certificado nunca sai daqui: o app só recebe o resultado.
// =====================================================================
import forge from "npm:node-forge@1.3.1";
import { unzipSync } from "npm:fflate@0.8.2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

// ---------- endereços (produção) ----------
const UF_COD: Record<string, string> = { "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF" };
const NFE_URL: Record<string, string> = {
  AM: "https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4",
  BA: "https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
  GO: "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
  MG: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4",
  MS: "https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
  MT: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4",
  PE: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4",
  PR: "https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4",
  RS: "https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
  SP: "https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
  MA: "https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
};
const NFE_SVRS = "https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx"; // AC AL AP CE DF ES PA PB PI RJ RN RO RR SC SE TO
const CTE_URL: Record<string, string> = {
  MT: "https://cte.sefaz.mt.gov.br/ctews2/services/CTeConsultaV4",
  MS: "https://producao.cte.ms.gov.br/ws/CTeConsultaV4",
  MG: "https://cte.fazenda.mg.gov.br/cte/services/CTeConsultaV4",
  PR: "https://cte.fazenda.pr.gov.br/cte4/CTeConsultaV4",
  RS: "https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx",
  SP: "https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx",
  AP: "https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx", PE: "https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx", RR: "https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeConsultaV4.asmx",
};
const CTE_SVRS = "https://cte.svrs.rs.gov.br/ws/CTeConsultaV4/CTeConsultaV4.asmx";
const GAF = "https://sistemas.sefaz.am.gov.br/gaf-api/desembaracoDFe/situacao";
const ICP_ZIP = "https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip";

// ---------- certificado e conexão ----------
type Cred = { cert: string; key: string; cnpj: string; validade: string; nome: string };
let credCache: Cred | null = null, clienteCache: Deno.HttpClient | null = null, caCache: string[] | null = null;

function lerPfx(): Cred {
  if (credCache) return credCache;
  const b64 = (Deno.env.get("SEFAZ_CERT_PFX") || "").replace(/\s+/g, ""), senha = Deno.env.get("SEFAZ_CERT_SENHA") || "";
  if (!b64) throw new Erro("sem_certificado", "O certificado digital ainda não foi configurado no Supabase.");
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(b64)), false, senha); }
  catch { throw new Erro("certificado_invalido", "Não consegui abrir o certificado: confira o arquivo e a senha."); }
  const bagsK = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const bagsK2 = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  const chave = (bagsK[0] || bagsK2[0])?.key;
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b: any) => b.cert).filter(Boolean);
  if (!chave || !certs.length) throw new Erro("certificado_invalido", "O certificado não tem chave privada.");
  // o certificado da empresa é o que casa com a chave privada; o resto é a cadeia
  const pubDaChave = forge.pki.setRsaPublicKey(chave.n, chave.e);
  const folha = certs.find((c: any) => forge.pki.publicKeyToPem(c.publicKey) === forge.pki.publicKeyToPem(pubDaChave)) || certs[0];
  const cadeia = [folha, ...certs.filter((c: any) => c !== folha)];
  const cn = folha.subject.getField("CN")?.value || "";
  credCache = {
    cert: cadeia.map((c: any) => forge.pki.certificateToPem(c)).join(""),
    key: forge.pki.privateKeyToPem(chave),
    cnpj: (/:(\d{14})/.exec(cn) || [])[1] || "",
    nome: cn.replace(/:\d{11,14}$/, ""),
    validade: folha.validity.notAfter.toISOString(),
  };
  if (new Date(credCache.validade) < new Date()) throw new Erro("certificado_vencido", `O certificado venceu em ${credCache.validade.slice(0, 10)}.`);
  return credCache;
}

function derParaPem(b: Uint8Array): string {
  let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return "-----BEGIN CERTIFICATE-----\n" + btoa(s).replace(/(.{64})/g, "$1\n") + "\n-----END CERTIFICATE-----\n";
}
// As SEFAZ usam certificados da ICP-Brasil, que não vêm na lista padrão: baixa as ACs oficiais (ITI) uma vez.
async function acsIcpBrasil(): Promise<string[]> {
  if (caCache) return caCache;
  const out: string[] = [];
  const extra = Deno.env.get("SEFAZ_CA_PEM"); if (extra) out.push(...(extra.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []));
  try {
    const r = await fetch(ICP_ZIP, { signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      const arqs = unzipSync(new Uint8Array(await r.arrayBuffer()));
      for (const [nome, b] of Object.entries(arqs)) {
        if (!/\.(crt|cer|pem)$/i.test(nome) || !b.length) continue;
        const t = new TextDecoder().decode(b.subarray(0, 30));
        if (t.startsWith("-----BEGIN")) out.push(...(new TextDecoder().decode(b).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []));
        else out.push(derParaPem(b));
      }
    }
  } catch (e) { console.warn("ACs ICP-Brasil não baixadas:", e); }
  // só certificados de AC válidos (v3, dentro da validade): um item ruim derrubaria a conexão
  const agora = new Date();
  caCache = out.filter((pem) => { try { const c = forge.pki.certificateFromPem(pem); return c.version === 2 && c.validity.notAfter > agora; } catch { return false; } });
  return caCache;
}
async function cliente(): Promise<Deno.HttpClient> {
  if (clienteCache) return clienteCache;
  const c = lerPfx(), caCerts = await acsIcpBrasil();
  // deno-lint-ignore no-explicit-any
  const D = Deno as any;
  if (typeof D.createHttpClient !== "function") throw new Erro("sem_mtls", "Este servidor não permite conexão com certificado digital.");
  clienteCache = D.createHttpClient({ cert: c.cert, key: c.key, caCerts, http2: false });
  return clienteCache!;
}
async function post(url: string, body: string, contentType: string, timeout = 25000): Promise<string> {
  const client = await cliente();
  const teste = Deno.env.get("SEFAZ_URL_TESTE"); if (teste) url = teste + new URL(url).pathname; // só para testes locais
  const r = await fetch(url, { method: "POST", body, headers: { "Content-Type": contentType }, client, signal: AbortSignal.timeout(timeout) } as RequestInit);
  const t = await r.text();
  if (!r.ok && !/<(soap|env)?:?Envelope/i.test(t)) throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
  return t;
}
class Erro extends Error { constructor(public codigo: string, msg: string) { super(msg); } }

// ---------- leitura de XML sem bibliotecas ----------
const tag = (x: string, n: string) => (new RegExp(`<(?:\\w+:)?${n}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${n}>`).exec(x) || [])[1]?.trim() || "";
const tags = (x: string, n: string) => [...x.matchAll(new RegExp(`<(?:\\w+:)?${n}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${n}>`, "g"))].map((m) => m[1]);
const dvOk = (ch: string) => { if (!/^\d{44}$/.test(ch)) return false; let s = 0, p = 2; for (let i = 42; i >= 0; i--) { s += +ch[i] * p; p = p === 9 ? 2 : p + 1; } const r = s % 11; return (r < 2 ? 0 : 11 - r) === +ch[43]; };

function situacao(cStat: string, eventos: string[]): string {
  if (eventos.includes("110111") || eventos.includes("110112") || ["101", "151", "155"].includes(cStat)) return "cancelada";
  if (["110", "205", "301", "302", "303"].includes(cStat)) return "denegada";
  if (cStat === "100" || cStat === "150") return "autorizada";
  if (cStat === "217") return "nao_encontrada";
  return "outro";
}

async function consultarNfe(ch: string) {
  const uf = UF_COD[ch.slice(0, 2)], url = NFE_URL[uf] || NFE_SVRS;
  const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4"><consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>1</tpAmb><xServ>CONSULTAR</xServ><chNFe>${ch}</chNFe></consSitNFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  const x = await post(url, env, "application/soap+xml; charset=utf-8");
  const ret = tag(x, "retConsSitNFe") || x, cStat = tag(ret, "cStat"), prot = tag(ret, "infProt");
  const eventos = tags(ret, "infEvento").map((e) => tag(e, "tpEvento")).filter(Boolean);
  return { situacao: situacao(cStat, eventos), cStat, motivo: tag(ret, "xMotivo"), protocolo: tag(prot, "nProt"), data: tag(prot, "dhRecbto"), uf, eventos };
}
async function consultarCte(ch: string) {
  const uf = UF_COD[ch.slice(0, 2)], url = CTE_URL[uf] || CTE_SVRS;
  const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeConsultaV4"><consSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><tpAmb>1</tpAmb><xServ>CONSULTAR</xServ><chCTe>${ch}</chCTe></consSitCTe></cteDadosMsg></soap12:Body></soap12:Envelope>`;
  const x = await post(url, env, "application/soap+xml; charset=utf-8");
  const ret = tag(x, "retConsSitCTe") || x, cStat = tag(ret, "cStat"), prot = tag(ret, "infProt");
  const eventos = tags(ret, "infEvento").map((e) => tag(e, "tpEvento")).filter(Boolean);
  return { situacao: situacao(cStat, eventos), cStat, motivo: tag(ret, "xMotivo"), protocolo: tag(prot, "nProt"), data: tag(prot, "dhRecbto"), uf, eventos };
}

// SEFAZ-AM (GAF): idTipoConsulta 1 = NF-e (até 50), 2 = CT-e (até 10)
async function seloAm(tipo: 1 | 2, chaves: string[]) {
  const perfis = (Deno.env.get("SEFAZ_AM_PERFIL") || "1,2").split(",").map((s) => Number(s.trim())).filter((n) => [1, 2, 3].includes(n));
  const lote = tipo === 1 ? 50 : 10, saida: Record<string, unknown> = {};
  for (let i = 0; i < chaves.length; i += lote) {
    const parte = chaves.slice(i, i + lote);
    let ultimo = "";
    for (const perfil of perfis) {
      try {
        const t = await post(GAF, JSON.stringify({ idTipoConsulta: tipo, idTipoPerfilConsulta: perfil, listaChaveDFe: parte }), "application/json");
        let arr: any; try { arr = JSON.parse(t); } catch { throw new Error(t.slice(0, 160)); }
        arr = Array.isArray(arr) ? arr : [arr];
        const achou = arr.filter((d: any) => d && d.chaveAcessoDFe && d.situacao_dfe_id != null);
        if (!achou.length) { ultimo = arr[0]?.result_proc_descricao || "sem retorno"; continue; }
        for (const d of arr) {
          if (!d?.chaveAcessoDFe) continue;
          const naoSel = (Array.isArray(d.listaNFeNaoSelada) ? d.listaNFeNaoSelada : []).filter((n: any) => n && typeof n === "object").map((n: any) => ({
            chave: n.codgChaveAcessoNFe, situacao: n.situacao_descricao, selo: n.numeroSeloEletronico || null, data_selo: n.dataSeloEletronico || null,
            canal: n.canal_descricao || null, pendencia: n.detalhamentoPendencia || null,
          }));
          saida[d.chaveAcessoDFe] = {
            perfil, situacao_id: d.situacao_dfe_id, situacao: d.situacao_dfe_descricao, canal: d.canal_descricao || null,
            selado: Number(d.situacao_dfe_id) === 4 || !!(d.numeroSeloEletronicoNFe),
            selo: d.numeroSeloEletronicoNFe || null, data_selo: d.dataSeloEletronicoNFe || null, data_apresentacao: d.dataApresentacaoNFe || null,
            cancelado: d.documentoCancelado === true || d.documentoCancelado === "S", nfe_nao_seladas: naoSel,
            retorno: d.result_proc_descricao || null,
          };
        }
        ultimo = ""; break;
      } catch (e) { ultimo = (e as Error).message; }
    }
    for (const ch of parte) if (!saida[ch]) saida[ch] = { erro: ultimo || "Não encontrado na SEFAZ-AM" };
  }
  return saida;
}

// ---------- quem pode usar: gestor da empresa ----------
async function ehGestor(req: Request, empresa: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL"), anon = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY"), auth = req.headers.get("Authorization") || "";
  if (!url || !anon || !auth || !/^[0-9a-f-]{36}$/.test(empresa)) return false;
  const r = await fetch(`${url}/rest/v1/rpc/car_eh_gestor`, { method: "POST", headers: { apikey: anon, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify({ p_empresa: empresa }) });
  return r.ok && (await r.json()) === true;
}

async function limitar<T>(itens: string[], n: number, f: (x: string) => Promise<T>) {
  const out: Record<string, T | { erro: string }> = {}; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const x = itens[i++]; try { out[x] = await f(x); } catch (e) { out[x] = { erro: (e as Error).message }; } }
  }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  let body: any; try { body = await req.json(); } catch { return json({ erro: "JSON inválido" }, 400); }
  if (!(await ehGestor(req, String(body?.empresa || "")))) return json({ codigo: "sem_permissao", erro: "Somente o gestor da empresa pode consultar a SEFAZ." }, 403);

  if (body.acao === "status") {
    try { const c = lerPfx(); return json({ configurado: true, cnpj: c.cnpj, nome: c.nome, validade: c.validade }); }
    catch (e) { return json({ configurado: false, codigo: (e as Erro).codigo || "erro", erro: (e as Error).message }); }
  }

  if (body.acao === "diagnostico") {
    const alvos = ["https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx", "https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
      "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx", "https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4", GAF];
    const out: Record<string, string> = {};
    let client: Deno.HttpClient | null = null; try { client = await cliente(); } catch (e) { return json({ erro: (e as Error).message }); }
    await Promise.all(alvos.map(async (u) => {
      for (const [rot, c] of [["com_cert", client], ["sem_cert", null]] as const) {
        try { const r = await fetch(u + "?wsdl", { client: c ?? undefined, signal: AbortSignal.timeout(15000) } as RequestInit); out[`${u} ${rot}`] = "HTTP " + r.status; await r.body?.cancel(); }
        catch (e) { out[`${u} ${rot}`] = (e as Error).message.slice(-140); }
      }
    }));
    let ip = ""; try { ip = await (await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(8000) })).text(); } catch { /* sem ip */ }
    return json({ ip, regiao: Deno.env.get("SB_REGION") || Deno.env.get("DENO_REGION") || "", acs_icp: (await acsIcpBrasil()).length, resultado: out });
  }

  const limpa = (a: unknown) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).replace(/\D/g, "")).filter(dvOk))];
  const nfe = limpa(body.nfe).filter((k) => ["55"].includes(k.slice(20, 22))).slice(0, 100);
  const cte = limpa(body.cte).filter((k) => ["57", "67"].includes(k.slice(20, 22))).slice(0, 30);
  if (!nfe.length && !cte.length) return json({ erro: "Nenhuma chave válida para consultar." }, 400);
  try { await cliente(); } catch (e) { return json({ configurado: false, codigo: (e as Erro).codigo || "erro", erro: (e as Error).message }); }

  const am = body.selo_am !== false;
  const [rNfe, rCte, sNfe, sCte] = await Promise.all([
    limitar(nfe, 4, consultarNfe), limitar(cte, 3, consultarCte),
    am && nfe.length ? seloAm(1, nfe).catch((e) => ({ _erro: e.message })) : {}, am && cte.length ? seloAm(2, cte).catch((e) => ({ _erro: e.message })) : {},
  ]);
  const quando = new Date().toISOString();
  return json({
    configurado: true, consultado_em: quando,
    nfe: Object.fromEntries(nfe.map((k) => [k, { autorizacao: rNfe[k], selo_am: (sNfe as any)[k] || ((sNfe as any)._erro ? { erro: (sNfe as any)._erro } : null) }])),
    cte: Object.fromEntries(cte.map((k) => [k, { autorizacao: rCte[k], selo_am: (sCte as any)[k] || ((sCte as any)._erro ? { erro: (sCte as any)._erro } : null) }])),
  });
});
