-- =====================================================================
--  PLATAFORMA KE — 002: CARRETA DENTRO DA PLATAFORMA
--  Rodar DEPOIS da 001, no SQL Editor do Supabase (colar tudo → Run).
--
--  O que faz:
--   1. Cria a empresa "Minha Transportadora" e coloca nela os dados atuais
--      da carreta (renomeie depois no painel de administrador).
--   2. Renomeia as tabelas da carreta para o padrão car_ e liga cada uma
--      a uma empresa (cada cliente seu terá as próprias carretas).
--   3. Troca a tabela "profiles" por car_acessos (gestor / motorista /
--      pendente por empresa) e coloca os usuários como membros da empresa.
--   4. Recria funções, gatilhos e regras de acesso com as mesmas regras de
--      antes (motorista só vê as viagens dele, viagem fechada não muda...).
--
--  ATENÇÃO: depois de rodar, o app antigo da carreta (tms-carretas) para de
--  funcionar. Use o app novo da plataforma (pasta modulos/carreta).
--  Tudo roda numa transação: se der erro, nada é alterado.
-- =====================================================================

begin;

do $$ begin
  if to_regclass('public.core_empresas') is null then
    raise exception 'Rode primeiro a migração 001_plataforma_base.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. EMPRESA PADRÃO PARA OS DADOS ATUAIS
-- ---------------------------------------------------------------------
insert into public.core_empresas (id, nome)
values ('7e5a0000-0000-4000-8000-000000000001', 'Minha Transportadora')
on conflict (id) do nothing;

update public.core_modulos
   set descricao = 'Viagens, gastos do motorista, abastecimentos, CT-e e DRE', icone = 'truck'
 where codigo = 'carreta';

insert into public.core_empresa_modulos (empresa_id, modulo) values
  ('7e5a0000-0000-4000-8000-000000000001', 'carreta'),
  ('7e5a0000-0000-4000-8000-000000000001', 'clientes')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. RENOMEAR TABELAS (padrão car_)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
      ('veiculos','car_veiculos'), ('funcionarios','car_funcionarios'), ('viagens','car_viagens'),
      ('despesas_viagem','car_despesas'), ('abastecimentos','car_abastecimentos'),
      ('adiantamentos','car_adiantamentos'), ('receitas_frete','car_receitas'), ('tms_ctes','car_ctes')
    ) t(velho, novo)
  loop
    if to_regclass('public.'||r.velho) is not null and to_regclass('public.'||r.novo) is null then
      execute format('alter table public.%I rename to %I', r.velho, r.novo);
    end if;
  end loop;
end $$;

