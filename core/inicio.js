/* =====================================================================
   PLATAFORMA KE — tela principal
   Entrada (login / criar conta / senha), escolha da empresa, módulos,
   clientes, equipe e administração.
===================================================================== */
(() => {
  'use strict';
  const P = window.Plataforma, db = P.db, esc = P.esc;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

  /* Módulos que têm app próprio dentro da pasta modulos/ */
  const APPS = { orcamentos: 'modulos/orcamentos/index.html', carreta: 'modulos/carreta/index.html', cotacoes: 'modulos/cotacoes/index.html' };
  const ICONES = { 'users': '👥', 'file-text': '📄', 'truck': '🚛', 'tag': '🏷️' };
  const PAPEIS = { dono: 'Dono', gerente: 'Gerente', usuario: 'Usuário', admin: 'Administrador' };

  const st = { user: null, perfil: null, admin: false, empresas: [], empresa: null, catalogo: [], modsAdmin: [], aba: 'inicio', clientes: [] };
  let instalar = null;

  /* ---------------- utilidades ---------------- */
  let tt;
  function toast(m, ms = 3800) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), ms); }
  function traduz(m) {
    m = String(m || '');
    const mapa = [
      [/Invalid login credentials/i, 'E-mail ou senha incorretos.'],
      [/Email not confirmed/i, 'Confirme o seu e-mail (veja a caixa de entrada) antes de entrar.'],
      [/User already registered/i, 'Já existe uma conta com este e-mail. Use "Entrar" ou "Esqueci minha senha".'],
      [/Password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
      [/rate limit|too many/i, 'Muitas tentativas seguidas. Espere um pouco e tente de novo.'],
      [/Signups not allowed/i, 'O cadastro de novas contas está desativado no Supabase. Peça ao administrador para criar a sua conta.'],
      [/row-level security/i, 'Você não tem permissão para fazer isso.'],
      [/Failed to fetch|NetworkError/i, 'Sem conexão com a internet.']
    ];
    for (const [r, t] of mapa) if (r.test(m)) return t;
    return m;
  }
  function erro(e) { console.error(e); toast(traduz(e && e.message || e), 6500); }
  function modal(html) { $('#modal-corpo').innerHTML = html; $('#modal').showModal(); }
  function fecharModal() { $('#modal').close(); $('#modal-corpo').innerHTML = ''; }
  const dados = f => Object.fromEntries(new FormData(f).entries());
  async function ocupado(btn, fn) { if (btn) btn.disabled = true; try { return await fn(); } finally { if (btn) btn.disabled = false; } }
  function ok(r) { if (r.error) throw r.error; return r.data; }

  /* ---------------- entrada ---------------- */
  function mostrarEntrada(qual = 'login', msg = '', bom = false) {
    $('#tela-app').hidden = true; $('#tela-entrada').hidden = false;
    ['login', 'cadastro', 'esqueci', 'nova-senha'].forEach(f => $('#form-' + f).hidden = f !== qual);
    const m = $('#entrada-msg'); m.textContent = msg; m.classList.toggle('ok', bom);
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (b) mostrarEntrada(b.dataset.ir); });

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault(); const f = dados(e.target);
    await ocupado(e.submitter, async () => {
      const { data, error } = await db.auth.signInWithPassword({ email: f.email.trim(), password: f.senha });
      if (error) return mostrarEntrada('login', traduz(error.message));
      await entrarApp(data.user);
    });
  });
  $('#form-cadastro').addEventListener('submit', async e => {
    e.preventDefault(); const f = dados(e.target);
    await ocupado(e.submitter, async () => {
      const { data, error } = await db.auth.signUp({ email: f.email.trim(), password: f.senha, options: { data: { nome: f.nome.trim() }, emailRedirectTo: location.origin + location.pathname } });
      if (error) return mostrarEntrada('cadastro', traduz(error.message));
      if (data.session) return entrarApp(data.user);
      mostrarEntrada('login', 'Conta criada! Abra o e-mail que enviamos para confirmar e depois entre aqui. Em seguida, peça ao responsável para liberar o seu acesso.', true);
    });
  });
  $('#form-esqueci').addEventListener('submit', async e => {
    e.preventDefault(); const f = dados(e.target);
    await ocupado(e.submitter, async () => {
      const { error } = await db.auth.resetPasswordForEmail(f.email.trim(), { redirectTo: location.origin + location.pathname });
      if (error) return mostrarEntrada('esqueci', traduz(error.message));
      mostrarEntrada('login', 'Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.', true);
    });
  });
  $('#form-nova-senha').addEventListener('submit', async e => {
    e.preventDefault(); const f = dados(e.target);
    await ocupado(e.submitter, async () => {
      const { data, error } = await db.auth.updateUser({ password: f.senha });
      if (error) return mostrarEntrada('nova-senha', traduz(error.message));
      toast('Senha alterada!'); history.replaceState(null, '', location.pathname); await entrarApp(data.user);
    });
  });
  db.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') mostrarEntrada('nova-senha'); });

  /* ---------------- app ---------------- */
  async function entrarApp(user) {
    st.user = user;
    const params = new URL(location.href).searchParams;
    const voltar = params.get('voltar');
    if (voltar) { try { const u = new URL(voltar); if (u.origin === location.origin) { location.replace(voltar); return; } } catch (e) {} }

    const [acessos, admin, cat, perfil] = await Promise.all([
      P.acessos(), P.souAdmin(),
      db.from('core_modulos').select('*').eq('ativo', true).order('ordem').then(ok),
      db.from('core_perfis').select('*').eq('id', user.id).maybeSingle().then(ok)
    ]);
    st.admin = admin; st.catalogo = cat || []; st.perfil = perfil;
    st.empresas = acessos.map(a => ({ id: a.empresa_id, nome: a.empresa_nome, papel: a.papel, modulos: a.modulos || [], ativo: true }));
    if (admin) {
      const [emps, mods] = await Promise.all([
        db.from('core_empresas').select('*').order('nome').then(ok),
        db.from('core_empresa_modulos').select('*').then(ok)
      ]);
      st.modsAdmin = mods || [];
      st.empresas = (emps || []).map(e => {
        const m = st.empresas.find(x => x.id === e.id);
        return { ...e, papel: m ? m.papel : 'admin', modulos: st.modsAdmin.filter(x => x.empresa_id === e.id && x.ativo).map(x => x.modulo) };
      });
    }
    const atual = P.empresaAtual();
    st.empresa = st.empresas.find(e => e.id === atual && e.ativo !== false) || st.empresas.find(e => e.ativo !== false) || null;
    if (st.empresa) P.definirEmpresa(st.empresa.id);

    $('#tela-entrada').hidden = true; $('#tela-app').hidden = false;
    $('#topoNome').textContent = P.cfg.nome || 'Plataforma KE';
    $('#selEmpresa').innerHTML = st.empresas.length
      ? st.empresas.map(e => `<option value="${e.id}"${st.empresa && e.id === st.empresa.id ? ' selected' : ''}>${esc(e.nome)}${e.ativo === false ? ' (inativa)' : ''}</option>`).join('')
      : '<option>Nenhuma empresa</option>';
    $('#selEmpresa').disabled = st.empresas.length < 2;
    const podeEquipe = st.empresa && (st.admin || st.empresa.papel === 'dono');
    $('[data-aba="equipe"]').hidden = !podeEquipe;
    $('[data-aba="admin"]').hidden = !st.admin;
    $('[data-aba="clientes"]').hidden = !st.empresa;
    if ((st.aba === 'equipe' && !podeEquipe) || (st.aba === 'admin' && !st.admin) || (st.aba === 'clientes' && !st.empresa)) st.aba = 'inicio';
    const aviso = params.get('aviso');
    if (aviso) { toast(aviso, 5500); history.replaceState(null, '', location.pathname); }
    irAba(st.aba);
  }

  $('#selEmpresa').addEventListener('change', e => {
    st.empresa = st.empresas.find(x => x.id === e.target.value); P.definirEmpresa(st.empresa.id);
    entrarApp(st.user).catch(erro);
  });
  $('#abas').addEventListener('click', e => { const b = e.target.closest('[data-aba]'); if (b) irAba(b.dataset.aba); });

  function irAba(aba) {
    st.aba = aba;
    $$('#abas [data-aba]').forEach(b => b.classList.toggle('on', b.dataset.aba === aba));
    ({ inicio: abaInicio, clientes: abaClientes, equipe: abaEquipe, admin: abaAdmin }[aba] || abaInicio)().catch(erro);
    window.scrollTo({ top: 0 });
  }
  const cont = () => $('#conteudo');

  /* ---------------- início ---------------- */
  async function abaInicio() {
    const nome = (st.perfil && st.perfil.nome) || (st.user.email || '').split('@')[0];
    if (!st.empresa) {
      cont().innerHTML = `<div class="titulo"><div><h2>Olá, ${esc(nome)}!</h2></div></div>
        <div class="card vazio">${st.admin
          ? 'Nenhuma empresa cadastrada ainda. Crie a primeira em <b>Administração</b>.'
          : `Sua conta (<b>${esc(st.user.email)}</b>) ainda não foi liberada.<br>Peça ao responsável pela empresa para adicionar este e-mail na equipe.`}
          <div class="acoes" style="justify-content:center;margin-top:14px">${st.admin ? '<button class="btn" data-ir-aba="admin">Ir para Administração</button>' : ''}<button class="btn" id="btnSairVazio">Sair</button></div></div>`;
      $('#btnSairVazio').onclick = () => P.sair();
      return;
    }
    const mods = st.catalogo.filter(m => st.empresa.modulos.includes(m.codigo));
    cont().innerHTML = `<div class="titulo"><div><h2>Olá, ${esc(nome)}!</h2><p>${esc(st.empresa.nome)} · ${PAPEIS[st.empresa.papel] || ''}</p></div></div>
      ${st.empresa.ativo === false ? '<div class="aviso">Esta empresa está inativa. Só o administrador consegue acessar.</div>' : ''}
      ${mods.length ? `<div class="grade">${mods.map(cardModulo).join('')}</div>`
        : `<div class="card vazio">Nenhum sistema liberado para esta empresa ainda.${st.admin ? '<br>Libere os sistemas em <b>Administração</b>.' : ''}</div>`}`;
  }
  function cardModulo(m) {
    const ico = ICONES[m.icone] || '🧩';
    const corpo = `<span class="ico">${ico}</span><b>${esc(m.nome)}</b><small>${esc(m.descricao || '')}</small>`;
    if (m.codigo === 'clientes') return `<button class="modulo" data-ir-aba="clientes">${corpo}</button>`;
    if (APPS[m.codigo]) return `<a class="modulo" href="${APPS[m.codigo]}?empresa=${st.empresa.id}">${corpo}</a>`;
    return `<div class="modulo breve">${corpo}<small><i>Em breve</i></small></div>`;
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-ir-aba]'); if (b) irAba(b.dataset.irAba); });

  /* ---------------- clientes ---------------- */
  async function abaClientes() {
    cont().innerHTML = '<div class="vazio">Carregando clientes…</div>';
    st.clientes = await db.from('core_clientes').select('*').eq('empresa_id', st.empresa.id).order('nome').then(ok);
    cont().innerHTML = `<div class="titulo"><div><h2>Clientes</h2><p>Cadastro único, usado por todos os sistemas da ${esc(st.empresa.nome)}.</p></div>
        <button class="btn sm" id="novoCli" style="background:var(--orange);color:#fff;border-color:var(--orange)">+ Novo cliente</button></div>
      <input class="busca" id="buscaCli" placeholder="🔎 Buscar por nome, telefone, cidade…">
      <div class="lista" id="listaCli"></div>`;
    $('#novoCli').onclick = () => formCliente();
    $('#buscaCli').oninput = listarClientes;
    listarClientes();
  }
  function listarClientes() {
    const q = ($('#buscaCli').value || '').toLowerCase().trim();
    const l = st.clientes.filter(c => !q || [c.nome, c.telefone, c.cidade, c.documento, c.email].join(' ').toLowerCase().includes(q));
    $('#listaCli').innerHTML = l.map(c => `<div class="linha"><div class="info"><b>${esc(c.nome)}</b>
        <small>${esc([c.telefone, c.cidade, c.documento].filter(Boolean).join(' · ') || '—')}</small></div>
        ${c.telefone ? `<a class="btn sm" href="${linkWhats(foneWa(c.telefone))}" target="${ehCelular()?'_blank':'ke-whatsapp'}" rel="noopener">WhatsApp</a>` : ''}
        <button class="btn sm" data-cli="${c.id}">Editar</button></div>`).join('')
      || `<div class="card vazio">${q ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</div>`;
    $$('[data-cli]').forEach(b => b.onclick = () => formCliente(st.clientes.find(c => c.id === b.dataset.cli)));
  }
  function primeiroFone(f){ const partes=String(f||'').split(/\s*(?:\/|,|;|\||\be\b|\bou\b)\s*/i).map(p=>p.replace(/\D/g,'')).filter(p=>p.length>=10); let d=partes[0]||''; if(d.length===10||d.length===11) d='55'+d; return (d.length===12||d.length===13)?d:''; }
  const foneWa = primeiroFone;
  const ehCelular = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && matchMedia('(pointer:coarse)').matches);
  const linkWhats = f => ehCelular() ? 'https://wa.me/' + f : 'https://web.whatsapp.com/send?phone=' + f;
  function formCliente(c = {}) {
    modal(`<h3>${c.id ? 'Editar cliente' : 'Novo cliente'}</h3>
      <form id="fCli" class="form-grid">
        <label class="full">Nome<input name="nome" required value="${esc(c.nome)}"></label>
        <label>Telefone / WhatsApp<input name="telefone" inputmode="tel" value="${esc(c.telefone)}"></label>
        <label>CPF / CNPJ<input name="documento" value="${esc(c.documento)}"></label>
        <label>E-mail<input name="email" type="email" value="${esc(c.email)}"></label>
        <label>Cidade<input name="cidade" value="${esc(c.cidade)}"></label>
        <label class="full">Endereço<input name="endereco" value="${esc(c.endereco)}"></label>
        <label class="full">Observações<textarea name="observacoes">${esc(c.observacoes)}</textarea></label>
        <div class="acoes full">${c.id ? '<button type="button" class="btn perigo" id="delCli">Excluir</button>' : ''}
          <button type="button" class="btn" id="cancCli">Cancelar</button><button class="btn pri" style="width:auto">Salvar</button></div>
      </form>`);
    $('#cancCli').onclick = fecharModal;
    if (c.id) $('#delCli').onclick = async () => {
      if (!confirm(`Excluir o cliente ${c.nome}?`)) return;
      try { ok(await db.from('core_clientes').delete().eq('id', c.id)); fecharModal(); toast('Cliente excluído.'); abaClientes(); } catch (e) { erro(e); }
    };
    $('#fCli').onsubmit = async e => {
      e.preventDefault(); const f = dados(e.target);
      for (const k in f) f[k] = f[k].trim() || null;
      await ocupado(e.submitter, async () => {
        try {
          if (c.id) ok(await db.from('core_clientes').update(f).eq('id', c.id));
          else ok(await db.from('core_clientes').insert({ ...f, empresa_id: st.empresa.id, criado_por: st.user.id }));
          fecharModal(); toast('Cliente salvo.'); abaClientes();
        } catch (ex) { erro(ex); }
      });
    };
  }

  /* ---------------- equipe ---------------- */
  async function abaEquipe() {
    cont().innerHTML = '<div class="vazio">Carregando equipe…</div>';
    const membros = await P.rpc('core_membros_da_empresa', { p_empresa: st.empresa.id }) || [];
    cont().innerHTML = `<div class="titulo"><div><h2>Equipe</h2><p>Quem pode entrar nos sistemas da ${esc(st.empresa.nome)}.</p></div></div>
      <div class="card" style="margin-bottom:14px">
        <form id="fMembro" class="form-grid">
          <label>E-mail da pessoa<input name="email" type="email" required placeholder="pessoa@email.com"></label>
          <label>Papel<select name="papel"><option value="usuario">Usuário</option><option value="gerente">Gerente</option><option value="dono">Dono</option></select></label>
          <div class="acoes full"><button class="btn pri" style="width:auto">Adicionar à equipe</button></div>
        </form>
        <p class="sub" style="margin:8px 0 0;font-size:12.5px">A pessoa precisa criar a conta antes, tocando em <b>Criar conta</b> na tela de entrada.
          O que cada um faz na Carreta (gestor ou motorista) é definido dentro do sistema Carreta, em "Usuários".</p>
      </div>
      <div class="lista">${membros.map(m => `<div class="linha" data-u="${m.usuario_id}">
          <div class="info"><b>${esc(m.nome || m.email)}</b><small>${esc(m.email)}</small></div>
          ${m.usuario_id === st.user.id && !st.admin ? `<span class="tag">${PAPEIS[m.papel]} (você)</span>` : `
          <select data-papel aria-label="Papel">${['usuario', 'gerente', 'dono'].map(p => `<option value="${p}"${m.papel === p ? ' selected' : ''}>${PAPEIS[p]}</option>`).join('')}</select>
          <button class="btn sm perigo" data-remover>Remover</button>`}
        </div>`).join('') || '<div class="card vazio">Ninguém na equipe ainda.</div>'}</div>`;
    $('#fMembro').onsubmit = async e => {
      e.preventDefault(); const f = dados(e.target);
      await ocupado(e.submitter, async () => {
        try { await P.rpc('core_adicionar_membro', { p_empresa: st.empresa.id, p_email: f.email.trim(), p_papel: f.papel }); toast('Pessoa adicionada!'); abaEquipe(); }
        catch (ex) { erro(ex); }
      });
    };
    $$('[data-papel]').forEach(s => s.onchange = async () => {
      const u = s.closest('[data-u]').dataset.u;
      try { ok(await db.from('core_membros').update({ papel: s.value }).eq('empresa_id', st.empresa.id).eq('usuario_id', u)); toast('Papel atualizado.'); }
      catch (ex) { erro(ex); abaEquipe(); }
    });
    $$('[data-remover]').forEach(b => b.onclick = async () => {
      const linha = b.closest('[data-u]');
      if (!confirm(`Remover ${linha.querySelector('b').textContent} da equipe?`)) return;
      try { await P.rpc('core_remover_membro', { p_empresa: st.empresa.id, p_usuario: linha.dataset.u }); toast('Removido.'); abaEquipe(); }
      catch (ex) { erro(ex); }
    });
  }

  /* ---------------- administração ---------------- */
  async function abaAdmin() {
    const cat = st.catalogo;
    cont().innerHTML = `<div class="titulo"><div><h2>Administração</h2><p>Empresas atendidas pela plataforma e os sistemas de cada uma. Só você vê esta tela.</p></div>
        <button class="btn sm" id="novaEmp" style="background:var(--orange);color:#fff;border-color:var(--orange)">+ Nova empresa</button></div>
      ${st.empresas.map(e => `<div class="card empresa-adm" data-emp="${e.id}">
          <div class="cab"><b>${esc(e.nome)}</b>${e.ativo === false ? '<span class="tag off">inativa</span>' : ''}
            <button class="btn sm" data-editar>Editar</button><button class="btn sm" data-dono>+ Pessoa</button></div>
          <div class="chips">${cat.map(m => `<button class="chip${e.modulos.includes(m.codigo) ? ' on' : ''}" data-mod="${m.codigo}">${ICONES[m.icone] || '🧩'} ${esc(m.nome)}</button>`).join('')}</div>
        </div>`).join('') || '<div class="card vazio">Nenhuma empresa ainda.</div>'}`;
    $('#novaEmp').onclick = () => formEmpresa();
    $$('[data-emp]').forEach(card => {
      const emp = st.empresas.find(e => e.id === card.dataset.emp);
      card.querySelector('[data-editar]').onclick = () => formEmpresa(emp);
      card.querySelector('[data-dono]').onclick = () => formPessoa(emp);
      card.querySelectorAll('[data-mod]').forEach(b => b.onclick = async () => {
        const cod = b.dataset.mod, linha = st.modsAdmin.find(x => x.empresa_id === emp.id && x.modulo === cod);
        try {
          if (linha) ok(await db.from('core_empresa_modulos').update({ ativo: !linha.ativo }).eq('empresa_id', emp.id).eq('modulo', cod));
          else ok(await db.from('core_empresa_modulos').insert({ empresa_id: emp.id, modulo: cod }));
          await entrarApp(st.user);
        } catch (ex) { erro(ex); }
      });
    });
  }
  function formEmpresa(e = {}) {
    modal(`<h3>${e.id ? 'Editar empresa' : 'Nova empresa'}</h3>
      <form id="fEmp" class="form-grid">
        <label class="full">Nome<input name="nome" required value="${esc(e.nome)}"></label>
        <label>CNPJ / CPF<input name="documento" value="${esc(e.documento)}"></label>
        <label>Telefone<input name="telefone" value="${esc(e.telefone)}"></label>
        <label class="full">Cidade / UF<input name="cidade" value="${esc(e.cidade)}"></label>
        ${e.id ? `<label class="full" style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="ativo" style="width:20px;height:20px;margin:0" ${e.ativo !== false ? 'checked' : ''}> Empresa ativa</label>` : ''}
        <div class="acoes full"><button type="button" class="btn" id="cancEmp">Cancelar</button><button class="btn pri" style="width:auto">Salvar</button></div>
      </form>`);
    $('#cancEmp').onclick = fecharModal;
    $('#fEmp').onsubmit = async ev => {
      ev.preventDefault(); const f = dados(ev.target);
      const row = { nome: f.nome.trim(), documento: f.documento.trim() || null, telefone: f.telefone.trim() || null, cidade: f.cidade.trim() || null };
      if (e.id) row.ativo = !!f.ativo;
      await ocupado(ev.submitter, async () => {
        try {
          if (e.id) ok(await db.from('core_empresas').update(row).eq('id', e.id));
          else { const n = ok(await db.from('core_empresas').insert(row).select('id').single()); P.definirEmpresa(n.id); }
          fecharModal(); toast('Empresa salva.'); await entrarApp(st.user);
        } catch (ex) { erro(ex); }
      });
    };
  }
  function formPessoa(emp) {
    modal(`<h3>Adicionar pessoa — ${esc(emp.nome)}</h3>
      <form id="fPes" class="form-grid">
        <label>E-mail<input name="email" type="email" required></label>
        <label>Papel<select name="papel"><option value="dono">Dono</option><option value="gerente">Gerente</option><option value="usuario">Usuário</option></select></label>
        <p class="sub full" style="font-size:12.5px">A pessoa precisa ter criado a conta antes (tela de entrada → Criar conta).</p>
        <div class="acoes full"><button type="button" class="btn" id="cancPes">Cancelar</button><button class="btn pri" style="width:auto">Adicionar</button></div>
      </form>`);
    $('#cancPes').onclick = fecharModal;
    $('#fPes').onsubmit = async ev => {
      ev.preventDefault(); const f = dados(ev.target);
      await ocupado(ev.submitter, async () => {
        try { await P.rpc('core_adicionar_membro', { p_empresa: emp.id, p_email: f.email.trim(), p_papel: f.papel }); fecharModal(); toast('Pessoa adicionada.'); await entrarApp(st.user); }
        catch (ex) { erro(ex); }
      });
    };
  }

  /* ---------------- minha conta ---------------- */
  $('#btnPerfil').addEventListener('click', () => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    modal(`<h3>Minha conta</h3>
      <form id="fPerfil" class="form-grid">
        <label class="full">Nome<input name="nome" value="${esc(st.perfil && st.perfil.nome)}"></label>
        <label class="full">E-mail<input value="${esc(st.user.email)}" disabled></label>
        <label class="full">Nova senha <em>(deixe vazio para não trocar)</em><input name="senha" type="password" minlength="6" autocomplete="new-password"></label>
        <div class="acoes full"><button type="button" class="btn perigo" id="btnSair">Sair</button><button type="button" class="btn" id="cancPerfil">Fechar</button><button class="btn pri" style="width:auto">Salvar</button></div>
      </form>
      ${instalar ? '<button class="btn" id="btnInstalar" style="width:100%;margin-top:12px">📲 Instalar aplicativo no aparelho</button>' : ''}
      ${ios ? '<p class="sub" style="margin-top:12px;font-size:13px">📲 Para instalar no iPhone: toque em <b>Compartilhar</b> (quadrado com seta) → <b>Adicionar à Tela de Início</b>.</p>' : ''}`);
    $('#cancPerfil').onclick = fecharModal;
    $('#btnSair').onclick = () => P.sair();
    if (instalar) $('#btnInstalar').onclick = async () => { instalar.prompt(); await instalar.userChoice; instalar = null; fecharModal(); };
    $('#fPerfil').onsubmit = async ev => {
      ev.preventDefault(); const f = dados(ev.target);
      await ocupado(ev.submitter, async () => {
        try {
          ok(await db.from('core_perfis').update({ nome: f.nome.trim() || null }).eq('id', st.user.id));
          if (f.senha) { const { error } = await db.auth.updateUser({ password: f.senha }); if (error) throw error; }
          fecharModal(); toast('Dados salvos.'); await entrarApp(st.user);
        } catch (ex) { erro(ex); }
      });
    };
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); instalar = e; });

  /* ---------------- início ---------------- */
  (async () => {
    try {
      $('#nomePlataforma').textContent = P.cfg.nome || 'Plataforma KE';
      document.title = P.cfg.nome || 'Plataforma KE';
      if (/type=recovery/.test(location.hash)) return mostrarEntrada('nova-senha');
      const u = await P.usuario();
      if (!u) return mostrarEntrada('login', new URL(location.href).searchParams.get('voltar') ? 'Entre para continuar.' : '');
      await entrarApp(u);
    } catch (e) { mostrarEntrada('login', traduz(e.message)); console.error(e); }
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(console.warn);
  })();
})();
