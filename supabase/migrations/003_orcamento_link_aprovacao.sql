-- =====================================================================
--  PLATAFORMA KE — 003: LINK PARA O CLIENTE APROVAR E ASSINAR
--  Rodar DEPOIS da 002, no SQL Editor (colar tudo → Run).
--
--  Cada orçamento pode ter um link único (difícil de adivinhar). Quem abre
--  o link, SEM login, vê só o resumo daquele orçamento (nunca os custos e o
--  lucro internos), assina com o dedo e aprova. A aprovação fica gravada com
--  nome, data/hora e assinatura, e não pode ser apagada pelo app.
-- =====================================================================

begin;

alter table public.orc_orcamentos
  add column if not exists resumo         jsonb,         -- o que o cliente vê no link
  add column if not exists link_token     text,
  add column if not exists link_criado_em timestamptz,
  add column if not exists aprovado_em    timestamptz,
  add column if not exists aprovado_nome  text,
  add column if not exists aprovado_meta  jsonb;         -- navegador/IP de quem aprovou
create unique index if not exists orc_orcamentos_link_uq on public.orc_orcamentos(link_token) where link_token is not null;

-- ---------------------------------------------------------------------
-- Gerar / cancelar o link (equipe da empresa)
-- ---------------------------------------------------------------------
create or replace function public.orc_gerar_link(p_orcamento uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_tok text;
begin
  select empresa_id, link_token into v_emp, v_tok from public.orc_orcamentos where id = p_orcamento;
  if v_emp is null then raise exception 'Orçamento não encontrado. Preencha e salve antes de gerar o link.'; end if;
  if not (public.core_modulo_liberado(v_emp, 'orcamentos') or public.core_e_admin()) then
    raise exception 'Sem permissão para este orçamento'; end if;
  if v_tok is null then
    v_tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    update public.orc_orcamentos set link_token = v_tok, link_criado_em = now() where id = p_orcamento;
  end if;
  return v_tok;
end $$;

create or replace function public.orc_cancelar_link(p_orcamento uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from public.orc_orcamentos where id = p_orcamento;
  if v_emp is null or not (public.core_modulo_liberado(v_emp, 'orcamentos') or public.core_e_admin()) then
    raise exception 'Sem permissão para este orçamento'; end if;
  update public.orc_orcamentos set link_token = null, link_criado_em = null where id = p_orcamento;
end $$;

-- ---------------------------------------------------------------------
-- Página pública (sem login): ver e aprovar
-- ---------------------------------------------------------------------
create or replace function public.orc_publico_ver(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o public.orc_orcamentos%rowtype; e public.core_empresas%rowtype; v_dias int; v_validade date;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into o from public.orc_orcamentos where link_token = p_token;
  if not found then return null; end if;
  select * into e from public.core_empresas where id = o.empresa_id and ativo;
  if not found then return null; end if;
  v_dias := case when coalesce(o.dados->>'validade','') ~ '^\d{1,4}$' then (o.dados->>'validade')::int else 7 end;
  v_validade := o.data + v_dias;
  return jsonb_build_object(
    'numero', o.numero, 'data', o.data, 'valido_ate', v_validade, 'vencido', v_validade < current_date,
    'status', o.status, 'cliente', o.cliente_nome, 'local', o.local, 'total', o.total,
    'resumo', coalesce(o.resumo, '{}'::jsonb),
    'aprovado_em', o.aprovado_em, 'aprovado_nome', o.aprovado_nome,
    'empresa', jsonb_build_object('nome', e.nome, 'telefone', e.telefone, 'cidade', e.cidade, 'documento', e.documento,
                                  'logo', e.config->>'logo', 'slogan', e.config->>'slogan'));
end $$;

create or replace function public.orc_publico_aprovar(p_token text, p_nome text, p_assinatura jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orc_orcamentos%rowtype; v_dias int; v_meta jsonb; v_hdr jsonb;
begin
  select * into o from public.orc_orcamentos where link_token = p_token and p_token is not null and length(p_token) >= 40 for update;
  if not found then raise exception 'Link inválido ou cancelado. Peça um novo link para a empresa.'; end if;
  if o.aprovado_em is not null then raise exception 'Este orçamento já foi aprovado.'; end if;
  if o.status in ('recusado','executado') then raise exception 'Este orçamento não está mais disponível para aprovação.'; end if;
  v_dias := case when coalesce(o.dados->>'validade','') ~ '^\d{1,4}$' then (o.dados->>'validade')::int else 7 end;
  if o.data + v_dias < current_date then
    raise exception 'O prazo de validade deste orçamento venceu. Fale com a empresa para receber um orçamento atualizado.'; end if;
  if length(btrim(coalesce(p_nome,''))) < 3 then raise exception 'Digite o seu nome completo.'; end if;
  if coalesce(p_assinatura->>'src','') !~ '^data:image/png;base64,' or length(p_assinatura->>'src') > 400000 then
    raise exception 'Assinatura inválida. Assine novamente.'; end if;

  begin v_hdr := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then v_hdr := null; end;
  v_meta := jsonb_build_object('ip', coalesce(v_hdr->>'x-forwarded-for', v_hdr->>'x-real-ip'), 'navegador', v_hdr->>'user-agent');

  update public.orc_orcamentos set
    status = 'aprovado', aprovado_em = now(), aprovado_nome = btrim(p_nome), aprovado_meta = v_meta,
    dados = coalesce(dados, '{}'::jsonb) || jsonb_build_object(
      'status', 'aprovado', 'assCliente', jsonb_build_object('src', p_assinatura->>'src', 'w', p_assinatura->'w', 'h', p_assinatura->'h'),
      'assData', to_char(current_date, 'YYYY-MM-DD'), 'assEmIso', now(),
      'assNome', btrim(p_nome), 'assVia', 'link')
  where id = o.id;
  return jsonb_build_object('ok', true, 'aprovado_em', now());
end $$;

-- ---------------------------------------------------------------------
-- O app não pode desfazer uma aprovação feita pelo link
-- (protege contra o salvamento automático sobrescrever a assinatura)
-- ---------------------------------------------------------------------
create or replace function public.orc_protege_aprovacao()
returns trigger language plpgsql as $$
begin
  if old.aprovado_em is not null then
    new.aprovado_em := old.aprovado_em; new.aprovado_nome := old.aprovado_nome; new.aprovado_meta := old.aprovado_meta;
    new.dados := coalesce(new.dados, '{}'::jsonb) || jsonb_build_object(
      'assCliente', old.dados->'assCliente', 'assData', old.dados->'assData', 'assEmIso', old.dados->'assEmIso',
      'assNome', old.dados->'assNome', 'assVia', old.dados->'assVia');
    if new.status in ('rascunho','enviado') then new.status := 'aprovado'; end if;
  end if;
  return new;
end $$;
drop trigger if exists orc_protege_aprovacao on public.orc_orcamentos;
create trigger orc_protege_aprovacao before update on public.orc_orcamentos
  for each row execute function public.orc_protege_aprovacao();

revoke execute on function public.orc_gerar_link(uuid), public.orc_cancelar_link(uuid) from anon, public;
grant execute on function public.orc_gerar_link(uuid), public.orc_cancelar_link(uuid) to authenticated;
revoke execute on function public.orc_publico_ver(text), public.orc_publico_aprovar(text, text, jsonb) from public;
grant execute on function public.orc_publico_ver(text), public.orc_publico_aprovar(text, text, jsonb) to anon, authenticated;

commit;
