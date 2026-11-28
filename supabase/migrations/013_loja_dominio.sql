-- =====================================================================
--  PLATAFORMA KE — 013: DOMÍNIO PRÓPRIO PARA O SITE DE CADA EMPRESA
--  Rodar DEPOIS da 012, no SQL Editor do Supabase (colar tudo → Run).
--  Pode ser rodado de novo sem erro. Não altera nem apaga dados.
--
--  Cada empresa pode ter um endereço próprio (ex.: lojadamary.com.br).
--  O site/ abre direto na loja certa quando acessado por esse domínio,
--  sem precisar do ?l=identificador.
-- =====================================================================

begin;

alter table public.loj_config add column if not exists dominio text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loj_config_dominio_formato') then
    alter table public.loj_config add constraint loj_config_dominio_formato
      check (dominio is null or dominio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');
  end if;
end $$;

create unique index if not exists loj_config_dominio_unico on public.loj_config (dominio) where dominio is not null;

-- O site pergunta: "qual loja usa este domínio?" (só lojas publicadas e ativas)
create or replace function public.loj_slug_do_dominio(p_dominio text)
returns text language sql security definer stable set search_path = public as $$
  select c.slug
    from public.loj_config c
    join public.core_empresas e on e.id = c.empresa_id and e.ativo
    join public.core_empresa_modulos em on em.empresa_id = c.empresa_id and em.modulo = 'loja' and em.ativo
   where c.publicado
     and c.dominio = regexp_replace(lower(trim(p_dominio)), '^www\.', '')
   limit 1;
$$;

revoke all on function public.loj_slug_do_dominio(text) from public;
grant execute on function public.loj_slug_do_dominio(text) to anon, authenticated;

commit;
