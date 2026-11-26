-- =====================================================================
--  PLATAFORMA KE — 009: REMOVER A ASSINATURA FEITA PELO LINK
--  Rodar DEPOIS da 008, no SQL Editor (colar tudo → Run).
--
--  A equipe da empresa pode apagar a assinatura/aprovação que o cliente
--  fez pelo link (ex.: assinou errado, ou o orçamento vai mudar).
--  O orçamento volta para "Enviado", a assinatura sai do PDF e o link
--  antigo é cancelado (gere um novo para o cliente assinar de novo).
--
--  O salvamento automático do app continua sem conseguir apagar a
--  aprovação: só esta função, chamada de propósito pelo botão, consegue.
-- =====================================================================

begin;

create or replace function public.orc_remover_aprovacao(p_orcamento uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from public.orc_orcamentos where id = p_orcamento for update;
  if v_emp is null or not (public.core_modulo_liberado(v_emp, 'orcamentos') or public.core_e_admin()) then
    raise exception 'Sem permissão para este orçamento'; end if;

  -- avisa o gatilho de proteção que esta remoção é intencional (vale só nesta transação)
  perform set_config('orc.remover_aprovacao', '1', true);

  update public.orc_orcamentos set
    aprovado_em = null, aprovado_nome = null, aprovado_meta = null,
    link_token = null, link_criado_em = null,
    status = case when status = 'aprovado' then 'enviado' else status end,
    dados = (coalesce(dados, '{}'::jsonb) - 'assCliente' - 'assData' - 'assEmIso' - 'assNome' - 'assVia')
            || jsonb_build_object('status', case when status = 'aprovado' then 'enviado' else status end)
  where id = p_orcamento;

  perform set_config('orc.remover_aprovacao', '', true);
end $$;

-- o gatilho continua protegendo a aprovação, exceto quando é a função acima
create or replace function public.orc_protege_aprovacao()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('orc.remover_aprovacao', true), '') = '1' then return new; end if;
  if old.aprovado_em is not null then
    new.aprovado_em := old.aprovado_em; new.aprovado_nome := old.aprovado_nome; new.aprovado_meta := old.aprovado_meta;
    new.dados := coalesce(new.dados, '{}'::jsonb) || jsonb_build_object(
      'assCliente', old.dados->'assCliente', 'assData', old.dados->'assData', 'assEmIso', old.dados->'assEmIso',
      'assNome', old.dados->'assNome', 'assVia', old.dados->'assVia');
    if new.status in ('rascunho','enviado') then new.status := 'aprovado'; end if;
  end if;
  return new;
end $$;

revoke execute on function public.orc_remover_aprovacao(uuid) from anon, public;
grant execute on function public.orc_remover_aprovacao(uuid) to authenticated;

commit;
