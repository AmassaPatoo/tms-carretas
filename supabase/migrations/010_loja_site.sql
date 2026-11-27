-- =====================================================================
--  PLATAFORMA KE — 010: MÓDULO LOJA / SITE (vitrine pública em tempo real)
--  Rodar DEPOIS da 009, no SQL Editor do Supabase (colar tudo → Run).
--  Pode ser rodado de novo sem erro.
--
--  • A equipe cadastra materiais (preço, estoque, fotos), obras e textos
--    no módulo "Loja / Site" da plataforma.
--  • O site público (site/?l=SLUG) lê tudo pelo banco, SEM login, e
--    atualiza sozinho quando algo muda (Supabase Realtime).
--  • Pedido do site reserva o estoque por 15 minutos; pedido de orçamento
--    vira um orçamento no módulo Orçamentos com um toque.
--  • O visitante NUNCA lê as tabelas diretamente: só pelas funções
--    loj_publico_*, que devolvem apenas o que pode ser mostrado.
--
--  Depois de rodar: em Administração, ligue "Loja / Site" na empresa.
-- =====================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------

-- Configuração do site de cada empresa (1 linha por empresa)
create table if not exists public.loj_config (
  empresa_id    uuid primary key references public.core_empresas(id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  publicado     boolean not null default false,
  nome          text check (length(nome) <= 80),
  cidade        text check (length(cidade) <= 80),
  frase         text check (length(frase) <= 160),
  whatsapp      text check (whatsapp ~ '^\d{10,13}$' or whatsapp is null),
  pix_chave     text check (length(pix_chave) <= 77),
  pix_nome      text check (length(pix_nome) <= 25),
  pix_cidade    text check (length(pix_cidade) <= 15),
  pix_desconto  numeric(5,2) not null default 0 check (pix_desconto between 0 and 50),
  parcelas      int not null default 3 check (parcelas between 1 and 12),
  reserva_min   int not null default 15 check (reserva_min between 5 and 1440),
  versao        bigint not null default 1,          -- muda a cada alteração: o site recarrega
  atualizado_em timestamptz not null default now()
);

-- Materiais à venda
create table if not exists public.loj_produtos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  categoria     text not null default 'Outros' check (length(categoria) between 1 and 40),
  nome          text not null check (length(nome) between 1 and 120),
  unidade       text not null default 'un' check (length(unidade) between 1 and 12),
  preco         numeric(12,2) not null default 0 check (preco >= 0),
  estoque       numeric(12,2) not null default 0 check (estoque >= 0),
  reservado     numeric(12,2) not null default 0,   -- calculado pelos pedidos em aberto
  descricao     text check (length(descricao) <= 600),
  tecnico       text check (length(tecnico) <= 1500),
  beneficios    text check (length(beneficios) <= 1500),
  cuidados      text check (length(cuidados) <= 1500),
  fotos         text[] not null default '{}' check (cardinality(fotos) <= 8),
  publicado     boolean not null default true,
  ordem         int not null default 100,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists loj_produtos_emp_idx on public.loj_produtos(empresa_id, ordem, nome);

-- Obras realizadas (portfólio)
create table if not exists public.loj_obras (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  titulo        text not null check (length(titulo) between 1 and 120),
  tipo          text not null default 'Reforma completa' check (length(tipo) <= 60),
  local         text not null check (length(local) between 1 and 120),
  area          text check (length(area) <= 40),
  prazo         text check (length(prazo) <= 40),
  descricao     text check (length(descricao) <= 2000),
  fotos         text[] not null default '{}' check (cardinality(fotos) between 1 and 12),
  produtos      uuid[] not null default '{}',
  publicado     boolean not null default true,
  autorizado    boolean not null default false check (autorizado),   -- autorização do cliente para publicar
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists loj_obras_emp_idx on public.loj_obras(empresa_id, criado_em desc);

-- Pedidos feitos no site
create table if not exists public.loj_pedidos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  codigo        text not null unique,
  cliente_nome  text not null check (length(cliente_nome) between 2 and 100),
  telefone      text not null check (telefone ~ '^\d{10,11}$'),
  entrega       text not null default 'Retirada' check (entrega in ('Retirada','Entrega')),
  endereco      text check (length(endereco) <= 300),
  itens         jsonb not null,                     -- [{id,nome,unidade,qtd,preco}]
  subtotal      numeric(12,2) not null,
  total         numeric(12,2) not null,
  metodo        text not null check (metodo in ('pix','cartao')),
  status        text not null default 'aguardando'
                check (status in ('aguardando','pago','separando','pronto','entregue','cancelado','expirado')),
  expira_em     timestamptz not null,
  conferidos    int[] not null default '{}',        -- itens já separados (índices)
  obs_interna   text check (length(obs_interna) <= 1000),
  cliente_id    uuid references public.core_clientes(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists loj_pedidos_emp_idx on public.loj_pedidos(empresa_id, criado_em desc);
create index if not exists loj_pedidos_abertos_idx on public.loj_pedidos(empresa_id, status, expira_em);

-- Pedidos de orçamento / instalação feitos no site
create table if not exists public.loj_solicitacoes (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.core_empresas(id) on delete cascade,
  codigo        text not null unique,
  nome          text not null check (length(nome) between 2 and 100),
  telefone      text not null check (telefone ~ '^\d{10,11}$'),
  bairro        text not null check (length(bairro) between 2 and 120),
  servico       text not null check (length(servico) between 2 and 120),
  modalidade    text not null default 'Material + instalação'
                check (modalidade in ('Material + instalação','Somente instalação','Somente material')),
  area          numeric(10,2) check (area >= 0 and area <= 100000),
  detalhes      text check (length(detalhes) <= 2000),
  produto_id    uuid references public.loj_produtos(id) on delete set null,
  obra_id       uuid references public.loj_obras(id) on delete set null,
  status        text not null default 'nova' check (status in ('nova','em_orcamento','descartada')),
  orcamento_id  uuid references public.orc_orcamentos(id) on delete set null,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists loj_solicitacoes_emp_idx on public.loj_solicitacoes(empresa_id, criado_em desc);

-- atualizado_em automático
do $$
declare t text;
begin
  foreach t in array array['loj_config','loj_produtos','loj_obras','loj_pedidos','loj_solicitacoes'] loop
    execute format('drop trigger if exists %I_atualizado on public.%I', t, t);
    execute format('create trigger %I_atualizado before update on public.%I
                    for each row execute function public.core_toca_atualizado()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. REGRAS DO NEGÓCIO (no banco, valem para o app e para o site)
-- ---------------------------------------------------------------------

-- Telefone só com dígitos, sem o 55 do país
create or replace function public.loj_fone(p text)
returns text language sql immutable as $$
  select case when d ~ '^55\d{10,11}$' then substr(d, 3) when d ~ '^\d{10,11}$' then d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Código curto e difícil de adivinhar (só letras e números: serve de txid do Pix)
create or replace function public.loj_codigo(p_prefixo text)
returns text language sql volatile as $$
  select p_prefixo || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
$$;

-- Reservado = soma dos pedidos em aberto. Recalcula os produtos indicados.
create or replace function public.loj_recalcular_reserva(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update public.loj_produtos p
     set reservado = coalesce((
           select sum((i->>'qtd')::numeric)
             from public.loj_pedidos o, jsonb_array_elements(o.itens) i
            where o.empresa_id = p.empresa_id
              and o.status in ('aguardando','pago','separando','pronto')
              and i->>'id' = p.id::text), 0)
   where p.id = any(p_ids)
$$;

-- Pedido aguardando pagamento que passou do prazo → expirado (libera o estoque)
create or replace function public.loj_expirar(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.loj_pedidos set status = 'expirado'
   where empresa_id = p_empresa and status = 'aguardando' and expira_em < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Antes de mudar o status: só os caminhos permitidos
create or replace function public.loj_pedidos_antes()
returns trigger language plpgsql as $$
declare
  permitido jsonb := '{"aguardando":["pago","cancelado","expirado"],"pago":["separando","cancelado"],
                       "separando":["pronto","pago","cancelado"],"pronto":["entregue","separando","cancelado"]}';
  r record;
begin
  if tg_op = 'UPDATE' then
    if new.itens is distinct from old.itens or new.total is distinct from old.total
       or new.subtotal is distinct from old.subtotal or new.codigo is distinct from old.codigo then
      raise exception 'Itens e valores do pedido não podem ser alterados. Cancele e faça outro.';
    end if;
    if new.status is distinct from old.status then
      if not coalesce((permitido -> old.status) ? new.status, false) then
        raise exception 'Não é possível passar o pedido de "%" para "%".', old.status, new.status;
      end if;
      if new.status = 'pronto' and cardinality(new.conferidos) < jsonb_array_length(new.itens) then
        raise exception 'Confira todos os itens antes de concluir a separação.';
      end if;
      if new.status = 'entregue' then
        for r in select i->>'nome' nome, (i->>'qtd')::numeric qtd, p.estoque
                   from jsonb_array_elements(new.itens) i
                   left join public.loj_produtos p on p.id::text = i->>'id'
        loop
          if r.estoque is null or r.estoque < r.qtd then
            raise exception 'Estoque físico insuficiente de "%" (tem %, pedido %). Ajuste o estoque antes.', r.nome, coalesce(r.estoque, 0), r.qtd;
          end if;
        end loop;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists loj_pedidos_antes on public.loj_pedidos;
create trigger loj_pedidos_antes before insert or update on public.loj_pedidos
  for each row execute function public.loj_pedidos_antes();

-- Depois: recalcula reservas e dá baixa no estoque na entrega
create or replace function public.loj_pedidos_depois()
returns trigger language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(distinct (i->>'id')::uuid) into ids
    from jsonb_array_elements(coalesce(new.itens, '[]'::jsonb) || coalesce(old.itens, '[]'::jsonb)) i;
  if tg_op = 'UPDATE' and new.status = 'entregue' and old.status <> 'entregue' then
    update public.loj_produtos p set estoque = p.estoque - x.qtd
      from (select (i->>'id')::uuid id, sum((i->>'qtd')::numeric) qtd from jsonb_array_elements(new.itens) i group by 1) x
     where p.id = x.id;
  end if;
  if tg_op = 'INSERT' or tg_op = 'DELETE' or new.status is distinct from old.status then
    perform public.loj_recalcular_reserva(ids);
  end if;
  return null;
end $$;
drop trigger if exists loj_pedidos_depois on public.loj_pedidos;
create trigger loj_pedidos_depois after insert or update or delete on public.loj_pedidos
  for each row execute function public.loj_pedidos_depois();

-- Qualquer mudança em produtos ou obras avisa o site (versão nova → realtime)
create or replace function public.loj_avisar_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.loj_config set versao = versao + 1
   where empresa_id = coalesce(new.empresa_id, old.empresa_id);
  return null;
end $$;
drop trigger if exists loj_produtos_avisa on public.loj_produtos;
create trigger loj_produtos_avisa after insert or update or delete on public.loj_produtos
  for each row execute function public.loj_avisar_site();
drop trigger if exists loj_obras_avisa on public.loj_obras;
create trigger loj_obras_avisa after insert or update or delete on public.loj_obras
  for each row execute function public.loj_avisar_site();

-- Mudança feita pela equipe na config também troca a versão
create or replace function public.loj_config_versao()
returns trigger language plpgsql as $$
begin
  if new.versao = old.versao then new.versao := old.versao + 1; end if;
  return new;
end $$;
drop trigger if exists loj_config_versao on public.loj_config;
create trigger loj_config_versao before update on public.loj_config
  for each row execute function public.loj_config_versao();

-- ---------------------------------------------------------------------
-- 3. FUNÇÕES PÚBLICAS (site, sem login)
-- ---------------------------------------------------------------------

-- Catálogo completo da loja
create or replace function public.loj_publico_loja(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loj_config%rowtype;
begin
  select * into c from public.loj_config where slug = lower(trim(p_slug)) and publicado;
  if not found then return null; end if;
  if not exists (select 1 from public.core_empresas e
                   join public.core_empresa_modulos em on em.empresa_id = e.id and em.modulo = 'loja' and em.ativo
                  where e.id = c.empresa_id and e.ativo) then return null; end if;
  perform public.loj_expirar(c.empresa_id);
  return jsonb_build_object(
    'loja', jsonb_build_object('id', c.empresa_id, 'slug', c.slug,
      'nome', coalesce(nullif(c.nome, ''), (select nome from public.core_empresas where id = c.empresa_id)),
      'cidade', c.cidade, 'frase', c.frase, 'whatsapp', c.whatsapp,
      'pix', coalesce(c.pix_chave, '') <> '', 'pix_desconto', c.pix_desconto, 'parcelas', c.parcelas,
      'reserva_min', c.reserva_min, 'versao', (select versao from public.loj_config where empresa_id = c.empresa_id)),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoria', p.categoria, 'nome', p.nome, 'unidade', p.unidade, 'preco', p.preco,
        'disponivel', greatest(0, p.estoque - p.reservado), 'descricao', p.descricao, 'tecnico', p.tecnico,
        'beneficios', p.beneficios, 'cuidados', p.cuidados, 'fotos', to_jsonb(p.fotos)) order by p.ordem, p.nome)
      from public.loj_produtos p where p.empresa_id = c.empresa_id and p.publicado), '[]'::jsonb),
    'obras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'titulo', o.titulo, 'tipo', o.tipo, 'local', o.local, 'area', o.area, 'prazo', o.prazo,
        'descricao', o.descricao, 'fotos', to_jsonb(o.fotos), 'produtos', to_jsonb(o.produtos)) order by o.criado_em desc)
      from public.loj_obras o where o.empresa_id = c.empresa_id and o.publicado), '[]'::jsonb));
