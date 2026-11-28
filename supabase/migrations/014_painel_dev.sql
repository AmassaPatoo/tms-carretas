-- =====================================================================
--  PLATAFORMA KE — 014: PAINEL DEV
--  Rodar DEPOIS da 013, no SQL Editor do Supabase (colar tudo → Run).
--  Pode ser rodado de novo sem erro. Não altera nem apaga dados existentes.
--
--  • core_config: nome da plataforma, editável no Painel Dev (…/dev/).
--  • dev_empresa_opcoes: opções que SÓ o administrador muda, por empresa.
--      loja_integra_orcamentos → os pedidos de orçamento do site viram
--      orçamento no módulo Orçamentos. Desligado = caixa de entrada simples.
--  • dev_resumo(): números de cada empresa para o Painel Dev.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. NOME DA PLATAFORMA (uma linha só)
-- ---------------------------------------------------------------------
create table if not exists public.core_config (
  id               boolean primary key default true check (id),
  nome_plataforma  text not null default 'Plataforma KE'
                   check (length(btrim(nome_plataforma)) between 1 and 60),
  atualizado_em    timestamptz not null default now()
);
insert into public.core_config (id) values (true) on conflict (id) do nothing;

alter table public.core_config enable row level security;
drop policy if exists "config: todos leem" on public.core_config;
create policy "config: todos leem" on public.core_config for select to anon, authenticated using (true);
drop policy if exists "config: admin altera" on public.core_config;
create policy "config: admin altera" on public.core_config for update to authenticated
  using (public.core_e_admin()) with check (public.core_e_admin());
grant select on public.core_config to anon, authenticated;
grant update on public.core_config to authenticated;


-- ---------------------------------------------------------------------
-- 2. OPÇÕES DO DEV POR EMPRESA (o dono da empresa só lê)
-- ---------------------------------------------------------------------
create table if not exists public.dev_empresa_opcoes (
  empresa_id               uuid primary key references public.core_empresas(id) on delete cascade,
  loja_integra_orcamentos  boolean not null default false,
  atualizado_em            timestamptz not null default now()
);

alter table public.dev_empresa_opcoes enable row level security;
drop policy if exists "opcoes: empresa lê" on public.dev_empresa_opcoes;
create policy "opcoes: empresa lê" on public.dev_empresa_opcoes for select to authenticated
  using (public.core_e_membro(empresa_id) or public.core_e_admin());
drop policy if exists "opcoes: admin gerencia" on public.dev_empresa_opcoes;
create policy "opcoes: admin gerencia" on public.dev_empresa_opcoes for all to authenticated
  using (public.core_e_admin()) with check (public.core_e_admin());
grant select, insert, update, delete on public.dev_empresa_opcoes to authenticated;
revoke all on public.dev_empresa_opcoes from anon;

-- A K&E (loja 'ke') continua com os orçamentos do site ligados ao módulo Orçamentos.
-- Todas as outras começam desligadas; mude no Painel Dev quando quiser.
insert into public.dev_empresa_opcoes (empresa_id, loja_integra_orcamentos)
select empresa_id, true from public.loj_config where slug = 'ke'
on conflict (empresa_id) do nothing;


-- ---------------------------------------------------------------------
-- 3. RESUMO DE CADA EMPRESA (só o administrador)
-- ---------------------------------------------------------------------
create or replace function public.dev_resumo()
returns table (
  empresa_id         uuid,
  pessoas            int,
  site_slug          text,
  site_publicado     boolean,
  site_dominio       text,
  produtos           int,
  pedidos_30d        int,
  pedidos_abertos    int,
  orcamentos_novos   int,
  integra_orcamentos boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.core_e_admin() then raise exception 'Apenas o administrador da plataforma.'; end if;
  return query
  select e.id,
         (select count(*)::int from public.core_membros m where m.empresa_id = e.id),
         c.slug, c.publicado, c.dominio,
         (select count(*)::int from public.loj_produtos p where p.empresa_id = e.id),
         (select count(*)::int from public.loj_pedidos p where p.empresa_id = e.id and p.criado_em > now() - interval '30 days'),
         (select count(*)::int from public.loj_pedidos p where p.empresa_id = e.id and p.status in ('aguardando','pago','separando','pronto')),
         (select count(*)::int from public.loj_solicitacoes s where s.empresa_id = e.id and s.status = 'nova'),
         coalesce(o.loja_integra_orcamentos, false)
    from public.core_empresas e
    left join public.loj_config c on c.empresa_id = e.id
    left join public.dev_empresa_opcoes o on o.empresa_id = e.id;
end $$;

revoke all on function public.dev_resumo() from public, anon;
grant execute on function public.dev_resumo() to authenticated;

commit;
