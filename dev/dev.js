/* =====================================================================
   PAINEL DEV — só o administrador da plataforma.
   Um lugar só para: nome da plataforma, empresas, sistemas de cada uma,
   pessoas com acesso, site (no ar / link / números) e as opções do dev.
   Endereço: …/dev/
===================================================================== */
(() => {
  'use strict';
  const P = window.Plataforma, db = P.db, esc = P.esc;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const ICONES = { 'users': '👥', 'file-text': '📄', 'truck': '🚛', 'tag': '🏷️', 'truck-box': '🚚', 'store': '🏪' };
  const PAPEIS = { dono: 'Dono', gerente: 'Gerente', usuario: 'Usuário' };

  const st = { user: null, config: null, empresas: [], catalogo: [], mods: [], resumo: {}, membros: {} };

  /* ---------------- utilidades ---------------- */
  let tt;
  function toast(m, ms = 3800) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms); }
  function traduz(m) {
    m = String(m || '');
    if (/row-level security|permission denied/i.test(m)) return 'Sem permissão para isso.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Sem conexão com a internet.';
    if (/dev_resumo|core_config|dev_empresa_opcoes/.test(m) && /does not exist|não existe|schema cache/i.test(m))
      return 'Rode a migração 014_painel_dev.sql no Supabase primeiro.';
    return m;
  }
  function erro(e) { console.error(e); toast(traduz(e && e.message || e), 6500); }
  function ok(r) { if (r.error) throw r.error; return r.data; }
  function modal(html) { $('#modal-corpo').innerHTML = html; $('#modal').showModal(); }
  function fecharModal() { $('#modal').close(); $('#modal-corpo').innerHTML = ''; }
  const dados = f => Object.fromEntries(new FormData(f).entries());
  async function ocupado(btn, fn) { if (btn) btn.disabled = true; try { return await fn(); } finally { if (btn) btn.disabled = false; } }
  const cont = () => $('#conteudo');
  const linkSite = r => r && r.site_slug ? (r.site_dominio ? 'https://' + r.site_dominio : new URL('site/?l=' + encodeURIComponent(r.site_slug), P.raiz).href) : '';

  /* ---------------- carregar ---------------- */
  async function carregar() {
    const [config, emps, cat, mods, resumo] = await Promise.all([
      db.from('core_config').select('*').maybeSingle().then(ok),
      db.from('core_empresas').select('*').order('nome').then(ok),
      db.from('core_modulos').select('*').eq('ativo', true).order('ordem').then(ok),
      db.from('core_empresa_modulos').select('*').then(ok),
      P.rpc('dev_resumo')
    ]);
    st.config = config; st.empresas = emps || []; st.catalogo = cat || []; st.mods = mods || [];
    st.resumo = Object.fromEntries((resumo || []).map(r => [r.empresa_id, r]));
    const membros = await Promise.all(st.empresas.map(e => P.rpc('core_membros_da_empresa', { p_empresa: e.id }).catch(() => [])));
    st.membros = Object.fromEntries(st.empresas.map((e, i) => [e.id, membros[i] || []]));
    $('#devPlat').textContent = nomePlataforma();
    render();
  }
  const nomePlataforma = () => (st.config && st.config.nome_plataforma) || P.cfg.nome || 'Plataforma';
  const modulosDe = id => st.mods.filter(m => m.empresa_id === id && m.ativo).map(m => m.modulo);

  /* ---------------- tela ---------------- */
  function render() {
    cont().innerHTML = `
      <div class="card">
        <div class="dev-sec" style="margin-top:0"><h2>⚙️ Plataforma</h2></div>
        <form id="fPlat" class="dev-plat">
          <input name="nome" maxlength="60" required value="${esc(nomePlataforma())}" aria-label="Nome da plataforma">
          <button class="btn sm auto pri">Salvar nome</button>
        </form>
        <p class="sub" style="margin-top:8px;font-size:12.5px">Aparece na tela de entrada e no topo da plataforma.</p>
      </div>
      <div class="dev-sec"><h2>🏢 Empresas (${st.empresas.length})</h2><button class="btn sm auto pri" data-act="nova-emp">+ Nova empresa</button></div>
      ${st.empresas.map(cardEmpresa).join('') || '<div class="card vazio">Nenhuma empresa ainda. Crie a primeira.</div>'}`;
  }

  function cardEmpresa(e) {
    const mods = modulosDe(e.id), r = st.resumo[e.id] || {}, pessoas = st.membros[e.id] || [];
    const temLoja = mods.includes('loja');
    const link = linkSite(r);
    return `<div class="card dev-emp" data-emp="${e.id}">
      <div class="cab"><b>${esc(e.nome)}</b>${e.ativo === false ? '<span class="tag off">inativa</span>' : ''}
        <button class="btn sm auto" data-act="editar">Editar</button>
        <button class="btn sm auto" data-act="entrar">Entrar nesta empresa →</button></div>
      ${e.cidade || e.documento ? `<p class="sub" style="margin-top:4px">${esc([e.cidade, e.documento].filter(Boolean).join(' · '))}</p>` : ''}

      <div class="dev-bloco"><h3>Sistemas liberados</h3>
        <div class="chips">${st.catalogo.map(m => `<button class="chip${mods.includes(m.codigo) ? ' on' : ''}" data-act="mod" data-mod="${esc(m.codigo)}">${ICONES[m.icone] || '🧩'} ${esc(m.nome)}</button>`).join('')}</div>
      </div>

      <div class="dev-bloco"><h3>Pessoas com acesso (${pessoas.length})</h3>
        ${pessoas.map(p => `<div class="dev-pessoa" data-u="${p.usuario_id}">
            <div class="quem">${esc(p.nome || p.email)}<small>${esc(p.email)}</small></div>
            <select data-act="papel" aria-label="Papel">${Object.entries(PAPEIS).map(([k, v]) => `<option value="${k}"${p.papel === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            <button class="btn sm auto perigo" data-act="remover">Remover</button></div>`).join('') || '<p class="sub">Ninguém ainda.</p>'}
        <div class="dev-acoes"><button class="btn sm auto" data-act="pessoa">+ Adicionar pessoa</button></div>
      </div>

      ${temLoja ? `<div class="dev-bloco"><h3>Site</h3>
        ${r.site_slug ? `
          <div><span class="tag${r.site_publicado ? '' : ' off'}">${r.site_publicado ? '● No ar' : '○ Fora do ar'}</span></div>
          <p style="margin:8px 0 0"><a class="dev-link" href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></p>
          <div class="dev-nums">
            <span><b>${r.produtos}</b> produtos</span>
            <span><b>${r.pedidos_abertos}</b> pedidos em aberto</span>
            <span><b>${r.pedidos_30d}</b> pedidos (30 dias)</span>
            <span><b>${r.orcamentos_novos}</b> orçamentos novos</span>
          </div>
          <label class="dev-chave"><input type="checkbox" data-act="publicar" ${r.site_publicado ? 'checked' : ''}>
            <span>Site no ar<small>Desligado: o site mostra "loja indisponível" e ninguém faz pedidos.</small></span></label>`
          : '<p class="sub">O site ainda não foi criado. Entre no painel da loja → ⚙️ Site para criar.</p>'}
        <label class="dev-chave"><input type="checkbox" data-act="integra" ${r.integra_orcamentos ? 'checked' : ''} ${mods.includes('orcamentos') ? '' : 'disabled'}>
          <span>Orçamentos do site viram orçamento no módulo Orçamentos
          <small>${mods.includes('orcamentos') ? 'Desligado: os pedidos de orçamento ficam só numa caixa de entrada dentro da loja.' : 'Libere o sistema Orçamentos nesta empresa para poder ligar.'}</small></span></label>
        <div class="dev-acoes"><button class="btn sm auto" data-act="abrir-loja">🏪 Abrir painel da loja</button></div>
      </div>` : ''}
    </div>`;
  }

  /* ---------------- ações ---------------- */
  document.addEventListener('submit', async ev => {
    if (ev.target.id !== 'fPlat') return;
    ev.preventDefault();
    const nome = dados(ev.target).nome.trim(); if (!nome) return;
    await ocupado(ev.submitter, async () => {
      try { st.config = ok(await db.from('core_config').update({ nome_plataforma: nome }).eq('id', true).select().single()); $('#devPlat').textContent = nome; toast('Nome da plataforma salvo.'); }
      catch (e) { erro(e); }
    });
  });

  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.type === 'checkbox') return;
    const card = b.closest('[data-emp]'), emp = card && st.empresas.find(e => e.id === card.dataset.emp);
    try {
      switch (b.dataset.act) {
        case 'nova-emp': return formEmpresa();
        case 'editar': return formEmpresa(emp);
        case 'pessoa': return formPessoa(emp);
        case 'entrar': P.definirEmpresa(emp.id); location.href = P.raiz + 'index.html'; return;
        case 'abrir-loja': P.definirEmpresa(emp.id); location.href = P.raiz + 'modulos/loja/index.html?empresa=' + emp.id; return;
        case 'mod': {
          const cod = b.dataset.mod, linha = st.mods.find(x => x.empresa_id === emp.id && x.modulo === cod);
          b.disabled = true;
          if (linha) ok(await db.from('core_empresa_modulos').update({ ativo: !linha.ativo }).eq('empresa_id', emp.id).eq('modulo', cod));
          else ok(await db.from('core_empresa_modulos').insert({ empresa_id: emp.id, modulo: cod }));
          return carregar();
        }
        case 'remover': {
          const u = b.closest('[data-u]').dataset.u, p = (st.membros[emp.id] || []).find(x => x.usuario_id === u);
          if (!confirm(`Tirar o acesso de ${p ? p.email : 'esta pessoa'} à empresa ${emp.nome}?`)) return;
          await P.rpc('core_remover_membro', { p_empresa: emp.id, p_usuario: u });
          toast('Acesso removido.'); return carregar();
        }
      }
    } catch (e) { erro(e); carregar().catch(erro); }
  });

  document.addEventListener('change', async ev => {
    const el = ev.target, card = el.closest('[data-emp]'); if (!card) return;
    const emp = st.empresas.find(e => e.id === card.dataset.emp);
    try {
      if (el.dataset.act === 'papel') {
        const u = el.closest('[data-u]').dataset.u;
        ok(await db.from('core_membros').update({ papel: el.value }).eq('empresa_id', emp.id).eq('usuario_id', u));
        return toast('Papel atualizado.');
      }
      if (el.dataset.act === 'publicar') {
        ok(await db.from('loj_config').update({ publicado: el.checked }).eq('empresa_id', emp.id));
        toast(el.checked ? 'Site no ar.' : 'Site tirado do ar.'); return carregar();
      }
      if (el.dataset.act === 'integra') {
        ok(await db.from('dev_empresa_opcoes').upsert({ empresa_id: emp.id, loja_integra_orcamentos: el.checked, atualizado_em: new Date().toISOString() }));
        toast(el.checked ? 'Orçamentos do site ligados ao módulo Orçamentos.' : 'Orçamentos do site ficam só na caixa de entrada da loja.'); return carregar();
      }
    } catch (e) { erro(e); carregar().catch(erro); }
  });

  function formEmpresa(e = {}) {
    modal(`<h3>${e.id ? 'Editar empresa' : 'Nova empresa'}</h3>
      <form id="fEmp" class="form-grid">
        <label class="full">Nome<input name="nome" required maxlength="120" value="${esc(e.nome)}"></label>
        <label>CNPJ / CPF<input name="documento" value="${esc(e.documento)}"></label>
        <label>Telefone<input name="telefone" value="${esc(e.telefone)}"></label>
        <label class="full">Cidade / UF<input name="cidade" value="${esc(e.cidade)}"></label>
        ${e.id ? `<label class="full" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="ativo" style="width:20px;height:20px;margin:0" ${e.ativo !== false ? 'checked' : ''}> Empresa ativa (desligada: ninguém dela consegue entrar e o site sai do ar)</label>` : ''}
        <div class="acoes full"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn pri" style="width:auto">Salvar</button></div>
      </form>`);
    $('#fEmp').onsubmit = async ev => {
      ev.preventDefault(); const f = dados(ev.target);
      const row = { nome: f.nome.trim(), documento: f.documento.trim() || null, telefone: f.telefone.trim() || null, cidade: f.cidade.trim() || null };
      if (e.id) row.ativo = !!f.ativo;
      await ocupado(ev.submitter, async () => {
        try {
          if (e.id) ok(await db.from('core_empresas').update(row).eq('id', e.id));
          else ok(await db.from('core_empresas').insert(row));
          fecharModal(); toast('Empresa salva.'); await carregar();
        } catch (ex) { erro(ex); }
      });
    };
  }

  function formPessoa(emp) {
    modal(`<h3>Adicionar pessoa — ${esc(emp.nome)}</h3>
      <form id="fPes" class="form-grid">
        <label>E-mail<input name="email" type="email" required></label>
        <label>Papel<select name="papel"><option value="dono">Dono</option><option value="gerente">Gerente</option><option value="usuario">Usuário</option></select></label>
        <p class="sub full" style="font-size:12.5px">A pessoa precisa ter criado a conta antes: ela abre a plataforma e toca em <b>Criar conta</b>.</p>
        <div class="acoes full"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn pri" style="width:auto">Adicionar</button></div>
      </form>`);
    $('#fPes').onsubmit = async ev => {
      ev.preventDefault(); const f = dados(ev.target);
      await ocupado(ev.submitter, async () => {
        try { await P.rpc('core_adicionar_membro', { p_empresa: emp.id, p_email: f.email.trim(), p_papel: f.papel }); fecharModal(); toast('Pessoa adicionada.'); await carregar(); }
        catch (ex) { erro(ex); }
      });
    };
  }
  $('#modal').addEventListener('click', e => { if (e.target.closest('[data-fechar]') || e.target.id === 'modal') fecharModal(); });

  /* ---------------- início ---------------- */
  (async () => {
    try {
      st.user = await P.usuario();
      if (!st.user) { location.replace(P.raiz + 'index.html?voltar=' + encodeURIComponent(location.href)); return; }
      if (!(await P.souAdmin())) {
        cont().innerHTML = '<div class="card vazio">Esta área é só do administrador da plataforma.<div class="acoes" style="justify-content:center;margin-top:14px"><a class="btn" href="../index.html">Voltar</a></div></div>';
        $('#devPlat').textContent = '';
        return;
      }
      await carregar();
    } catch (e) {
      erro(e);
      cont().innerHTML = `<div class="card vazio">${esc(traduz(e && e.message || e))}</div>`;
    }
  })();
})();