end $$;

-- Criar pedido (reserva o estoque)
create or replace function public.loj_publico_pedido(p_slug text, p_cliente jsonb, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.loj_config%rowtype; p public.loj_produtos%rowtype; r record;
  v_fone text := public.loj_fone(p_cliente->>'telefone');
  v_nome text := trim(coalesce(p_cliente->>'nome', ''));
  v_entrega text := coalesce(p_cliente->>'entrega', 'Retirada');
  v_end text := nullif(trim(coalesce(p_cliente->>'endereco', '')), '');
  v_metodo text := coalesce(p_cliente->>'metodo', 'pix');
  v_itens jsonb := '[]'; v_sub numeric := 0; v_total numeric; v_qtd numeric; v_cod text; v_exp timestamptz;
begin
  select * into c from public.loj_config where slug = lower(trim(p_slug)) and publicado;
  if not found then raise exception 'Loja indisponível no momento.'; end if;
  if length(v_nome) < 2 or length(v_nome) > 100 then raise exception 'Informe seu nome.'; end if;
  if v_fone is null then raise exception 'Informe o WhatsApp com DDD.'; end if;
  if v_entrega not in ('Retirada','Entrega') then raise exception 'Forma de recebimento inválida.'; end if;
  if v_entrega = 'Entrega' and (v_end is null or length(v_end) < 5) then raise exception 'Informe o endereço de entrega.'; end if;
  if v_metodo not in ('pix','cartao') then raise exception 'Forma de pagamento inválida.'; end if;
  if v_metodo = 'pix' and coalesce(c.pix_chave, '') = '' then raise exception 'Pagamento por Pix ainda não está disponível.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 or jsonb_array_length(p_itens) > 40 then
    raise exception 'Carrinho vazio ou grande demais.'; end if;

  perform public.loj_expirar(c.empresa_id);
  if (select count(*) from public.loj_pedidos
       where empresa_id = c.empresa_id and telefone = v_fone and status = 'aguardando') >= 3 then
    raise exception 'Você já tem 3 pedidos aguardando pagamento. Pague ou aguarde expirarem.';
  end if;

  for r in select e->>'id' as id, sum(round((e->>'qtd')::numeric, 2)) as qtd
             from jsonb_array_elements(p_itens) e group by 1 order by 1 loop
    if r.id !~ '^[0-9a-f-]{36}$' then raise exception 'Produto inválido.'; end if;
    select * into p from public.loj_produtos where id = r.id::uuid and empresa_id = c.empresa_id and publicado for update;
    if not found then raise exception 'Um dos produtos não está mais disponível. Atualize a página.'; end if;
    v_qtd := r.qtd;
    if v_qtd is null or v_qtd <= 0 or v_qtd > 100000 then raise exception 'Quantidade inválida de "%".', p.nome; end if;
    if v_qtd > p.estoque - p.reservado then
      raise exception '"%": só temos % % disponíveis agora.', p.nome, greatest(0, p.estoque - p.reservado), p.unidade;
    end if;
    v_itens := v_itens || jsonb_build_object('id', p.id, 'nome', p.nome, 'unidade', p.unidade, 'qtd', v_qtd, 'preco', p.preco);
    v_sub := v_sub + round(p.preco * v_qtd, 2);
  end loop;

  v_total := case when v_metodo = 'pix' then round(v_sub * (1 - c.pix_desconto / 100), 2) else v_sub end;
  v_exp := now() + make_interval(mins => c.reserva_min);
  loop
    v_cod := public.loj_codigo('KE');
    exit when not exists (select 1 from public.loj_pedidos where codigo = v_cod);
  end loop;
  insert into public.loj_pedidos (empresa_id, codigo, cliente_nome, telefone, entrega, endereco, itens, subtotal, total, metodo, expira_em)
  values (c.empresa_id, v_cod, v_nome, v_fone, v_entrega, case when v_entrega = 'Entrega' then v_end end, v_itens, v_sub, v_total, v_metodo, v_exp);

  return jsonb_build_object('codigo', v_cod, 'subtotal', v_sub, 'total', v_total, 'metodo', v_metodo, 'expira_em', v_exp,
    'itens', v_itens, 'whatsapp', c.whatsapp,
    'pix', case when v_metodo = 'pix' then jsonb_build_object('chave', c.pix_chave,
             'nome', coalesce(nullif(c.pix_nome, ''), left(coalesce(c.nome, 'RECEBEDOR'), 25)),
             'cidade', coalesce(nullif(c.pix_cidade, ''), left(coalesce(c.cidade, 'MANAUS'), 15))) end);
end $$;

-- Consultar pedido (código + WhatsApp)
create or replace function public.loj_publico_consultar(p_slug text, p_codigo text, p_telefone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.loj_config%rowtype; o public.loj_pedidos%rowtype;
begin
  select * into c from public.loj_config where slug = lower(trim(p_slug)) and publicado;
  if not found then return null; end if;
  perform public.loj_expirar(c.empresa_id);
  select * into o from public.loj_pedidos
   where empresa_id = c.empresa_id and codigo = upper(trim(p_codigo)) and telefone = public.loj_fone(p_telefone);
  if not found then return null; end if;
  return jsonb_build_object('codigo', o.codigo, 'status', o.status, 'total', o.total, 'subtotal', o.subtotal,
    'metodo', o.metodo, 'entrega', o.entrega, 'itens', o.itens, 'criado_em', o.criado_em, 'expira_em', o.expira_em,
    'whatsapp', c.whatsapp,
    'pix', case when o.metodo = 'pix' and o.status = 'aguardando' then jsonb_build_object('chave', c.pix_chave,
             'nome', coalesce(nullif(c.pix_nome, ''), left(coalesce(c.nome, 'RECEBEDOR'), 25)),
             'cidade', coalesce(nullif(c.pix_cidade, ''), left(coalesce(c.cidade, 'MANAUS'), 15))) end);
end $$;

-- Pedido de orçamento / instalação
create or replace function public.loj_publico_solicitar(p_slug text, p_dados jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  c public.loj_config%rowtype; v_cod text;
  v_fone text := public.loj_fone(p_dados->>'telefone');
  v_nome text := trim(coalesce(p_dados->>'nome', ''));
  v_bairro text := trim(coalesce(p_dados->>'bairro', ''));
  v_serv text := trim(coalesce(p_dados->>'servico', ''));
  v_mod text := coalesce(nullif(p_dados->>'modalidade', ''), 'Material + instalação');
  v_area numeric; v_prod uuid; v_obra uuid;
begin
  select * into c from public.loj_config where slug = lower(trim(p_slug)) and publicado;
  if not found then raise exception 'Loja indisponível no momento.'; end if;
  if length(v_nome) < 2 or length(v_nome) > 100 then raise exception 'Informe seu nome.'; end if;
  if v_fone is null then raise exception 'Informe o WhatsApp com DDD.'; end if;
  if length(v_bairro) < 2 or length(v_bairro) > 120 then raise exception 'Informe o bairro.'; end if;
  if length(v_serv) < 2 or length(v_serv) > 120 then raise exception 'Informe o serviço.'; end if;
  if v_mod not in ('Material + instalação','Somente instalação','Somente material') then raise exception 'Modalidade inválida.'; end if;
  if coalesce(p_dados->>'area', '') ~ '^\d{1,6}([.,]\d{1,2})?$' then v_area := replace(p_dados->>'area', ',', '.')::numeric; end if;
  if coalesce(p_dados->>'produto', '') ~ '^[0-9a-f-]{36}$' then
    select id into v_prod from public.loj_produtos where id = (p_dados->>'produto')::uuid and empresa_id = c.empresa_id; end if;
  if coalesce(p_dados->>'obra', '') ~ '^[0-9a-f-]{36}$' then
    select id into v_obra from public.loj_obras where id = (p_dados->>'obra')::uuid and empresa_id = c.empresa_id; end if;
  if (select count(*) from public.loj_solicitacoes
       where empresa_id = c.empresa_id and telefone = v_fone and criado_em > now() - interval '1 day') >= 5 then
    raise exception 'Recebemos vários pedidos deste WhatsApp hoje. Aguarde nosso contato.';
  end if;
  loop
    v_cod := public.loj_codigo('OR');
    exit when not exists (select 1 from public.loj_solicitacoes where codigo = v_cod);
  end loop;
  insert into public.loj_solicitacoes (empresa_id, codigo, nome, telefone, bairro, servico, modalidade, area, detalhes, produto_id, obra_id)
  values (c.empresa_id, v_cod, v_nome, v_fone, v_bairro, v_serv, v_mod, v_area,
          nullif(left(trim(coalesce(p_dados->>'detalhes', '')), 2000), ''), v_prod, v_obra);
  return v_cod;
end $$;

-- Equipe: expira pedidos vencidos (o módulo chama ao abrir)
create or replace function public.loj_expirar_minha(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not (public.core_modulo_liberado(p_empresa, 'loja') or public.core_e_admin()) then return 0; end if;
  return public.loj_expirar(p_empresa);
end $$;

-- ---------------------------------------------------------------------
-- 4. REGRAS DE ACESSO (RLS)
-- ---------------------------------------------------------------------
alter table public.loj_config       enable row level security;
alter table public.loj_produtos     enable row level security;
alter table public.loj_obras        enable row level security;
alter table public.loj_pedidos      enable row level security;
alter table public.loj_solicitacoes enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename like 'loj\_%' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "loja: equipe usa" on public.loj_config for all to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());
-- o site só lê a linha da config publicada (é ela que avisa as mudanças em tempo real)
create policy "loja: site vê a config publicada" on public.loj_config for select to anon
  using (publicado);

create policy "loja: equipe usa" on public.loj_produtos for all to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());
create policy "loja: equipe usa" on public.loj_obras for all to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());
-- pedidos e solicitações: só chegam pelo site (funções acima); a equipe lê e altera
create policy "loja: equipe lê" on public.loj_pedidos for select to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());
create policy "loja: equipe altera" on public.loj_pedidos for update to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());
create policy "loja: equipe lê" on public.loj_solicitacoes for select to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());
create policy "loja: equipe altera" on public.loj_solicitacoes for update to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin())
  with check (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());
