# Robô de pesquisa de preços (Manaus)

Procedimento que o agente segue toda semana. Ele roda na nuvem do Claude, **não** acessa o
Supabase: só pesquisa na internet e grava o resultado neste repositório. O dono vê os achados
no módulo **Cotações → 🤖 Internet** e escolhe o que guardar no histórico de preços.

## Passo a passo

1. Clone/atualize o repositório `AmassaPatoo/tms-carretas` (branch `main`).
2. Leia `robo/itens.json`. Para **cada item**:
   - Pesquise na web (WebSearch) pelo menos 2 buscas diferentes, por exemplo:
     `"<termo>" preço Manaus`, `<termo> preço`, `<termo> Bemol`, `<termo> OLX Manaus`.
   - Fontes úteis: lojas de Manaus com site ou catálogo com preço, Bemol, OLX (região de Manaus),
     Mercado Livre, Magazine Luiza, Leroy Merlin, Telhanorte, Amazon, Shopee.
   - Abra a página (WebFetch) quando o trecho da busca não mostrar o preço com clareza.
3. Para cada oferta **com preço visível** (até 8 por item), anote:
   - `loja` (nome da loja ou do site; no marketplace, `"Mercado Livre – <vendedor>"`),
   - `titulo` (nome do anúncio, curto), `url`,
   - `preco` (o preço anunciado, número), `oferta_un` (o que esse preço compra: "caixa 2,5 m²", "balde 4 kg"…),
   - `preco_unidade`: o preço convertido para a `unidade` do item **só quando a conta é clara**
     (ex.: caixa de 2,5 m² a R$ 200 → 80,00 por m²). Se não der para converter com segurança, use `null`,
   - `local`: `"Manaus"` se a loja/anúncio é de Manaus; senão `"online"`,
   - `obs`: frete para Manaus, preço no Pix, promoção, etc. (curto).
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
          "obs": "preço no Pix", "data": "2026-11-23" }
      ]
    }
  ]
}
```

6. Valide o JSON: `python3 -c "import json;json.load(open('robo/achados.json'))"`.
7. Faça commit **só** dos arquivos de `robo/` com a mensagem
   `Robô: preços da internet de AAAA-MM-DD` e dê push na `main`.
   (Não altere nenhum outro arquivo do sistema.)
8. Termine com um resumo curto: quantos itens tiveram ofertas, o menor preço por item e os itens sem resultado.
