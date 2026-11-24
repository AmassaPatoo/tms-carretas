-- =====================================================================
--  PLATAFORMA KE — 007: EXCLUIR CT-e
--  Rodar no SQL Editor do Supabase (colar tudo → Run). Pode rodar de novo.
--
--  O gestor pode excluir um CT-e de uma viagem Em Aberto. A receita de
--  frete que o CT-e lançou no DRE é apagada junto, para não sobrar valor
--  sem documento. Viagem finalizada não deixa excluir (o DRE já fechou).
--  Devolve os arquivos que nenhum outro CT-e usa, para o app apagá-los.
-- =====================================================================

begin;

create or replace function public.car_excluir_cte(p_cte uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); c record; v_status text; v_empresa uuid; v_arquivos text[] := '{}';
begin
  select id, viagem_id, receita_id, pdf_path, xml_path into c from public.car_ctes where id = p_cte;
  if not found then raise exception 'CT-e não encontrado'; end if;

  select status, empresa_id into v_status, v_empresa from public.car_viagens where id = c.viagem_id for update;
  if v_user is null or not public.car_eh_gestor(v_empresa) then raise exception 'Somente gestor pode excluir CT-e'; end if;
  if v_status is distinct from 'Em Aberto' then raise exception 'A viagem já foi finalizada: o CT-e não pode mais ser excluído'; end if;

  delete from public.car_ctes where id = c.id;
  if c.receita_id is not null then delete from public.car_receitas where id = c.receita_id; end if;

  -- arquivos que ficaram sem nenhum CT-e (um PDF pode ter vários CT-es)
  if c.pdf_path is not null and not exists (select 1 from public.car_ctes where pdf_path = c.pdf_path or xml_path = c.pdf_path) then
    v_arquivos := v_arquivos || c.pdf_path; end if;
  if c.xml_path is not null and not exists (select 1 from public.car_ctes where pdf_path = c.xml_path or xml_path = c.xml_path) then
    v_arquivos := v_arquivos || c.xml_path; end if;

  return jsonb_build_object('excluido', c.id, 'arquivos_sem_uso', to_jsonb(v_arquivos));
end $$;

revoke all on function public.car_excluir_cte(uuid) from public, anon;
grant execute on function public.car_excluir_cte(uuid) to authenticated;

-- o PDF sem uso pode ser apagado por qualquer gestor da viagem (não só por quem enviou)
drop policy if exists "carreta: limpar cte não usado" on storage.objects;
create policy "carreta: limpar cte não usado" on storage.objects for delete to authenticated
  using (bucket_id = 'tms-cte'
         and (owner_id = auth.uid()::text or public.car_gestor_da_viagem(public.core_uuid((storage.foldername(name))[1])))
         and not exists (select 1 from public.car_ctes c where c.pdf_path = objects.name or c.xml_path = objects.name));

notify pgrst, 'reload schema';
commit;