-- 2b. gatilhos antigos — removidos ANTES de mexer nos dados, pois
--     ainda apontam para os nomes antigos das tabelas.
--     (nas tabelas da carreta e o de criar profile no cadastro)
do $$
declare r record;
begin
  for r in select t.tgname, c.relname, n.nspname from pg_trigger t
           join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
           join pg_proc p on p.oid = t.tgfoid
           where not t.tgisinternal and (
             (n.nspname = 'public' and c.relname like 'car\_%' and p.proname not like 'car\_%' and p.proname not like 'core\_%')
             or (n.nspname = 'auth' and c.relname = 'users' and p.proname = 'criar_profile')) loop
    execute format('drop trigger %I on %I.%I', r.tgname, r.nspname, r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. LIGAR CADA TABELA A UMA EMPRESA
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['car_veiculos','car_funcionarios','car_viagens','car_despesas',
                           'car_abastecimentos','car_adiantamentos','car_receitas','car_ctes'] loop
    execute format('alter table public.%I add column if not exists empresa_id uuid references public.core_empresas(id) on delete cascade', t);
    execute format('update public.%I set empresa_id = %L where empresa_id is null', t, '7e5a0000-0000-4000-8000-000000000001');
    execute format('alter table public.%I alter column empresa_id set not null', t);
    execute format('create index if not exists %I on public.%I(empresa_id)', t||'_empresa_idx', t);
  end loop;
end $$;

-- placa única por empresa (antes era única no banco todo, se existia)
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.car_veiculos'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (placa)';
  if c is not null then execute format('alter table public.car_veiculos drop constraint %I', c); end if;
end $$;
create unique index if not exists car_veiculos_placa_empresa_uq on public.car_veiculos(empresa_id, upper(placa));

-- ---------------------------------------------------------------------
-- 4. ACESSOS DA CARRETA (substitui a tabela profiles)
-- ---------------------------------------------------------------------
create table if not exists public.car_acessos (
  empresa_id      uuid not null references public.core_empresas(id) on delete cascade,
  usuario_id      uuid not null references auth.users(id) on delete cascade,
  papel           text not null default 'pendente' check (papel in ('gestor','motorista','pendente')),
  funcionario_id  uuid references public.car_funcionarios(id) on delete set null,
  criado_em       timestamptz not null default now(),
  primary key (empresa_id, usuario_id)
);
create index if not exists car_acessos_usuario_idx on public.car_acessos(usuario_id);

do $$
begin
  if to_regclass('public.profiles') is not null then
    insert into public.core_perfis (id, nome)
    select p.id, split_part(u.email, '@', 1) from public.profiles p join auth.users u on u.id = p.id
    on conflict (id) do nothing;

    insert into public.core_membros (empresa_id, usuario_id, papel)
    select '7e5a0000-0000-4000-8000-000000000001', p.id,
           case when p.role = 'gestor' then 'dono' else 'usuario' end
    from public.profiles p join auth.users u on u.id = p.id
    on conflict do nothing;

    insert into public.car_acessos (empresa_id, usuario_id, papel, funcionario_id)
    select '7e5a0000-0000-4000-8000-000000000001', p.id,
           case when p.role in ('gestor','motorista') then p.role else 'pendente' end,
           case when p.role = 'motorista' then p.funcionario_id end
    from public.profiles p join auth.users u on u.id = p.id
    on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. REMOVER O QUE ERA DO SISTEMA ANTIGO
-- ---------------------------------------------------------------------
-- regras de acesso antigas das tabelas da carreta
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename like 'car\_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  -- regras antigas das pastas de arquivos
  for r in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(tms-comprovantes|tms-cte)' loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- a tabela profiles já foi copiada para car_acessos/core_membros (passo 4)
drop table if exists public.profiles;
drop function if exists public.finalizar_viagem(uuid, numeric, timestamptz);
drop function if exists public.resumo_viagem(uuid);
drop function if exists public.tms_registrar_cte(jsonb);
drop function if exists public.validar_viagem();
drop function if exists public.exigir_viagem_aberta();
drop function if exists public.atualizar_status_veiculo();
drop function if exists public.capturar_condicoes_motorista();
drop function if exists public.validar_integridade_veiculo();
drop function if exists public.validar_revisao_no_fechamento();
drop function if exists public.pode_lancar_viagem(uuid);
drop function if exists public.pode_ver_viagem(uuid);
drop function if exists public.meu_funcionario_id();
drop function if exists public.eh_gestor();
drop function if exists public.criar_profile();

-- ---------------------------------------------------------------------
-- 6. FUNÇÕES DE ACESSO DA CARRETA
-- ---------------------------------------------------------------------
create or replace function public.core_uuid(p text)
returns uuid language plpgsql immutable as $$
begin return p::uuid; exception when others then return null; end $$;

-- gestor = papel gestor na carreta, dono da empresa ou administrador da plataforma
create or replace function public.car_eh_gestor(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.core_e_admin() or (public.core_modulo_liberado(p_empresa, 'carreta') and (
    public.core_papel(p_empresa) = 'dono' or exists (
      select 1 from public.car_acessos where empresa_id = p_empresa and usuario_id = auth.uid() and papel = 'gestor')))
$$;

create or replace function public.car_meu_funcionario(p_empresa uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.funcionario_id from public.car_acessos a
  where a.empresa_id = p_empresa and a.usuario_id = auth.uid() and a.papel = 'motorista'
    and public.core_modulo_liberado(p_empresa, 'carreta')
$$;

create or replace function public.car_pode_ver_viagem(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.car_viagens v where v.id = p_id
                 and (public.car_eh_gestor(v.empresa_id) or v.funcionario_id = public.car_meu_funcionario(v.empresa_id)))
$$;

create or replace function public.car_pode_lancar_viagem(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.car_viagens v where v.id = p_id and v.status = 'Em Aberto'
                 and (public.car_eh_gestor(v.empresa_id) or v.funcionario_id = public.car_meu_funcionario(v.empresa_id)))
$$;

create or replace function public.car_gestor_da_viagem(p_id uuid, p_so_aberta boolean default true)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.car_viagens v where v.id = p_id
                 and (not p_so_aberta or v.status = 'Em Aberto') and public.car_eh_gestor(v.empresa_id))
$$;

-- papel do usuário logado na carreta desta empresa (usado pelo app)
create or replace function public.car_meu_acesso(p_empresa uuid)
returns table (papel text, funcionario_id uuid)
language sql stable security definer set search_path = public as $$
  select case when public.car_eh_gestor(p_empresa) then 'gestor' else coalesce(a.papel, 'pendente') end,
         case when public.car_eh_gestor(p_empresa) then null else a.funcionario_id end
  from (select 1) x
  left join public.car_acessos a on a.empresa_id = p_empresa and a.usuario_id = auth.uid()
  where public.core_modulo_liberado(p_empresa, 'carreta') or public.core_e_admin()
$$;

-- membros da empresa com o acesso de cada um na carreta (tela de usuários)
create or replace function public.car_usuarios(p_empresa uuid)
returns table (usuario_id uuid, email text, nome text, papel_empresa text, papel text, funcionario_id uuid, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select m.usuario_id, u.email::text, p.nome, m.papel, coalesce(a.papel, 'pendente'), a.funcionario_id, m.criado_em
  from public.core_membros m
  join auth.users u on u.id = m.usuario_id
  left join public.core_perfis p on p.id = m.usuario_id
  left join public.car_acessos a on a.empresa_id = m.empresa_id and a.usuario_id = m.usuario_id
  where m.empresa_id = p_empresa and public.car_eh_gestor(p_empresa)
  order by m.criado_em desc
$$;

-- ---------------------------------------------------------------------
-- 7. GATILHOS (mesmas regras de antes + empresa)
--    Rodam com permissão própria (security definer): assim a checagem
--    "viagem em aberto" também funciona quando quem lança é o motorista.
-- ---------------------------------------------------------------------
create or replace function public.car_validar_viagem()
returns trigger language plpgsql security definer set search_path = '' as $$
declare vs text; km numeric; ve uuid; fe uuid;
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'Em Aberto' then raise exception 'Viagem fechada/cancelada não pode ser alterada'; end if;
    if new.veiculo_id <> old.veiculo_id or new.funcionario_id <> old.funcionario_id or new.km_inicial <> old.km_inicial
       or new.empresa_id <> old.empresa_id then
      raise exception 'Veículo, motorista e km inicial não podem ser trocados'; end if;
  end if;
  select status, km_inicial, empresa_id into vs, km, ve from public.car_veiculos where id = new.veiculo_id for update;
  select empresa_id into fe from public.car_funcionarios where id = new.funcionario_id;
  if ve is distinct from new.empresa_id or fe is distinct from new.empresa_id then
    raise exception 'Veículo e motorista precisam ser da mesma empresa da viagem'; end if;
  if tg_op = 'INSERT' then
    if vs <> 'Disponível' then raise exception 'Veículo indisponível'; end if;
    if new.status <> 'Em Aberto' then raise exception 'Nova viagem deve iniciar Em Aberto'; end if;
    if new.km_inicial < km then raise exception 'KM inicial inferior ao KM registrado no veículo'; end if;
  end if;
  if new.status = 'Finalizada' and (new.km_final is null or new.data_chegada is null) then
    raise exception 'Fechamento requer KM final e data de chegada'; end if;
  return new;
end $$;

create or replace function public.car_capturar_condicoes_motorista()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select f.comissao_percentual, f.valor_diaria into new.comissao_percentual_aplicada, new.valor_diaria_aplicada
  from public.car_funcionarios f where f.id = new.funcionario_id;
  return new;
end $$;

create or replace function public.car_atualizar_status_veiculo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then update public.car_veiculos set status = 'Em Viagem' where id = new.veiculo_id;
  elsif new.status <> old.status then
    update public.car_veiculos set status = 'Disponível', km_inicial = coalesce(new.km_final, km_inicial)
    where id = new.veiculo_id and status = 'Em Viagem';
  end if;
  return new;
end $$;

create or replace function public.car_validar_integridade_veiculo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.empresa_id <> old.empresa_id then raise exception 'Não é permitido trocar a empresa do veículo'; end if;
  if new.status <> 'Em Viagem' and exists (select 1 from public.car_viagens where veiculo_id = new.id and status = 'Em Aberto') then
    raise exception 'Veículo com viagem em aberto não pode ficar disponível/manutenção'; end if;
  return new;
end $$;

create or replace function public.car_validar_revisao_no_fechamento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'Finalizada' and old.status <> 'Finalizada' then
    if exists (select 1 from public.car_receitas where viagem_id = old.id and revisado = false) then
      raise exception 'Existem documentos XML ainda não revisados'; end if;
  end if;
  return new;
end $$;

-- lançamentos (despesas, abastecimentos, adiantamentos, receitas, CT-e):
-- a empresa vem sempre da viagem, nunca do app
create or replace function public.car_empresa_da_viagem()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.empresa_id := (select empresa_id from public.car_viagens where id = new.viagem_id);
  if new.empresa_id is null then raise exception 'Viagem não encontrada'; end if;
  return new;
end $$;

create or replace function public.car_exigir_viagem_aberta()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_status text;
begin
  v_id := case when tg_op = 'DELETE' then old.viagem_id else new.viagem_id end;
  select status into v_status from public.car_viagens where id = v_id for update;
  if v_status is distinct from 'Em Aberto' then raise exception 'A viagem não está em aberto'; end if;
  if tg_op = 'UPDATE' and new.viagem_id <> old.viagem_id then raise exception 'Não é permitido trocar a viagem'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.car_acessos_confere()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.funcionario_id is not null and not exists (
     select 1 from public.car_funcionarios where id = new.funcionario_id and empresa_id = new.empresa_id) then
    raise exception 'O motorista vinculado precisa ser da mesma empresa'; end if;
  if new.papel = 'motorista' and new.funcionario_id is null then
    raise exception 'Associe o perfil de motorista a um funcionário'; end if;
  if new.papel <> 'motorista' then new.funcionario_id := null; end if;
  return new;
end $$;

drop trigger if exists car_10_validar_viagem on public.car_viagens;
create trigger car_10_validar_viagem before insert or update on public.car_viagens
  for each row execute function public.car_validar_viagem();
drop trigger if exists car_20_condicoes_motorista on public.car_viagens;
create trigger car_20_condicoes_motorista before insert on public.car_viagens
  for each row execute function public.car_capturar_condicoes_motorista();
drop trigger if exists car_30_revisao_fechamento on public.car_viagens;
create trigger car_30_revisao_fechamento before update on public.car_viagens
  for each row execute function public.car_validar_revisao_no_fechamento();
drop trigger if exists car_40_status_veiculo on public.car_viagens;
create trigger car_40_status_veiculo after insert or update on public.car_viagens
  for each row execute function public.car_atualizar_status_veiculo();
drop trigger if exists car_10_integridade_veiculo on public.car_veiculos;
create trigger car_10_integridade_veiculo before update on public.car_veiculos
  for each row execute function public.car_validar_integridade_veiculo();
drop trigger if exists car_10_confere on public.car_acessos;
create trigger car_10_confere before insert or update on public.car_acessos
  for each row execute function public.car_acessos_confere();

do $$
declare t text;
begin
  foreach t in array array['car_despesas','car_abastecimentos','car_adiantamentos','car_receitas','car_ctes'] loop
    execute format('drop trigger if exists car_05_empresa on public.%I', t);
    execute format('create trigger car_05_empresa before insert or update on public.%I
                    for each row execute function public.car_empresa_da_viagem()', t);
  end loop;
  foreach t in array array['car_despesas','car_abastecimentos','car_adiantamentos','car_receitas'] loop
    execute format('drop trigger if exists car_10_so_aberta on public.%I', t);
    execute format('create trigger car_10_so_aberta before insert or update or delete on public.%I
                    for each row execute function public.car_exigir_viagem_aberta()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. FUNÇÕES CHAMADAS PELO APP
-- ---------------------------------------------------------------------
create or replace function public.car_resumo_viagem(p_viagem_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v public.car_viagens%rowtype;
  rb numeric; imp numeric; desp numeric; combust numeric; litros numeric; pes numeric; adiant numeric;
  dias numeric; comissao numeric; diarias numeric; receita_liq numeric; total_oper numeric; lucro numeric; km numeric;
begin
  select * into v from public.car_viagens where id = p_viagem_id;   -- respeita as regras de acesso
  if not found then raise exception 'Viagem não encontrada ou acesso negado'; end if;
  select coalesce(sum(r.valor_frete_bruto),0), coalesce(sum(r.valor_impostos),0) into rb, imp
    from public.car_receitas r where r.viagem_id = v.id;
  select coalesce(sum(d.valor),0), coalesce(sum(d.valor) filter (where d.categoria = 'Gastos_Pessoais_Motorista'),0) into desp, pes
    from public.car_despesas d where d.viagem_id = v.id;
  select coalesce(sum(a.valor_total),0), coalesce(sum(a.litros),0) into combust, litros
    from public.car_abastecimentos a where a.viagem_id = v.id;
  select coalesce(sum(ad.valor),0) into adiant from public.car_adiantamentos ad where ad.viagem_id = v.id;
  km := coalesce(v.km_total_rodado, 0);
  dias := case when v.data_chegada is not null
               then greatest(1, ceil(extract(epoch from v.data_chegada - v.data_saida) / 86400)) else 0 end;
  receita_liq := rb - imp;
  total_oper := desp + combust;
  lucro := receita_liq - total_oper;
  comissao := round(receita_liq * v.comissao_percentual_aplicada / 100, 2);
  diarias := dias * v.valor_diaria_aplicada;
  return jsonb_build_object(
    'receita_bruta', rb, 'impostos', imp, 'receita_liquida', receita_liq,
    'despesas_lancadas', desp, 'combustivel', combust, 'despesas_operacionais', total_oper,
    'lucro_solicitado', lucro,
    'margem_percentual', case when receita_liq > 0 then round(100 * lucro / receita_liq, 2) end,
    'km_rodado', km, 'litros', litros,
    'consumo_kml', case when litros > 0 and km > 0 then round(km / litros, 2) end,
    'custo_km', case when km > 0 then round(total_oper / km, 2) end,
    'adiantamentos', adiant, 'gastos_pessoais', pes, 'saldo_adiantamentos', adiant - pes,
    'dias', dias, 'comissao', comissao, 'diarias', diarias,
    'remuneracao_motorista', comissao + diarias,
    'acerto_a_pagar', comissao + diarias - (adiant - pes),
    'resultado_apos_remuneracao', lucro - (comissao + diarias));
end $$;

create or replace function public.car_finalizar_viagem(p_viagem_id uuid, p_km_final numeric, p_data_chegada timestamptz)
returns jsonb language plpgsql set search_path = '' as $$
declare v public.car_viagens%rowtype; pendentes int;
begin
  select * into v from public.car_viagens where id = p_viagem_id;
  if not found then raise exception 'Viagem não encontrada'; end if;
  if not public.car_eh_gestor(v.empresa_id) then raise exception 'Apenas o gestor pode finalizar a viagem'; end if;
  select * into v from public.car_viagens where id = p_viagem_id for update;
  if v.status <> 'Em Aberto' then raise exception 'Viagem não está em aberto'; end if;
  if p_km_final is null or p_km_final < v.km_inicial or p_data_chegada < v.data_saida then raise exception 'KM ou chegada inválidos'; end if;
  select count(*) into pendentes from public.car_receitas where viagem_id = p_viagem_id and not revisado;
  if pendentes > 0 then raise exception 'Revise os documentos de frete antes do fechamento'; end if;
  update public.car_viagens set km_final = p_km_final, data_chegada = p_data_chegada, status = 'Finalizada' where id = p_viagem_id;
  return public.car_resumo_viagem(p_viagem_id);
end $$;

create or replace function public.car_registrar_cte(p_registro jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_viagem uuid; v_empresa uuid; v_numero text; v_chave text; v_pdf text; v_xml text;
  v_valor numeric; v_impostos numeric; v_cte uuid; v_receita uuid; v_dados jsonb;
begin
  v_viagem := (p_registro->>'viagem_id')::uuid;
  select empresa_id into v_empresa from public.car_viagens where id = v_viagem and status = 'Em Aberto' for update;
  if not found then raise exception 'Viagem inexistente ou já finalizada'; end if;
  if v_user is null or not public.car_eh_gestor(v_empresa) then raise exception 'Somente gestor pode cadastrar CT-e'; end if;

  v_numero := btrim(coalesce(p_registro->>'numero',''));
  v_chave := coalesce(p_registro->>'chave_acesso','');
  v_valor := (p_registro->>'valor_frete_bruto')::numeric;
  v_impostos := (p_registro->>'valor_impostos')::numeric;
  v_pdf := coalesce(p_registro->>'pdf_path','');
  v_xml := nullif(p_registro->>'xml_path','');
  v_dados := coalesce(p_registro->'dados','{}'::jsonb);
  if length(v_numero) = 0 or length(v_numero) > 30 or v_chave !~ '^[0-9]{44}$'
     or v_valor is null or v_impostos is null or v_valor < 0 or v_impostos < 0 or v_impostos > v_valor
     or v_pdf !~ ('^' || v_viagem::text || '/[0-9a-f-]{36}\.pdf$')
     or (v_xml is not null and v_xml !~ ('^' || v_viagem::text || '/[0-9a-f-]{36}\.xml$'))
  then raise exception 'Dados do CT-e inválidos'; end if;

  if exists (select 1 from public.car_receitas where chave_acesso_nfe_cte = v_chave and empresa_id = v_empresa)
  then raise exception 'Esta chave já existe em Fretes / XML. Revise o lançamento para evitar duplicidade.'; end if;

  if not exists (select 1 from storage.objects where bucket_id = 'tms-cte' and name = v_pdf)
     or (v_xml is not null and not exists (select 1 from storage.objects where bucket_id = 'tms-cte' and name = v_xml))
  then raise exception 'Documento anexado não foi encontrado'; end if;

  insert into public.car_ctes (viagem_id, empresa_id, numero, chave_acesso, valor_frete_bruto, valor_impostos, dados, pdf_path, xml_path, created_by)
  values (v_viagem, v_empresa, v_numero, v_chave, v_valor, v_impostos, v_dados, v_pdf, v_xml, v_user)
  returning id into v_cte;

  insert into public.car_receitas (viagem_id, empresa_id, tipo_documento, numero_nota, chave_acesso_nfe_cte, valor_frete_bruto, valor_impostos,
                                   peso_kg, descricao_mercadoria, emitente, destinatario, valor_documento, revisado)
  values (v_viagem, v_empresa, 'CTe', v_numero, v_chave, v_valor, v_impostos,
          nullif(v_dados->>'peso','')::numeric, nullif(v_dados->>'produto',''),
          nullif(v_dados->>'emitente',''), nullif(v_dados->>'destinatario',''), v_valor, true)
  returning id into v_receita;

  update public.car_ctes set receita_id = v_receita where id = v_cte;
  return v_cte;
end $$;

-- ---------------------------------------------------------------------
-- 9. REGRAS DE ACESSO (RLS)
-- ---------------------------------------------------------------------
alter table public.car_acessos enable row level security;
do $$
declare t text;
begin
  foreach t in array array['car_veiculos','car_funcionarios','car_viagens','car_despesas','car_abastecimentos',
                           'car_adiantamentos','car_receitas','car_ctes','car_acessos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- veículos e funcionários
create policy "veiculos: ver" on public.car_veiculos for select to authenticated
  using (public.car_eh_gestor(empresa_id) or public.car_meu_funcionario(empresa_id) is not null);
create policy "veiculos: gestor cria" on public.car_veiculos for insert to authenticated with check (public.car_eh_gestor(empresa_id));
create policy "veiculos: gestor edita" on public.car_veiculos for update to authenticated
  using (public.car_eh_gestor(empresa_id)) with check (public.car_eh_gestor(empresa_id));

create policy "funcionarios: gestor ou o próprio" on public.car_funcionarios for select to authenticated
  using (public.car_eh_gestor(empresa_id) or id = public.car_meu_funcionario(empresa_id));
create policy "funcionarios: gestor cria" on public.car_funcionarios for insert to authenticated with check (public.car_eh_gestor(empresa_id));
create policy "funcionarios: gestor edita" on public.car_funcionarios for update to authenticated
  using (public.car_eh_gestor(empresa_id)) with check (public.car_eh_gestor(empresa_id));

-- viagens (não se apaga viagem)
create policy "viagens: ver" on public.car_viagens for select to authenticated
  using (public.car_eh_gestor(empresa_id) or funcionario_id = public.car_meu_funcionario(empresa_id));
create policy "viagens: gestor abre" on public.car_viagens for insert to authenticated with check (public.car_eh_gestor(empresa_id));
create policy "viagens: gestor edita" on public.car_viagens for update to authenticated
  using (public.car_eh_gestor(empresa_id)) with check (public.car_eh_gestor(empresa_id));

-- despesas e abastecimentos: gestor e o motorista da viagem lançam
create policy "despesas: ver" on public.car_despesas for select to authenticated using (public.car_pode_ver_viagem(viagem_id));
create policy "despesas: lançar" on public.car_despesas for insert to authenticated
  with check (public.car_pode_lancar_viagem(viagem_id) and created_by = auth.uid());
create policy "despesas: gestor edita" on public.car_despesas for update to authenticated
  using (public.car_gestor_da_viagem(viagem_id)) with check (public.car_gestor_da_viagem(viagem_id));
create policy "despesas: gestor remove" on public.car_despesas for delete to authenticated using (public.car_gestor_da_viagem(viagem_id));

create policy "abastecimentos: ver" on public.car_abastecimentos for select to authenticated using (public.car_pode_ver_viagem(viagem_id));
create policy "abastecimentos: lançar" on public.car_abastecimentos for insert to authenticated
  with check (public.car_pode_lancar_viagem(viagem_id) and created_by = auth.uid());
create policy "abastecimentos: gestor edita" on public.car_abastecimentos for update to authenticated
  using (public.car_gestor_da_viagem(viagem_id)) with check (public.car_gestor_da_viagem(viagem_id));
create policy "abastecimentos: gestor remove" on public.car_abastecimentos for delete to authenticated using (public.car_gestor_da_viagem(viagem_id));

-- adiantamentos e receitas: só gestor lança
create policy "adiantamentos: ver" on public.car_adiantamentos for select to authenticated using (public.car_pode_ver_viagem(viagem_id));
create policy "adiantamentos: gestor lança" on public.car_adiantamentos for insert to authenticated with check (public.car_gestor_da_viagem(viagem_id));
create policy "adiantamentos: gestor edita" on public.car_adiantamentos for update to authenticated
  using (public.car_gestor_da_viagem(viagem_id)) with check (public.car_gestor_da_viagem(viagem_id));
create policy "adiantamentos: gestor remove" on public.car_adiantamentos for delete to authenticated using (public.car_gestor_da_viagem(viagem_id));

create policy "receitas: ver" on public.car_receitas for select to authenticated using (public.car_pode_ver_viagem(viagem_id));
create policy "receitas: gestor lança" on public.car_receitas for insert to authenticated with check (public.car_gestor_da_viagem(viagem_id));
create policy "receitas: gestor edita" on public.car_receitas for update to authenticated
  using (public.car_gestor_da_viagem(viagem_id)) with check (public.car_gestor_da_viagem(viagem_id));
create policy "receitas: gestor remove" on public.car_receitas for delete to authenticated using (public.car_gestor_da_viagem(viagem_id));

-- CT-e (cadastro pela função car_registrar_cte)
create policy "ctes: ver" on public.car_ctes for select to authenticated using (public.car_pode_ver_viagem(viagem_id));
create policy "ctes: gestor cria" on public.car_ctes for insert to authenticated with check (public.car_gestor_da_viagem(viagem_id));
create policy "ctes: gestor edita" on public.car_ctes for update to authenticated
  using (public.car_gestor_da_viagem(viagem_id, false)) with check (public.car_gestor_da_viagem(viagem_id, false));

-- acessos
create policy "acessos: ver o meu ou gestor" on public.car_acessos for select to authenticated
  using (usuario_id = auth.uid() or public.car_eh_gestor(empresa_id));
create policy "acessos: gestor gerencia" on public.car_acessos for all to authenticated
  using (public.car_eh_gestor(empresa_id))
  with check (public.car_eh_gestor(empresa_id) and exists (
    select 1 from public.core_membros m where m.empresa_id = car_acessos.empresa_id and m.usuario_id = car_acessos.usuario_id));

-- ---------------------------------------------------------------------
-- 10. PASTAS DE ARQUIVOS (mesmos caminhos de antes)
--   tms-comprovantes: {usuario}/{viagem}/{arquivo}
--   tms-cte:          {viagem}/{uuid}.pdf|.xml
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('tms-comprovantes', 'tms-comprovantes', false), ('tms-cte', 'tms-cte', false)
on conflict (id) do nothing;

create policy "carreta: enviar comprovante" on storage.objects for insert to authenticated
  with check (bucket_id = 'tms-comprovantes' and (storage.foldername(name))[1] = auth.uid()::text
              and public.car_pode_lancar_viagem(public.core_uuid((storage.foldername(name))[2])));
create policy "carreta: ler comprovante" on storage.objects for select to authenticated
  using (bucket_id = 'tms-comprovantes' and public.car_pode_ver_viagem(public.core_uuid((storage.foldername(name))[2])));
create policy "carreta: enviar cte" on storage.objects for insert to authenticated
  with check (bucket_id = 'tms-cte' and public.car_gestor_da_viagem(public.core_uuid((storage.foldername(name))[1])));
create policy "carreta: ler cte" on storage.objects for select to authenticated
  using (bucket_id = 'tms-cte' and public.car_pode_ver_viagem(public.core_uuid((storage.foldername(name))[1])));
create policy "carreta: limpar cte não usado" on storage.objects for delete to authenticated
  using (bucket_id = 'tms-cte' and owner_id = auth.uid()::text
         and not exists (select 1 from public.car_ctes c where c.pdf_path = objects.name or c.xml_path = objects.name));

-- fotos dos orçamentos: o administrador também pode enviar/ver (correção da 001)
drop policy if exists "orcamentos: ler fotos da empresa"   on storage.objects;
drop policy if exists "orcamentos: enviar fotos da empresa" on storage.objects;
drop policy if exists "orcamentos: alterar fotos da empresa" on storage.objects;
drop policy if exists "orcamentos: apagar fotos da empresa" on storage.objects;
create policy "orcamentos: ler fotos da empresa" on storage.objects for select to authenticated
  using (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(public.core_uuid((storage.foldername(name))[1]), 'orcamentos')));
create policy "orcamentos: enviar fotos da empresa" on storage.objects for insert to authenticated
  with check (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(public.core_uuid((storage.foldername(name))[1]), 'orcamentos')));
create policy "orcamentos: alterar fotos da empresa" on storage.objects for update to authenticated
  using (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(public.core_uuid((storage.foldername(name))[1]), 'orcamentos')));
create policy "orcamentos: apagar fotos da empresa" on storage.objects for delete to authenticated
  using (bucket_id = 'orcamentos' and (public.core_e_admin() or public.core_modulo_liberado(public.core_uuid((storage.foldername(name))[1]), 'orcamentos')));

-- ---------------------------------------------------------------------
-- 11. EQUIPE DA EMPRESA (usado pelo app da plataforma)
-- ---------------------------------------------------------------------
create or replace function public.core_membros_da_empresa(p_empresa uuid)
returns table (usuario_id uuid, email text, nome text, papel text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select m.usuario_id, u.email::text, p.nome, m.papel, m.criado_em
  from public.core_membros m join auth.users u on u.id = m.usuario_id
  left join public.core_perfis p on p.id = m.usuario_id
  where m.empresa_id = p_empresa and (public.core_e_membro(p_empresa) or public.core_e_admin())
  order by m.criado_em
$$;

-- adiciona alguém à empresa pelo e-mail (a pessoa precisa já ter criado a conta)
create or replace function public.core_adicionar_membro(p_empresa uuid, p_email text, p_papel text default 'usuario')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.core_e_admin() or public.core_papel(p_empresa) = 'dono') then
    raise exception 'Somente o dono da empresa ou o administrador pode adicionar pessoas'; end if;
  if p_papel not in ('dono','gerente','usuario') then raise exception 'Papel inválido'; end if;
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));
  if v_id is null then
    raise exception 'Nenhuma conta com o e-mail %. Peça para a pessoa abrir o app e tocar em "Criar conta" primeiro.', p_email; end if;
  insert into public.core_perfis (id, nome) values (v_id, split_part(p_email, '@', 1)) on conflict (id) do nothing;
  insert into public.core_membros (empresa_id, usuario_id, papel) values (p_empresa, v_id, p_papel)
  on conflict (empresa_id, usuario_id) do update set papel = excluded.papel;
  if exists (select 1 from public.core_empresa_modulos where empresa_id = p_empresa and modulo = 'carreta') then
    insert into public.car_acessos (empresa_id, usuario_id) values (p_empresa, v_id) on conflict do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.core_remover_membro(p_empresa uuid, p_usuario uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.core_e_admin() or public.core_papel(p_empresa) = 'dono') then
    raise exception 'Somente o dono da empresa ou o administrador pode remover pessoas'; end if;
  if p_usuario = auth.uid() and not public.core_e_admin() then
    raise exception 'Você não pode remover a si mesmo'; end if;
  delete from public.car_acessos where empresa_id = p_empresa and usuario_id = p_usuario;
  delete from public.core_membros where empresa_id = p_empresa and usuario_id = p_usuario;
end $$;

revoke execute on function public.car_eh_gestor(uuid), public.car_meu_funcionario(uuid), public.car_pode_ver_viagem(uuid),
  public.car_pode_lancar_viagem(uuid), public.car_gestor_da_viagem(uuid, boolean), public.car_meu_acesso(uuid),
  public.car_usuarios(uuid), public.car_resumo_viagem(uuid), public.car_finalizar_viagem(uuid, numeric, timestamptz),
  public.car_registrar_cte(jsonb), public.core_membros_da_empresa(uuid), public.core_adicionar_membro(uuid, text, text),
  public.core_remover_membro(uuid, uuid)
  from anon, public;
grant execute on function public.car_eh_gestor(uuid), public.car_meu_funcionario(uuid), public.car_pode_ver_viagem(uuid),
  public.car_pode_lancar_viagem(uuid), public.car_gestor_da_viagem(uuid, boolean), public.car_meu_acesso(uuid),
  public.car_usuarios(uuid), public.car_resumo_viagem(uuid), public.car_finalizar_viagem(uuid, numeric, timestamptz),
  public.car_registrar_cte(jsonb), public.core_membros_da_empresa(uuid), public.core_adicionar_membro(uuid, text, text),
  public.core_remover_membro(uuid, uuid)
  to authenticated;

commit;

-- =====================================================================
--  DEPOIS DE RODAR:
--  • No app da plataforma (como administrador), renomeie a empresa
--    "Minha Transportadora" e confira quem tem acesso.
--  • Os usuários que já existiam continuam com o mesmo papel:
--    gestor → dono da empresa e gestor da carreta; motorista → motorista.
-- =====================================================================
