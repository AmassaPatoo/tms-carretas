-- =====================================================================
--  PLATAFORMA KE — 006: MÓDULO ROMANEIOS (entrega / ordem de serviço)
--  Rodar DEPOIS da 005, no SQL Editor do Supabase (colar tudo → Run).
--
--  Transforma o pedido/nota do fornecedor num documento da SUA empresa
--  (seu nome, CNPJ, seus preços) para quem vai entregar ou fazer o serviço.
--  O custo do fornecedor fica guardado só para a equipe; nunca sai no PDF.
--  Depois de rodar: em Administração, ligue "Romaneios" na empresa.
-- =====================================================================

begin;

create table if not exists public.rom_documentos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  numero        int  not null,
  tipo          text not null default 'entrega' check (tipo in ('entrega','servico')),
  data          date not null default current_date,
  cliente_id    uuid references public.core_clientes(id) on delete set null,
  cliente_nome  text check (length(cliente_nome) <= 160),
  total         numeric(14,2) not null default 0,
  dados         jsonb not null default '{}'::jsonb,     -- itens, endereço, responsável, custos (internos)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por    uuid default auth.uid(),
  unique (empresa_id, numero)
);
create index if not exists rom_documentos_lista_idx on public.rom_documentos(empresa_id, atualizado_em desc);

drop trigger if exists rom_documentos_atualizado on public.rom_documentos;
create trigger rom_documentos_atualizado before update on public.rom_documentos
  for each row execute function public.core_toca_atualizado();

create or replace function public.rom_proximo_numero(p_empresa uuid)
returns int language sql stable security definer set search_path = public as $$
  select case when public.core_modulo_liberado(p_empresa, 'romaneios') or public.core_e_admin()
              then coalesce(max(numero), 0) + 1 end
  from public.rom_documentos where empresa_id = p_empresa
$$;
revoke all on function public.rom_proximo_numero(uuid) from public, anon;
grant execute on function public.rom_proximo_numero(uuid) to authenticated;

alter table public.rom_documentos enable row level security;
drop policy if exists "romaneios: equipe usa" on public.rom_documentos;
create policy "romaneios: equipe usa" on public.rom_documentos for all to authenticated
  using (public.core_modulo_liberado(empresa_id, 'romaneios') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'romaneios') or public.core_e_admin());
revoke all on public.rom_documentos from anon;
grant select, insert, update, delete on public.rom_documentos to authenticated;

insert into public.core_modulos (codigo, nome, descricao, icone, ordem) values
  ('romaneios', 'Romaneios', 'Entrega e ordem de serviço com o CNPJ e os preços da sua empresa', 'truck-box', 25)
on conflict (codigo) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, ordem = excluded.ordem;

commit;
