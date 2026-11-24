-- =====================================================================
--  PLATAFORMA KE — 008: CONSULTA À SEFAZ PELO BANCO (SP e Ambiente Nacional)
--  Rodar no SQL Editor do Supabase (colar tudo → Run). Pode rodar de novo.
--
--  A SEFAZ-SP e o Ambiente Nacional pedem o certificado digital no meio da
--  conexão (renegociação TLS). O servidor das Edge Functions não atende isso;
--  a extensão "http" do banco (libcurl/OpenSSL) atende.
--  - O certificado fica no cofre do Supabase (Vault), copiado pela função
--    "sefaz" a partir dos segredos SEFAZ_CERT_PFX/SEFAZ_CERT_SENHA.
--  - Só a função "sefaz" (chave de serviço) pode usar estas funções.
--  Observação: a extensão não consegue usar a lista de ACs da ICP-Brasil, então
--  o certificado do servidor da SEFAZ não é conferido aqui (o nome é); a
--  identificação da empresa continua pelo certificado digital.
-- =====================================================================

begin;

create extension if not exists http with schema extensions;

-- guarda/atualiza o certificado (PEM) no cofre; devolve a "impressão" para conferência
create or replace function public.sefaz_cert_sincronizar(p_cert text, p_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_cert !~ '-----BEGIN CERTIFICATE-----' or p_key !~ '-----BEGIN (RSA |EC )?PRIVATE KEY-----' then
    raise exception 'Certificado em formato inválido'; end if;
  select id into v_id from vault.secrets where name = 'sefaz_cert_pem';
  if v_id is null then perform vault.create_secret(p_cert, 'sefaz_cert_pem', 'Certificado A1 da empresa (SEFAZ)');
  else perform vault.update_secret(v_id, p_cert); end if;
  v_id := null;
  select id into v_id from vault.secrets where name = 'sefaz_key_pem';
  if v_id is null then perform vault.create_secret(p_key, 'sefaz_key_pem', 'Chave do certificado A1 (SEFAZ)');
  else perform vault.update_secret(v_id, p_key); end if;
  return md5(p_cert || p_key);
end $$;

create or replace function public.sefaz_cert_impressao()
returns text language sql stable security definer set search_path = '' as $$
  select md5(c.decrypted_secret || k.decrypted_secret)
  from vault.decrypted_secrets c, vault.decrypted_secrets k
  where c.name = 'sefaz_cert_pem' and k.name = 'sefaz_key_pem'
$$;

-- envia um pedido SOAP à SEFAZ com o certificado e devolve {status, corpo}
create or replace function public.sefaz_soap_banco(p_url text, p_corpo text, p_tipo text default 'application/soap+xml; charset=utf-8')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cert text; v_key text; r extensions.http_response;
begin
  if p_url !~ '^https://[a-z0-9.-]+\.gov\.br/[A-Za-z0-9/_.-]*$' then raise exception 'Endereço não permitido'; end if;
  if length(p_corpo) > 200000 then raise exception 'Pedido grande demais'; end if;
  select decrypted_secret into v_cert from vault.decrypted_secrets where name = 'sefaz_cert_pem';
  select decrypted_secret into v_key  from vault.decrypted_secrets where name = 'sefaz_key_pem';
  if v_cert is null or v_key is null then raise exception 'Certificado ainda não copiado para o cofre'; end if;
  perform extensions.http_set_curlopt('CURLOPT_SSLCERT_BLOB', v_cert);
  perform extensions.http_set_curlopt('CURLOPT_SSLKEY_BLOB', v_key);
  perform extensions.http_set_curlopt('CURLOPT_SSL_VERIFYPEER', '0');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  begin
    r := extensions.http(('POST', p_url, array[]::extensions.http_header[], p_tipo, p_corpo)::extensions.http_request);
  exception when others then
    perform extensions.http_reset_curlopt();
    raise;
  end;
  perform extensions.http_reset_curlopt();
  return jsonb_build_object('status', r.status, 'corpo', r.content);
end $$;

revoke all on function public.sefaz_cert_sincronizar(text, text), public.sefaz_cert_impressao(), public.sefaz_soap_banco(text, text, text)
  from public, anon, authenticated;
grant execute on function public.sefaz_cert_sincronizar(text, text), public.sefaz_cert_impressao(), public.sefaz_soap_banco(text, text, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
