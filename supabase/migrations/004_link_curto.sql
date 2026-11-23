-- =====================================================================
--  PLATAFORMA KE — 004: LINK DE APROVAÇÃO MAIS CURTO
--  Rodar DEPOIS da 003, no SQL Editor (colar tudo → Run).
--
--  Links novos passam a ter 16 letras/números (ex.: Xk7pQ2mZr9aT4bW1)
--  em vez de 64. Continuam impossíveis de adivinhar (≈ 95 bits).
--  Os links já enviados continuam funcionando.
-- =====================================================================

begin;

-- código aleatório de 16 caracteres (letras maiúsculas, minúsculas e números)
create or replace function public.orc_codigo_curto()
returns text language plpgsql volatile as $$
declare
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';  -- sem 0/O, 1/l/I
  b bytea := uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid());
  r text := ''; i int;
begin
  -- usa só bytes totalmente aleatórios (pula os bits fixos de versão do UUID)
  foreach i in array array[0,1,2,3,4,5,7,9,10,11,12,13,14,15,16,17] loop
    r := r || substr(alfabeto, (get_byte(b, i) % length(alfabeto)) + 1, 1);
  end loop;
  return r;
end $$;

create or replace function public.orc_gerar_link(p_orcamento uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_tok text; tentativa int := 0;
begin
  select empresa_id, link_token into v_emp, v_tok from public.orc_orcamentos where id = p_orcamento;
  if v_emp is null then raise exception 'Orçamento não encontrado. Preencha e salve antes de gerar o link.'; end if;
  if not (public.core_modulo_liberado(v_emp, 'orcamentos') or public.core_e_admin()) then
    raise exception 'Sem permissão para este orçamento'; end if;
  if v_tok is null then
    loop
      v_tok := public.orc_codigo_curto();
      exit when not exists (select 1 from public.orc_orcamentos where link_token = v_tok);
      tentativa := tentativa + 1; if tentativa > 5 then raise exception 'Tente de novo'; end if;
    end loop;
    update public.orc_orcamentos set link_token = v_tok, link_criado_em = now() where id = p_orcamento;
  end if;
  return v_tok;
end $$;

-- aceita os códigos curtos (16) e os antigos (64)
create or replace function public.orc_publico_ver(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o public.orc_orcamentos%rowtype; e public.core_empresas%rowtype; v_dias int; v_validade date;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
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
  select * into o from public.orc_orcamentos where link_token = p_token and p_token is not null and length(p_token) >= 16 for update;
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

revoke execute on function public.orc_codigo_curto() from anon, public;

commit;
