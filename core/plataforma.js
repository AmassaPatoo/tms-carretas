/* =====================================================================
   PLATAFORMA KE — núcleo compartilhado
   Usado pela tela principal e por todos os módulos (modulos/<nome>/).
   Carregue antes: vendor/supabase.js e config.js
===================================================================== */
window.Plataforma = (() => {
  'use strict';
  const script = document.currentScript;
  const raiz = script ? script.src.replace(/core\/plataforma\.js(\?.*)?$/, '') : './';
  const cfg = window.PLAT_CONFIG || window.TMS_CONFIG || {};
  if (!window.supabase) throw new Error('Biblioteca do Supabase não carregou.');
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Configure o arquivo config.js com a URL e a chave pública do Supabase.');

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const LS_EMPRESA = 'plat_empresa';

  async function usuario() {
    const { data: { session } } = await db.auth.getSession();
    return session ? session.user : null;
  }
  function empresaAtual() {
    const p = new URL(location.href).searchParams.get('empresa');
    try { return p || localStorage.getItem(LS_EMPRESA); } catch (e) { return p; }
  }
  function definirEmpresa(id) { try { localStorage.setItem(LS_EMPRESA, id); } catch (e) {} }

  async function rpc(nome, args) {
    const { data, error } = await db.rpc(nome, args);
    if (error) throw error;
    return data;
  }
  const acessos = () => rpc('core_meus_acessos').then(d => d || []);
  const souAdmin = () => rpc('core_e_admin').then(Boolean).catch(() => false);

  /* Para páginas de módulo: confere login, empresa e se o módulo está liberado.
     Devolve { db, usuario, empresa:{empresa_id, empresa_nome, papel, modulos}, admin, raiz }
     ou redireciona para a tela principal. */
  async function exigirModulo(codigo) {
    const u = await usuario();
    if (!u) { location.replace(raiz + 'index.html?voltar=' + encodeURIComponent(location.href)); return null; }
    const [lista, admin] = await Promise.all([acessos(), souAdmin()]);
    const id = empresaAtual();
    let e = lista.find(x => x.empresa_id === id) || (lista.length === 1 && !id ? lista[0] : null);
    if (!e && admin && id) {
      const { data } = await db.from('core_empresas').select('id,nome').eq('id', id).maybeSingle();
      const { data: mods } = await db.from('core_empresa_modulos').select('modulo').eq('empresa_id', id).eq('ativo', true);
      if (data) e = { empresa_id: data.id, empresa_nome: data.nome, papel: 'admin', modulos: (mods || []).map(m => m.modulo) };
    }
    if (!e || !(e.modulos || []).includes(codigo)) {
      location.replace(raiz + 'index.html?aviso=' + encodeURIComponent('Este sistema não está liberado para a empresa escolhida.'));
      return null;
    }
    definirEmpresa(e.empresa_id);
    return { db, usuario: u, empresa: e, admin, raiz };
  }

  async function sair() {
    await db.auth.signOut();
    location.replace(raiz + 'index.html');
  }

  /* Barra fina no topo dos módulos: volta para a plataforma e mostra a empresa */
  function barraModulo(ctx, nomeModulo) {
    if (document.getElementById('plat-barra')) return;
    const b = document.createElement('div');
    b.id = 'plat-barra';
    b.innerHTML = `<a href="${raiz}index.html" title="Voltar para a plataforma">← ${esc(cfg.nome || 'Plataforma')}</a>
      <span>${esc(nomeModulo)} · <b>${esc(ctx.empresa.empresa_nome)}</b></span>`;
    const st = document.createElement('style');
    st.textContent = `#plat-barra{position:sticky;top:0;z-index:999;height:34px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;
      padding:7px 14px;background:#06263a;color:#cfe3ee;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
      #plat-barra a{color:#fff;text-decoration:none;background:rgba(255,255,255,.12);border-radius:8px;padding:5px 10px;white-space:nowrap}
      #plat-barra span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#plat-barra b{color:#ff8a33}`;
    document.head.appendChild(st);
    document.body.prepend(b);
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  return { db, raiz, cfg, usuario, empresaAtual, definirEmpresa, rpc, acessos, souAdmin, exigirModulo, sair, barraModulo, esc };
})();
