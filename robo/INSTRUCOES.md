# Robô de pesquisa de preços (Manaus)

Procedimento que o agente segue toda semana. Ele roda na nuvem do Claude, **não** acessa o
Supabase: só pesquisa na internet e grava o resultado neste repositório. O dono vê os achados
no módulo **Cotações → 🤖 Internet** e escolhe o que guardar no histórico de preços.

## Passo a passo

1. Clone/atualize o repositório `AmassaPatoo/tms-carretas` (branch `main`).
2. Leia `robo/itens.json`. Para **cada item**, pesquise em **dois grupos** (os dois são obrigatórios):

   **A) 📍 Manaus** — o que dá para comprar na cidade:
   - buscas como `<termo> Manaus`, `<termo> preço Manaus`, `<termo> loja Manaus`, `<termo> OLX Manaus`, `<termo> Bemol`;
   - lojas de Manaus com site, catálogo, Instagram/Facebook ou WhatsApp com preço; Bemol; OLX e Facebook Marketplace
     (região de Manaus); anúncios do Mercado Livre de vendedores **localizados em Manaus**.
   - **Lojas de Manaus que publicam preço no site** (comece por elas):
     Cocil Home Center (cocil.com.br e www.cocil.com.br — São Geraldo/Coroado), Beny Lar e Construção (beny.com.br),
     Lobato Casa e Construção (lojalobato.com.br), Casinova Home Center (casinova.com.br),
     Loja Constroi (lojaconstroi.com.br), O Construtor (oconstrutor.com.br), Nono do Gesso (nonodogesso.com.br, drywall).
     Use buscas com `site:` (ex.: `site:cocil.com.br manta líquida`). Página com cara de antiga → avise em `obs` ("confirmar preço").
   - Marque `"local": "Manaus"` (com o bairro em `obs` quando aparecer). Usado/seminovo → diga "usado" em `obs`.

   **B) 🌐 Fora (internet / nacional)** — para ter noção do preço de fora:
   - **Mercado Livre**, **Amazon**, Magazine Luiza, Shopee, MadeiraMadeira, Leroy Merlin, Telhanorte, Casas Bahia.
   - Buscas como `<termo> Mercado Livre`, `<termo> preço`. Para a **Amazon**, a busca comum quase não traz resultados:
     use a busca restrita ao domínio amazon.com.br (ex.: WebSearch com allowed_domains=["amazon.com.br"]).
   - Marque `"local": "online"`. Se a página mostrar **frete ou prazo para Manaus** (CEP 69000-000), anote em `frete_manaus`
     (ex.: "frete R$ 45, 12 dias" ou "não entrega no AM"); se não mostrar, deixe vazio.

   - Abra a página (WebFetch) quando o trecho da busca não mostrar o preço com clareza.
   - Meta: até **5 ofertas de Manaus** e até **6 de fora** por item (o que existir de verdade).
   - Se não achar nada de Manaus para um item, diga isso em `nota` ("sem preço publicado em Manaus").
3. Para cada oferta **com preço visível**, anote:
   - `loja` (nome da loja ou do site; no marketplace, `"Mercado Livre – <vendedor>"`, `"Amazon – <vendedor>"`),
   - `titulo` (nome do anúncio, curto), `url`,
   - `preco` (o preço anunciado, número), `oferta_un` (o que esse preço compra: "caixa 2,5 m²", "balde 4 kg"…),
   - `preco_unidade`: o preço convertido para a `unidade` do item **só quando a conta é clara**
     (ex.: caixa de 2,5 m² a R$ 200 → 80,00 por m²). Se não der para converter com segurança, use `null`,
   - `local`: `"Manaus"` ou `"online"` (ver acima),
   - `frete_manaus`: texto curto ou vazio,
   - `obs`: preço no Pix, promoção, marca, bairro etc. (curto).
4. **Nunca invente preço.** Sem preço visível → não entra. Preço de outro produto → não entra.
   Se um item não tiver nada confiável, deixe `ofertas: []` e explique em `nota`.
5. Grave `robo/achados.json` neste formato (e uma cópia em `robo/historico/AAAA-MM-DD.json`):

```json
{
  "atualizado_em": "2026-11-23T10:00:00-04:00",
  "itens": [
    {
      "termo": "Piso vinílico colado 2 mm",
      "unidade": "m²",
      "nota": "",
      "ofertas": [
        { "loja": "Magazine Luiza", "titulo": "Piso vinílico ...", "url": "https://...",
          "preco": 57.59, "oferta_un": "m²", "preco_unidade": 57.59, "local": "online",
          "frete_manaus": "", "obs": "preço no Pix", "data": "2026-11-23" }
      ]
    }
  ]
}
```

6. Valide o JSON: `python3 -c "import json;json.load(open('robo/achados.json'))"`.
7. Faça commit **só** dos arquivos de `robo/` com a mensagem
   `Robô: preços da internet de AAAA-MM-DD` e dê push na `main`.
   (Não altere nenhum outro arquivo do sistema.)
8. Termine com um resumo curto: por item, o menor preço em Manaus e o menor de fora (com a loja) e a diferença em %,
   e os itens sem resultado.
