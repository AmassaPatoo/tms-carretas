# Robô de pesquisa de preços — KE Obra Fácil (Manaus/AM)

Você é o robô diário (roda todo dia às 7h31 de Manaus). Ele roda na nuvem do Claude, **não** acessa o Supabase: só pesquisa na internet
e grava o resultado neste repositório. O dono vê os achados no módulo **Cotações → 🤖 Internet**
(comparação **📍 Manaus × 🌐 fora**) e escolhe o que guardar no histórico de preços.

O padrão de qualidade é o da pesquisa de 23/11/2026 (`robo/historico/2026-11-23.json`): ~65 ofertas,
todas com link e preço visível, Manaus e fora separados, conversões corretas e notas úteis.
**Abra esse arquivo antes de começar** e use como modelo.

---

## 0. Preparação
1. Clone/atualize `AmassaPatoo/tms-carretas` (branch `main`).
2. Leia `robo/itens.json` (o que pesquisar, unidade e dica de cada item) e o `achados.json` anterior
   (para saber onde achou preço da última vez — **comece por essas mesmas páginas**, os preços mudam mas as lojas continuam).
3. **Avise o sistema que começou:** grave `robo/status.json` com
   `{"estado": "pesquisando", "inicio": "<agora em ISO, ex. 2026-11-25T07:31:00-04:00>"}`,
   faça commit (`Robô: pesquisando AAAA-MM-DD`) e push **logo no início**, antes de pesquisar.
   A tela do dono mostra "🔄 O robô está pesquisando" enquanto isso.
4. Faça as buscas de itens diferentes **em paralelo** (várias chamadas de WebSearch na mesma vez) para ganhar tempo.

## 1. 📍 Manaus (obrigatório para todo item)

Faça **no mínimo 3 buscas por item** neste grupo, usando `mode: "extended"` nas buscas de Manaus
(elas acham páginas de lojas locais que a busca comum não acha):

| Onde | Como buscar |
|---|---|
| **Cocil Home Center** (São Geraldo / Coroado) — publica preço no site | WebSearch com `allowed_domains: ["cocil.com.br"]` e o nome do item (ex.: `manta líquida 18kg`). Existem dois sites (`www.cocil.com.br` atual e `cocil.com.br` antigo): prefira o `www`; se vier do antigo, escreva "confirmar preço" em `obs`. |
| **Beny, Lobato, Casinova, Loja Constroi** | WebSearch com `allowed_domains: ["beny.com.br","lojalobato.com.br","casinova.com.br","lojaconstroi.com.br"]` |
| **O Construtor, Nono do Gesso (drywall)** | `allowed_domains: ["oconstrutor.com.br","nonodogesso.com.br"]` |
| **OLX Manaus** | `<item> OLX Manaus` (extended). Anúncio de particular: `obs` = "particular"; usado: "usado". |
| **Busca aberta** | `<item> Manaus preço`, `<item> loja Manaus`, `<item> Bemol` (extended) |

Regras de Manaus:
- `"local": "Manaus"` **só** se a loja/anúncio for da cidade. Cuidado: "Manaus" também é **nome de cor** de piso
  (Durafloor Nativa Manaus, Biancogres Manaus) — isso **não** é loja de Manaus.
- Se a loja de Manaus vende o item mas **não mostra preço**, não invente: escreva na `nota`
  (ex.: "A Cocil tem a cola X, mas sem preço no site: peça pela aba Pedir cotação").
- Se só achar uma **marca equivalente** em Manaus (ex.: Cascola no lugar de Tekbond), pode entrar,
  com o título dizendo "(equivalente, não é <marca>)".
- Se não achar nada: `nota` = "Sem preço publicado em Manaus nesta pesquisa."
- Referências de **serviço** em Manaus (ex.: Habitissimo, anúncios de instalação na OLX) não entram como oferta,
  mas valem ouro na `nota` (o dono usa para comparar com os preços dele).

## 2. 🌐 Fora (obrigatório para todo item)

Faça **no mínimo 3 buscas por item**:

| Onde | Como buscar |
|---|---|
| **Amazon** | A busca comum quase nunca traz a Amazon. Use WebSearch com `allowed_domains: ["amazon.com.br"]`. |
| **Mercado Livre** | `<item> Mercado Livre` ou `allowed_domains: ["mercadolivre.com.br"]` |
| **Magalu, MadeiraMadeira, Telhanorte, Leroy Merlin, Casas Bahia/Extra/Ponto Frio, Shopee** | `<item> preço` e, se precisar, `allowed_domains` de cada um |

- `"local": "online"`. Se a página mostrar frete/prazo para Manaus (CEP 69000-000), anote em `frete_manaus`.
  Se mostrar entrega sem dizer o CEP, escreva "entrega R$ X (CEP não informado)".
