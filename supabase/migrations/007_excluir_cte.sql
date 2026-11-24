-- =====================================================================
--  PLATAFORMA KE — 007: EXCLUIR CT-e E EXCLUIR VIAGEM
--  Rodar no SQL Editor do Supabase (colar tudo → Run). Pode rodar de novo.
--
--  Só o gestor da empresa exclui. Vale para viagem Em Aberto ou Finalizada.
--  - Excluir CT-e: apaga o CT-e e a receita de frete que ele lançou no DRE.
--  - Excluir viagem: apaga a viagem e tudo dela (CT-es, fretes, despesas,
--    abastecimentos, adiantamentos) e libera a carreta se estava Em Viagem.
--  Devolve os arquivos de CT-e que ficaram sem uso, para o app apagá-los.
-- =====================================================================

begin;

-- As regras "só mexe em viagem aberta" passam a deixar a exclusão feita
-- por estas funções (marcação válida só dentro da própria transação).
create or replace function public.car_exigir_viagem_aberta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
  v_id := case when tg_op = 'DELETE' then old.viagem_id else new.viagem_id end;
  if tg_op = 'DELETE' and coalesce(current_setting('car.excluindo', true), '') = v_id::text then return old; end if;
  select status into v_status from public.car_viagens where id = v_id for update;
  if v_status is distinct from 'Em Aberto' then raise exception 'A viagem não está em aberto'; end if;
  if tg_op = 'UPDATE' and new.viagem_id <> old.viagem_id then raise exception 'Não é permitido trocar a viagem'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.car_excluir_cte(p_cte uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); c record; v_empresa uuid; v_arquivos text[] := '{}';
begin
  select id, viagem_id, receita_id, pdf_path, xml_path into c from public.car_ctes where id = p_cte;
  if not found then raise exception 'CT-e não encontrado'; end if;
  select empresa_id into v_empresa from public.car_viagens where id = c.viagem_id for update;
  if v_user is null or not public.car_eh_gestor(v_empresa) then raise exception 'Somente gestor pode excluir CT-e'; end if;

  perform set_config('car.excluindo', c.viagem_id::text, true);
  delete from public.car_ctes where id = c.id;
  if c.receita_id is not null then delete from public.car_receitas where id = c.receita_id; end if;
  perform set_config('car.excluindo', '', true);

  -- arquivos que ficaram sem nenhum CT-e (um PDF pode ter vários CT-es)
  if c.pdf_path is not null and not exists (select 1 from public.car_ctes where pdf_path = c.pdf_path or xml_path = c.pdf_path) then
    v_arquivos := v_arquivos || c.pdf_path; end if;
  if c.xml_path is not null and not exists (select 1 from public.car_ctes where pdf_path = c.xml_path or xml_path = c.xml_path) then
    v_arquivos := v_arquivos || c.xml_path; end if;
  return jsonb_build_object('excluido', c.id, 'arquivos_sem_uso', to_jsonb(v_arquivos));
end $$;

create or replace function public.car_excluir_viagem(p_viagem uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v record; v_arquivos text[];
begin
  select id, empresa_id, veiculo_id into v from public.car_viagens where id = p_viagem for update;
  if not found then raise exception 'Viagem não encontrada'; end if;
  if v_user is null or not public.car_eh_gestor(v.empresa_id) then raise exception 'Somente gestor pode excluir viagem'; end if;

  select coalesce(array_agg(distinct p) filter (where p is not null), '{}') into v_arquivos
  from public.car_ctes, unnest(array[pdf_path, xml_path]) p where viagem_id = p_viagem;

  perform set_config('car.excluindo', p_viagem::text, true);
  delete from public.car_ctes           where viagem_id = p_viagem;
  delete from public.car_receitas       where viagem_id = p_viagem;
  delete from public.car_despesas       where viagem_id = p_viagem;
  delete from public.car_abastecimentos where viagem_id = p_viagem;
  delete from public.car_adiantamentos  where viagem_id = p_viagem;
  delete from public.car_viagens        where id = p_viagem;
  perform set_config('car.excluindo', '', true);

  -- a carreta volta a ficar disponível se não tem outra viagem aberta
  update public.car_veiculos set status = 'Disponível'
  where id = v.veiculo_id and status = 'Em Viagem'
    and not exists (select 1 from public.car_viagens where veiculo_id = v.veiculo_id and status = 'Em Aberto');

  return jsonb_build_object('excluida', p_viagem, 'arquivos_sem_uso', to_jsonb(v_arquivos));
end $$;

revoke all on function public.car_excluir_cte(uuid), public.car_excluir_viagem(uuid) from public, anon;
grant execute on function public.car_excluir_cte(uuid), public.car_excluir_viagem(uuid) to authenticated;

-- o PDF sem uso pode ser apagado por quem enviou ou por um gestor da viagem
drop policy if exists "carreta: limpar cte não usado" on storage.objects;
create policy "carreta: limpar cte não usado" on storage.objects for delete to authenticated
  using (bucket_id = 'tms-cte'
         and (owner_id = auth.uid()::text or public.car_gestor_da_viagem(public.core_uuid((storage.foldername(name))[1])))
         and not exists (select 1 from public.car_ctes c where c.pdf_path = objects.name or c.xml_path = objects.name));

notify pgrst, 'reload schema';
commit;