create policy "loja: equipe apaga" on public.loj_solicitacoes for delete to authenticated
  using (public.core_modulo_liberado(empresa_id, 'loja') or public.core_e_admin());

revoke all on public.loj_config, public.loj_produtos, public.loj_obras, public.loj_pedidos, public.loj_solicitacoes from anon;
grant select on public.loj_config to anon;
grant select, insert, update, delete on public.loj_config, public.loj_produtos, public.loj_obras to authenticated;
grant select, update on public.loj_pedidos to authenticated;
grant select, update, delete on public.loj_solicitacoes to authenticated;

revoke all on function public.loj_recalcular_reserva(uuid[]), public.loj_expirar(uuid) from public, anon, authenticated;
revoke all on function public.loj_publico_loja(text), public.loj_publico_pedido(text, jsonb, jsonb),
                       public.loj_publico_consultar(text, text, text), public.loj_publico_solicitar(text, jsonb),
                       public.loj_expirar_minha(uuid) from public;
grant execute on function public.loj_publico_loja(text), public.loj_publico_pedido(text, jsonb, jsonb),
                          public.loj_publico_consultar(text, text, text), public.loj_publico_solicitar(text, jsonb)
  to anon, authenticated;
grant execute on function public.loj_expirar_minha(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. TEMPO REAL (Supabase Realtime)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['loj_config','loj_pedidos','loj_solicitacoes'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. FOTOS: bucket PÚBLICO 'loja' (fotos aparecem no site)
--    caminho: {empresa_id}/{arquivo}.jpg — só a equipe envia e apaga
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loja', 'loja', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "loja: equipe lê fotos" on storage.objects;
drop policy if exists "loja: equipe envia fotos" on storage.objects;
drop policy if exists "loja: equipe altera fotos" on storage.objects;
drop policy if exists "loja: equipe apaga fotos" on storage.objects;
create policy "loja: equipe lê fotos" on storage.objects for select to authenticated
  using (bucket_id = 'loja' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'loja')));
create policy "loja: equipe envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'loja' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'loja')));
create policy "loja: equipe altera fotos" on storage.objects for update to authenticated
  using (bucket_id = 'loja' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'loja')));
create policy "loja: equipe apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'loja' and (public.core_e_admin() or public.core_modulo_liberado(((storage.foldername(name))[1])::uuid, 'loja')));

-- ---------------------------------------------------------------------
-- 7. REGISTRA O MÓDULO
-- ---------------------------------------------------------------------
insert into public.core_modulos (codigo, nome, descricao, icone, ordem) values
  ('loja', 'Loja / Site', 'Materiais, estoque e obras que aparecem no site em tempo real; pedidos e orçamentos vindos do site', 'store', 12)
on conflict (codigo) do update
  set nome = excluded.nome, descricao = excluded.descricao, icone = excluded.icone, ordem = excluded.ordem;

commit;
