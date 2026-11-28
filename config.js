// Configuração pública da plataforma.
// A chave publishable (anon) pode ficar no app: quem protege os dados são as
// regras de acesso (RLS) do banco. NUNCA coloque aqui a chave service_role,
// sb_secret_, senhas ou tokens privados.
window.PLAT_CONFIG = {
  nome: 'Plataforma KE',
  supabaseUrl: 'https://ilhscefovklryuhdemlv.supabase.co',
  supabaseAnonKey: 'sb_publishable_hfzPRlEWhbUakMJgTok4Zg_aRdML-_s',
  lojaPadrao: 'ke',  // site/ sem ?l= abre esta loja
  // Domínios próprios onde abre a PLATAFORMA (login), e não uma loja.
  // Ex.: ['app.keobrafacil.com.br']. Qualquer outro domínio próprio abre o site da loja.
  hostsPlataforma: []
};
