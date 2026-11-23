-- =====================================================================
--  PLATAFORMA KE — 005: MÓDULO COTAÇÕES (pesquisa de preços no mercado)
--  Rodar DEPOIS da 004, no SQL Editor do Supabase (colar tudo → Run).
--
--  • Itens e lojas cadastrados pela empresa
--  • Preços lançados à mão (telefone, balcão, site, WhatsApp)
--  • Pedidos de cotação: cada loja recebe um link e preenche os preços
--    sem precisar de login (cotar/?c=CODIGO)
--  Depois de rodar: em Administração, ligue o módulo "Cotações" na empresa.
-- =====================================================================

begin;

-- código do link (16 letras/números, mesmo gerador dos orçamentos)
create or replace function public.cot_novo_token()
returns text language sql volatile security definer set search_path = public as $$
  select public.orc_codigo_curto()
$$;
revoke all on function public.cot_novo_token() from public, anon;
grant execute on function public.cot_novo_token() to authenticated;

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------
create table if not exists public.cot_itens (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.core_empresas(id) on delete cascade,
  nome       text not null check (length(btrim(nome)) between 1 and 160),
  unidade    text not null default 'un' check (length(unidade) <= 20),
  categoria  text check (length(categoria) <= 60),
  obs        text check (length(obs) <= 500),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
create index if not exists cot_itens_emp_idx on public.cot_itens(empresa_id);

create table if not exists public.cot_lojas (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.core_empresas(id) on delete cascade,
  nome       text not null check (length(btrim(nome)) between 1 and 120),
  telefone   text check (length(telefone) <= 60),
  bairro     text check (length(bairro) <= 80),
  contato    text check (length(contato) <= 80),
  obs        text check (length(obs) <= 500),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
create index if not exists cot_lojas_emp_idx on public.cot_lojas(empresa_id);

create table if not exists public.cot_cotacoes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.core_empresas(id) on delete cascade,
  titulo     text not null check (length(btrim(titulo)) between 1 and 120),
  prazo      date,
  status     text not null default 'aberta' check (status in ('aberta','encerrada')),
  obs        text check (length(obs) <= 500),
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index if not exists cot_cotacoes_emp_idx on public.cot_cotacoes(empresa_id, criado_em desc);

create table if not exists public.cot_cotacao_itens (
  cotacao_id uuid not null references public.cot_cotacoes(id) on delete cascade,
  item_id    uuid not null references public.cot_itens(id) on delete cascade,
  empresa_id uuid not null references public.core_empresas(id) on delete cascade,
  qtd        numeric(12,2) check (qtd is null or qtd > 0),
  primary key (cotacao_id, item_id)
);

create table if not exists public.cot_pedidos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  cotacao_id    uuid not null references public.cot_cotacoes(id) on delete cascade,
  loja_id       uuid not null references public.cot_lojas(id) on delete cascade,
  token         text not null unique default public.cot_novo_token(),
  criado_em     timestamptz not null default now(),
  visto_em      timestamptz,
  respondido_em timestamptz,
  respondente   text check (length(respondente) <= 120),
  obs           text check (length(obs) <= 1000),
  unique (cotacao_id, loja_id)
);
create index if not exists cot_pedidos_emp_idx on public.cot_pedidos(empresa_id);

create table if not exists public.cot_precos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.core_empresas(id) on delete cascade,
  item_id     uuid not null references public.cot_itens(id) on delete cascade,
  loja_id     uuid not null references public.cot_lojas(id) on delete cascade,
  preco       numeric(12,2) check (preco is null or (preco >= 0 and preco < 10000000)),
  disponivel  boolean not null default true,
  data        date not null default current_date,
  fonte       text not null default 'manual'
              check (fonte in ('manual','link','telefone','balcao','site','whatsapp','nota')),
  pedido_id   uuid references public.cot_pedidos(id) on delete set null,
  obs         text check (length(obs) <= 300),
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid(),
  check (preco is not null or not disponivel)
);
create index if not exists cot_precos_emp_idx on public.cot_precos(empresa_id, data desc);
create index if not exists cot_precos_item_idx on public.cot_precos(item_id, loja_id, data desc);
create index if not exists cot_precos_pedido_idx on public.cot_precos(pedido_id);