- Prefira preço **no Pix** quando aparecer (e diga em `obs`: "preço no Pix; R$ Y no cartão").
- **Google Shopping** junta muitas lojas pequenas com preço bom (foi onde o dono achou a Tekbond 2,8 kg a R$ 91,73
  no Mercado Livre/Ampar e a Kisafix a R$ 101,99 com frete grátis). Tente `WebFetch` em
  `https://www.google.com/search?tbm=shop&q=<item>`; se não abrir, busque o nome exato do anúncio
  (ex.: `"Cola De Contato Tekbond 2.8kg" Ampar`) e a lista do Mercado Livre `https://lista.mercadolivre.com.br/<item-com-hifens>`.
- **Marcas equivalentes**: para cada item, pesquise também as concorrentes diretas (ex.: cola de contato →
  Kisafix, Cascola; manta líquida → Vedacit, Coral). Elas entram com "(equivalente, não é <marca>)" no título
  e o campo opcional `"marca"`. O dono filtra por marca no app.

## 3. Como registrar cada oferta

- **Só entra com preço visível** no trecho da busca ou na página (abra com WebFetch quando o trecho cortar o preço).
- Mesmo produto do item (medida, peso, tipo). Produto diferente → fora. Medida diferente → pode entrar com `preco_unidade: null`
  e `obs` explicando (ex.: "tamanho maior (2,88 m²)").
- `preco_unidade` = preço convertido para a unidade do item **só quando a conta é clara**:
  - caixa de 4,39 m² a R$ 254,62 → 58,00 por m²; kit 10 barras a R$ 282,64 → 28,26 por barra;
  - placa 625×625 mm = 0,390625 m²; o site já mostra "R$/m²" → use esse valor.
  - Na dúvida → `null`.
- Preço **muito abaixo** dos outros (menos da metade) → entra, mas `obs` = "preço muito abaixo — conferir".
- Página antiga/desatualizada → `obs` = "página antiga: confirmar preço".
- Meta: até **5 de Manaus** e até **6–8 de fora** por item, priorizando as mais baratas e as marcas mais comuns.
- **Nunca invente preço, loja ou link.**

## 4. Formato de `robo/achados.json`

```json
{
  "atualizado_em": "2026-11-30T05:40:00-04:00",
  "itens": [
    {
      "termo": "Piso vinílico colado 2 mm",
      "unidade": "m²",
      "nota": "texto curto com o que vale saber (Manaus sem preço, referência de serviço, frete pesado...)",
      "ofertas": [
        { "loja": "Cocil Home Center", "titulo": "Piso Vinílico 2mm Biancogres Vita Colonna (cx 5,92 m²)",
          "url": "https://...", "preco": 77.00, "oferta_un": "m²", "preco_unidade": 77.00,
          "local": "Manaus", "frete_manaus": "", "obs": "São Geraldo", "data": "2026-11-30",
          "marca": "Biancogres" }
      ]
    }
  ]
}
```
- `marca` é opcional, mas preencha sempre que souber (o app tem filtro por marca).
- Mantenha **a mesma ordem e os mesmos `termo`** de `itens.json` (o app usa o termo para ligar ao item do dono).
- Grave também uma cópia em `robo/historico/AAAA-MM-DD.json` (data de hoje no fuso de Manaus).

## 5. Conferência (obrigatória)

Rode:
```
python3 robo/validar.py
```
Ele confere o formato, aponta ofertas sem link/preço, itens sem pesquisa de Manaus ou de fora, e compara com a pesquisa anterior.
**Corrija tudo que ele marcar como ERRO** e rode de novo. Avisos (AVISO) podem ficar, mas leia cada um.

## 6. Publicar
Antes do commit final, grave `robo/status.json` com `{"estado": "pronto", "inicio": "<o mesmo do início>", "fim": "<agora em ISO>"}`.
Se o push for recusado, faça `git pull --rebase origin main` e tente de novo.
Commit **só** dos arquivos de `robo/` com a mensagem `Robô: preços da internet de AAAA-MM-DD`
(autor `Claude <noreply@anthropic.com>`) e push na `main`. Não altere nenhum outro arquivo do sistema.

## 7. Resumo final (em português, curto)
Use a saída do `validar.py`: por item, menor em Manaus × menor fora (loja e diferença %), o que subiu ou caiu
em relação à pesquisa anterior, e os itens sem resultado em Manaus.

## Promoções do dia (o dono abre de manhã para ver isso)

- Sempre que a página mostrar **promoção** (preço riscado "de R$ X por R$ Y", "oferta do dia", "oferta relâmpago",
  Black Friday, cupom, desconto no Pix acima do normal), preencha o campo opcional
  `"promocao"` da oferta com um texto curto e verdadeiro, ex.: `"de R$ 119,90 por R$ 91,73 (oferta do dia)"`
  ou `"cupom KE10: 10% off"`. Diga até quando vale, se a página disser.
- `preco` continua sendo o preço **com** a promoção. Não marque promoção sem ver o preço antigo ou o selo na página.
- Se um item caiu mais de 10% em relação à pesquisa anterior, cite no resumo final como **"🔥 baixou"**.
- No resumo final, comece pela lista de promoções encontradas hoje (item, loja, preço, link).
