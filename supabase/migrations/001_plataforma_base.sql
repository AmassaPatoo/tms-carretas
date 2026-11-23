-- =====================================================================
--  PLATAFORMA KE — BASE (núcleo + módulo Orçamentos)
--  Rodar no Supabase: Dashboard → SQL Editor → colar tudo → Run
--
--  Seguro para rodar no projeto que já tem a carreta:
--   • só CRIA tabelas novas (prefixos core_ e orc_), não apaga nem altera
--     nenhuma tabela existente;
--   • pode ser rodado de novo sem erro (IF NOT EXISTS / OR REPLACE).
--
--  Organização dos nomes:
--   core_*  → núcleo, usado por todos os sistemas (empresas, usuários,
--             módulos, clientes)
--   orc_*   → módulo Orçamentos
--   car_*   → módulo Carreta (as tabelas atuais serão renomeadas/ligadas
--             a este padrão numa próxima migração, depois de analisadas)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. NÚCLEO
-- ---------------------------------------------------------------------

-- Empresas atendidas pela plataforma (cada cliente seu = 1 empresa)
create table if not exists public.core_empresas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  documento     text,                       -- CNPJ / CPF
  telefone      text,
  cidade        text,
  logo_url      text,
  config        jsonb not null default '{}'::jsonb,   -- Pix, assinatura, etc.
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Perfil de cada usuário (1:1 com auth.users)
create table if not exists public.core_perfis (
  id                   uuid primary key references auth.users(id) on delete cascade,
  nome                 text,
  telefone             text,
  is_admin_plataforma  boolean not null default false,   -- você
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);

-- Quem pertence a qual empresa, e com qual papel
create table if not exists public.core_membros (
  empresa_id  uuid not null references public.core_empresas(id) on delete cascade,
  usuario_id  uuid not null references auth.users(id) on delete cascade,
  papel       text not null default 'usuario' check (papel in ('dono','gerente','usuario')),
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);
create index if not exists core_membros_usuario_idx on public.core_membros(usuario_id);

-- Catálogo de módulos (sistemas) da plataforma
create table if not exists public.core_modulos (
  codigo     text primary key,              -- 'orcamentos', 'carreta', ...
  nome       text not null,
  descricao  text,
  icone      text,
  ordem      int  not null default 100,
  ativo      boolean not null default true
);

-- Quais módulos cada empresa pode usar (+ configurações do módulo)
create table if not exists public.core_empresa_modulos (
  empresa_id  uuid not null references public.core_empresas(id) on delete cascade,
  modulo      text not null references public.core_modulos(codigo) on update cascade,
  ativo       boolean not null default true,
  config      jsonb not null default '{}'::jsonb,   -- ex.: tabela de preços, textos padrão
  liberado_em timestamptz not null default now(),
  primary key (empresa_id, modulo)
);

-- Cadastro de clientes compartilhado por todos os módulos da empresa
create table if not exists public.core_clientes (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  nome          text not null,
  documento     text,
  telefone      text,
  email         text,
  endereco      text,
  cidade        text,
  observacoes   text,
  criado_por    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists core_clientes_empresa_idx on public.core_clientes(empresa_id, nome);

-- ---------------------------------------------------------------------
-- 2. MÓDULO ORÇAMENTOS
-- ---------------------------------------------------------------------

create table if not exists public.orc_orcamentos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  numero        int  not null,
  cliente_id    uuid references public.core_clientes(id) on delete set null,
  cliente_nome  text,                       -- cópia para listagem/busca rápida
  local         text,
  data          date not null default current_date,
  status        text not null default 'rascunho'
                check (status in ('rascunho','enviado','aprovado','recusado','executado')),
  total         numeric(12,2) not null default 0,
  dados         jsonb not null default '{}'::jsonb,   -- serviços, medidas, condições, assinatura…
  criado_por    uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists orc_orcamentos_lista_idx on public.orc_orcamentos(empresa_id, atualizado_em desc);
create index if not exists orc_orcamentos_status_idx on public.orc_orcamentos(empresa_id, status, data);

-- Fotos ficam no Storage (bucket 'orcamentos'); aqui só os dados de cada uma
create table if not exists public.orc_fotos (
  id            uuid primary key default gen_random_uuid(),
  orcamento_id  uuid not null references public.orc_orcamentos(id) on delete cascade,
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  caminho       text not null,              -- {empresa_id}/{orcamento_id}/{arquivo}.jpg
  legenda       text,
  grupo         text check (grupo in ('antes','depois') or grupo is null),
  ordem         int not null default 0,
  largura       int,
  altura        int,
  criado_em     timestamptz not null default now()
);
create index if not exists orc_fotos_orc_idx on public.orc_fotos(orcamento_id, ordem);

-- ---------------------------------------------------------------------
-- 3. FUNÇÕES DE APOIO (usadas pelas regras de acesso)
-- ---------------------------------------------------------------------

create or replace function public.core_e_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin_plataforma from public.core_perfis where id = auth.uid()), false)
$$;

