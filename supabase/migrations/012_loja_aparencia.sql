-- =====================================================================
--  PLATAFORMA KE — 012: APARÊNCIA DO SITE (imagens do topo e do rodapé)
--  Rodar DEPOIS da 011, no SQL Editor do Supabase (colar tudo → Run).
--  Pode ser rodado de novo sem erro.
--
--  loj_config.tema guarda o que a equipe escolhe em "⚙️ Site → Aparência":
--  { "topo":   { "imagens": [...], "escurecer": 45, "titulo": "...", "frase": "..." },
--    "rodape": { "imagens": [...], "escurecer": 55, "texto": "..." } }
-- =====================================================================

begin;

alter table public.loj_config add column if not exists tema jsonb not null default '{}'::jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loj_config_tema_tamanho') then
    alter table public.loj_config add constraint loj_config_tema_tamanho
      check (jsonb_typeof(tema) = 'object' and length(tema::text) <= 10000);
  end if;
end $$;

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
      'reserva_min', c.reserva_min, 'tema', c.tema, 'versao', (select versao from public.loj_config where empresa_id = c.empresa_id)),
    'produtos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoria', p.categoria, 'nome', p.nome, 'unidade', p.unidade, 'preco', p.preco,
        'disponivel', greatest(0, p.estoque - p.reservado), 'descricao', p.descricao, 'tecnico', p.tecnico,
        'beneficios', p.beneficios, 'cuidados', p.cuidados, 'fotos', to_jsonb(p.fotos)) order by p.ordem, p.nome)
      from public.loj_produtos p where p.empresa_id = c.empresa_id and p.publicado), '[]'::jsonb),
    'obras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'titulo', o.titulo, 'tipo', o.tipo, 'local', o.local, 'area', o.area, 'prazo', o.prazo,
        'descricao', o.descricao, 'fotos', to_jsonb(o.fotos), 'videos', to_jsonb(o.videos), 'produtos', to_jsonb(o.produtos)) order by o.criado_em desc)
      from public.loj_obras o where o.empresa_id = c.empresa_id and o.publicado), '[]'::jsonb));
end $$;


commit;