-- ---------------------------------------------------------------------
-- 2. TUDO DA MESMA EMPRESA (item, loja, cotação e pedido)
-- ---------------------------------------------------------------------
create or replace function public.cot_confere_empresa()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- (cada tabela tem colunas diferentes: os testes ficam em blocos separados)
  if tg_table_name = 'cot_precos' then
    if new.empresa_id is distinct from (select empresa_id from public.cot_itens where id = new.item_id) then raise exception 'Item de outra empresa'; end if;
    if new.empresa_id is distinct from (select empresa_id from public.cot_lojas where id = new.loja_id) then raise exception 'Loja de outra empresa'; end if;
    if new.pedido_id is not null then
      if new.empresa_id is distinct from (select empresa_id from public.cot_pedidos where id = new.pedido_id) then raise exception 'Pedido de outra empresa'; end if;
    end if;
  elsif tg_table_name = 'cot_cotacao_itens' then
    if new.empresa_id is distinct from (select empresa_id from public.cot_itens where id = new.item_id) then raise exception 'Item de outra empresa'; end if;
    if new.empresa_id is distinct from (select empresa_id from public.cot_cotacoes where id = new.cotacao_id) then raise exception 'Cotação de outra empresa'; end if;
  elsif tg_table_name = 'cot_pedidos' then
    if new.empresa_id is distinct from (select empresa_id from public.cot_lojas where id = new.loja_id) then raise exception 'Loja de outra empresa'; end if;
    if new.empresa_id is distinct from (select empresa_id from public.cot_cotacoes where id = new.cotacao_id) then raise exception 'Cotação de outra empresa'; end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['cot_precos','cot_cotacao_itens','cot_pedidos'] loop
    execute format('drop trigger if exists %I_empresa on public.%I', t, t);
    execute format('create trigger %I_empresa before insert or update on public.%I
                    for each row execute function public.cot_confere_empresa()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. SEGURANÇA (RLS): só a equipe da empresa com o módulo liberado
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cot_itens','cot_lojas','cot_cotacoes','cot_cotacao_itens','cot_pedidos','cot_precos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "cotacoes: equipe usa" on public.%I', t);
    execute format('create policy "cotacoes: equipe usa" on public.%I for all to authenticated
                    using (public.core_modulo_liberado(empresa_id, ''cotacoes'') or public.core_e_admin())
                    with check (public.core_modulo_liberado(empresa_id, ''cotacoes'') or public.core_e_admin())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. PÁGINA PÚBLICA DA LOJA (sem login, só com o código do link)
-- ---------------------------------------------------------------------
create or replace function public.cot_publico_ver(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare p public.cot_pedidos%rowtype; c public.cot_cotacoes%rowtype; e public.core_empresas%rowtype; l public.cot_lojas%rowtype;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into p from public.cot_pedidos where token = p_token;
  if not found then return null; end if;
  select * into c from public.cot_cotacoes where id = p.cotacao_id;
  select * into e from public.core_empresas where id = p.empresa_id and ativo;
  if not found then return null; end if;
  select * into l from public.cot_lojas where id = p.loja_id;
  if p.visto_em is null then update public.cot_pedidos set visto_em = now() where id = p.id; end if;
  return jsonb_build_object(
    'titulo', c.titulo, 'prazo', c.prazo, 'obs_cotacao', c.obs,
    'aberta', c.status = 'aberta' and (c.prazo is null or c.prazo >= current_date),
    'loja', l.nome, 'respondido_em', p.respondido_em, 'respondente', p.respondente, 'obs', p.obs,
    'empresa', jsonb_build_object('nome', e.nome, 'telefone', e.telefone, 'cidade', e.cidade, 'logo', e.config->>'logo'),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'nome', i.nome, 'unidade', i.unidade, 'obs_item', i.obs, 'qtd', ci.qtd,
               'preco', pr.preco, 'disponivel', pr.disponivel, 'obs', pr.obs) order by i.nome)
      from public.cot_cotacao_itens ci
      join public.cot_itens i on i.id = ci.item_id
      left join public.cot_precos pr on pr.pedido_id = p.id and pr.item_id = i.id
      where ci.cotacao_id = c.id), '[]'::jsonb));