create or replace function public.core_e_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.core_membros m
                 join public.core_empresas e on e.id = m.empresa_id and e.ativo
                 where m.empresa_id = p_empresa and m.usuario_id = auth.uid())
$$;

create or replace function public.core_papel(p_empresa uuid)
returns text language sql stable security definer set search_path = public as $$
  select papel from public.core_membros where empresa_id = p_empresa and usuario_id = auth.uid()
$$;

create or replace function public.core_modulo_liberado(p_empresa uuid, p_modulo text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.core_e_membro(p_empresa) and exists (
    select 1 from public.core_empresa_modulos em
    join public.core_modulos mo on mo.codigo = em.modulo and mo.ativo
    where em.empresa_id = p_empresa and em.modulo = p_modulo and em.ativo)
$$;

-- Próximo número de orçamento da empresa
create or replace function public.orc_proximo_numero(p_empresa uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when public.core_e_membro(p_empresa) or public.core_e_admin()
              then coalesce(max(numero), 0) + 1 end
  from public.orc_orcamentos where empresa_id = p_empresa
$$;

-- Empresas e módulos do usuário logado (para montar o menu do app)
create or replace function public.core_meus_acessos()
returns table (empresa_id uuid, empresa_nome text, papel text, modulos text[])
language sql stable security definer set search_path = public as $$
  select e.id, e.nome, m.papel,
         coalesce(array_agg(em.modulo order by mo.ordem) filter (where em.modulo is not null), '{}')
  from public.core_membros m
  join public.core_empresas e on e.id = m.empresa_id and e.ativo
  left join public.core_empresa_modulos em on em.empresa_id = e.id and em.ativo
  left join public.core_modulos mo on mo.codigo = em.modulo and mo.ativo
  where m.usuario_id = auth.uid()
  group by e.id, e.nome, m.papel
  order by e.nome
$$;

-- atualizado_em automático
create or replace function public.core_toca_atualizado()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['core_empresas','core_perfis','core_clientes','orc_orcamentos'] loop
    execute format('drop trigger if exists %I_atualizado on public.%I', t, t);
    execute format('create trigger %I_atualizado before update on public.%I
                    for each row execute function public.core_toca_atualizado()', t, t);
  end loop;
end $$;

-- Cria o perfil quando um usuário se cadastra
create or replace function public.core_ao_criar_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.core_perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists core_ao_criar_usuario on auth.users;
create trigger core_ao_criar_usuario after insert on auth.users
  for each row execute function public.core_ao_criar_usuario();

-- Perfis para usuários que já existiam antes desta migração
insert into public.core_perfis (id, nome)
select u.id, coalesce(u.raw_user_meta_data->>'nome', split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- Ninguém se promove a administrador sozinho
create or replace function public.core_protege_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_admin_plataforma is distinct from old.is_admin_plataforma
     and auth.uid() is not null and not public.core_e_admin() then
    raise exception 'Somente o administrador da plataforma pode alterar este campo';
  end if;
  return new;
end $$;
drop trigger if exists core_perfis_protege_admin on public.core_perfis;
create trigger core_perfis_protege_admin before update on public.core_perfis
  for each row execute function public.core_protege_admin();

-- Foto sempre na mesma empresa do orçamento
create or replace function public.orc_fotos_confere_empresa()
returns trigger language plpgsql as $$
begin
  if new.empresa_id is distinct from (select empresa_id from public.orc_orcamentos where id = new.orcamento_id) then
    raise exception 'Foto e orçamento precisam ser da mesma empresa';
  end if;
  return new;
end $$;
drop trigger if exists orc_fotos_confere_empresa on public.orc_fotos;
create trigger orc_fotos_confere_empresa before insert or update on public.orc_fotos
  for each row execute function public.orc_fotos_confere_empresa();

-- ---------------------------------------------------------------------
-- 4. REGRAS DE ACESSO (RLS) — cada empresa só enxerga os próprios dados
-- ---------------------------------------------------------------------

alter table public.core_empresas         enable row level security;
alter table public.core_perfis           enable row level security;
alter table public.core_membros          enable row level security;
alter table public.core_modulos          enable row level security;
alter table public.core_empresa_modulos  enable row level security;
alter table public.core_clientes         enable row level security;
alter table public.orc_orcamentos        enable row level security;
alter table public.orc_fotos             enable row level security;

-- apaga versões antigas das políticas para poder rodar de novo
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and (tablename like 'core\_%' or tablename like 'orc\_%') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- core_empresas
create policy "empresas: ver as minhas"     on public.core_empresas for select to authenticated
  using (public.core_e_membro(id) or public.core_e_admin());
create policy "empresas: admin cria"        on public.core_empresas for insert to authenticated
  with check (public.core_e_admin());
create policy "empresas: dono ou admin edita" on public.core_empresas for update to authenticated
  using (public.core_e_admin() or public.core_papel(id) = 'dono')
  with check (public.core_e_admin() or public.core_papel(id) = 'dono');
create policy "empresas: admin apaga"       on public.core_empresas for delete to authenticated
  using (public.core_e_admin());

-- core_perfis
create policy "perfis: ver o meu e da equipe" on public.core_perfis for select to authenticated
  using (id = auth.uid() or public.core_e_admin() or exists (
    select 1 from public.core_membros a join public.core_membros b on a.empresa_id = b.empresa_id
    where a.usuario_id = auth.uid() and b.usuario_id = core_perfis.id));
create policy "perfis: editar o meu"        on public.core_perfis for update to authenticated
  using (id = auth.uid() or public.core_e_admin())
  with check (id = auth.uid() or public.core_e_admin());

-- core_membros
create policy "membros: ver da minha empresa" on public.core_membros for select to authenticated
  using (public.core_e_membro(empresa_id) or public.core_e_admin());
create policy "membros: dono ou admin gerencia" on public.core_membros for all to authenticated
  using (public.core_e_admin() or public.core_papel(empresa_id) = 'dono')
  with check (public.core_e_admin() or public.core_papel(empresa_id) = 'dono');

-- core_modulos
create policy "modulos: todos veem"   on public.core_modulos for select to authenticated using (true);
create policy "modulos: admin gerencia" on public.core_modulos for all to authenticated
  using (public.core_e_admin()) with check (public.core_e_admin());

-- core_empresa_modulos
create policy "empresa_modulos: ver os meus" on public.core_empresa_modulos for select to authenticated
  using (public.core_e_membro(empresa_id) or public.core_e_admin());
create policy "empresa_modulos: admin libera" on public.core_empresa_modulos for all to authenticated
  using (public.core_e_admin()) with check (public.core_e_admin());
create policy "empresa_modulos: dono ajusta config" on public.core_empresa_modulos for update to authenticated
  using (public.core_papel(empresa_id) in ('dono','gerente'))
  with check (public.core_papel(empresa_id) in ('dono','gerente'));

-- core_clientes
create policy "clientes: equipe usa" on public.core_clientes for all to authenticated
  using (public.core_e_membro(empresa_id) or public.core_e_admin())
  with check (public.core_e_membro(empresa_id) or public.core_e_admin());

-- orc_orcamentos (exige o módulo liberado para a empresa)
create policy "orcamentos: equipe usa" on public.orc_orcamentos for all to authenticated
  using (public.core_modulo_liberado(empresa_id, 'orcamentos') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'orcamentos') or public.core_e_admin());

-- orc_fotos
create policy "fotos: equipe usa" on public.orc_fotos for all to authenticated
  using (public.core_modulo_liberado(empresa_id, 'orcamentos') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'orcamentos') or public.core_e_admin());

-- Permissões de tabela: só usuários logados (o RLS acima filtra as linhas)
revoke all on public.core_empresas, public.core_perfis, public.core_membros, public.core_modulos,
              public.core_empresa_modulos, public.core_clientes, public.orc_orcamentos, public.orc_fotos
  from anon;
grant select, insert, update, delete on public.core_empresas, public.core_perfis, public.core_membros,
              public.core_modulos, public.core_empresa_modulos, public.core_clientes,
              public.orc_orcamentos, public.orc_fotos
  to authenticated;
revoke execute on function public.core_e_admin(), public.core_e_membro(uuid), public.core_papel(uuid),
              public.core_modulo_liberado(uuid,text), public.orc_proximo_numero(uuid),
              public.core_meus_acessos()
  from anon, public;
grant execute on function public.core_e_admin(), public.core_e_membro(uuid), public.core_papel(uuid),
              public.core_modulo_liberado(uuid,text), public.orc_proximo_numero(uuid),
              public.core_meus_acessos()
  to authenticated;

-- ---------------------------------------------------------------------
-- 5. STORAGE: bucket privado para as fotos dos orçamentos
--    caminho dos arquivos: {empresa_id}/{orcamento_id}/{arquivo}
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('orcamentos', 'orcamentos', false)
on conflict (id) do nothing;

drop policy if exists "orcamentos: ler fotos da empresa"   on storage.objects;
drop policy if exists "orcamentos: enviar fotos da empresa" on storage.objects;
drop policy if exists "orcamentos: alterar fotos da empresa" on storage.objects;
drop policy if exists "orcamentos: apagar fotos da empresa" on storage.objects;

create policy "orcamentos: ler fotos da empresa" on storage.objects for select to authenticated
  using (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'orcamentos')));
create policy "orcamentos: enviar fotos da empresa" on storage.objects for insert to authenticated
  with check (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'orcamentos')));
create policy "orcamentos: alterar fotos da empresa" on storage.objects for update to authenticated
  using (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'orcamentos')));
create policy "orcamentos: apagar fotos da empresa" on storage.objects for delete to authenticated
  using (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'orcamentos')));

-- ---------------------------------------------------------------------
-- 6. MÓDULOS INICIAIS
-- ---------------------------------------------------------------------

insert into public.core_modulos (codigo, nome, descricao, icone, ordem) values
  ('clientes',   'Clientes',   'Cadastro de clientes compartilhado entre os sistemas', 'users', 10),
  ('orcamentos', 'Orçamentos', 'Orçamentos de piso, ripado, rodapé e outros serviços', 'file-text', 20),
  ('carreta',    'Carreta',    'Sistema de carretas',                                  'truck', 30)
on conflict (codigo) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, ordem = excluded.ordem;

-- =====================================================================
--  DEPOIS DE RODAR: torne-se administrador (troque pelo SEU e-mail de login)
--
--  update public.core_perfis set is_admin_plataforma = true
--  where id = (select id from auth.users where email = 'seu@email.com');
-- =====================================================================