end $$;

create or replace function public.cot_publico_responder(p_token text, p_nome text, p_respostas jsonb, p_obs text)
returns int language plpgsql security definer set search_path = public as $$
declare p public.cot_pedidos%rowtype; c public.cot_cotacoes%rowtype; r jsonb; v_item uuid; v_preco numeric; v_disp boolean; n int := 0;
begin
  select * into p from public.cot_pedidos where token = p_token and p_token is not null and length(p_token) >= 16 for update;
  if not found then raise exception 'Link inválido ou cancelado. Peça um novo link para a empresa.'; end if;
  select * into c from public.cot_cotacoes where id = p.cotacao_id;
  if c.status <> 'aberta' then raise exception 'Esta cotação já foi encerrada pela empresa.'; end if;
  if c.prazo is not null and c.prazo < current_date then raise exception 'O prazo desta cotação terminou.'; end if;
  if length(btrim(coalesce(p_nome,''))) < 2 then raise exception 'Digite o seu nome.'; end if;
  if jsonb_typeof(p_respostas) <> 'array' or jsonb_array_length(p_respostas) > 500 then raise exception 'Respostas inválidas.'; end if;

  delete from public.cot_precos where pedido_id = p.id;
  for r in select * from jsonb_array_elements(p_respostas) loop
    begin v_item := (r->>'item_id')::uuid; exception when others then continue; end;
    if not exists (select 1 from public.cot_cotacao_itens where cotacao_id = c.id and item_id = v_item) then continue; end if;
    v_disp := coalesce((r->>'disponivel')::boolean, true);
    v_preco := null;
    if v_disp then
      begin v_preco := round((r->>'preco')::numeric, 2); exception when others then v_preco := null; end;
      if v_preco is null or v_preco < 0 or v_preco >= 10000000 then continue; end if;
    end if;
    insert into public.cot_precos (empresa_id, item_id, loja_id, preco, disponivel, data, fonte, pedido_id, obs, criado_por)
    values (p.empresa_id, v_item, p.loja_id, v_preco, v_disp, current_date, 'link', p.id, left(nullif(btrim(r->>'obs'),''), 300), null);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Preencha o preço de pelo menos um item (ou marque "não tenho").'; end if;

  update public.cot_pedidos
     set respondido_em = now(), respondente = left(btrim(p_nome), 120), obs = left(nullif(btrim(coalesce(p_obs,'')),''), 1000)
   where id = p.id;
  return n;
end $$;

revoke all on function public.cot_publico_ver(text), public.cot_publico_responder(text,text,jsonb,text) from public;
grant execute on function public.cot_publico_ver(text), public.cot_publico_responder(text,text,jsonb,text) to anon, authenticated;
revoke all on function public.cot_confere_empresa() from public, anon;

-- ---------------------------------------------------------------------
-- 5. MÓDULO NO CATÁLOGO DA PLATAFORMA
-- ---------------------------------------------------------------------
insert into public.core_modulos (codigo, nome, descricao, icone, ordem) values
  ('cotacoes', 'Cotações', 'Pesquisa e comparação de preços de materiais nas lojas', 'tag', 40)
on conflict (codigo) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, ordem = excluded.ordem;

commit;
