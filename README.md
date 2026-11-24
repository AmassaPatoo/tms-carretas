# Plataforma KE

Todos os sistemas da empresa em um só lugar, com um login só e um banco de dados só (Supabase).
Hoje tem: **Orçamentos**, **Carreta** (TMS) e **Clientes**. Cada sistema novo entra como um módulo.

- Instalável no celular (Android e iPhone) como aplicativo.
- Cada empresa (cada cliente seu) só enxerga os próprios dados: a separação é feita pelo banco (RLS).
- Você, como administrador, cria empresas, libera os sistemas de cada uma e adiciona pessoas.

---

## Estrutura

```
index.html                 tela principal: entrar, escolher empresa, módulos, clientes, equipe, administração
config.js                  URL e chave PÚBLICA do Supabase
core/plataforma.js         núcleo usado por todos os módulos (login, empresa atual, barra do topo)
core/inicio.js, inicio.css tela principal
vendor/supabase.js         biblioteca do Supabase (embutida)
manifest.webmanifest, sw.js, icons/   aplicativo instalável
modulos/orcamentos/        sistema de orçamentos
modulos/carreta/           sistema de carretas (TMS)
modulos/cotacoes/          pesquisa de preços de material nas lojas
modulos/romaneios/         romaneio de entrega e ordem de serviço (pedido do fornecedor → documento da empresa)
aprovar/                   página pública: cliente aprova o orçamento
cotar/                     página pública: loja responde a cotação
supabase/migrations/       comandos do banco (rodar no SQL Editor, em ordem)
```

## Banco de dados (Supabase)

Rode no **SQL Editor**, em ordem (cada arquivo inteiro → Run):

1. `001_plataforma_base.sql`: núcleo (empresas, perfis, módulos, clientes) e Orçamentos. *(já rodado)*
2. `002_carreta_na_plataforma.sql`: coloca a Carreta dentro da plataforma (tabelas `car_`), cria a empresa
   "Minha Transportadora" com os dados atuais e passa os usuários para ela. Roda numa transação: se der erro, nada muda.
3. `003_orcamento_link_aprovacao.sql`: link para o cliente aprovar e assinar o orçamento sem login.
4. `004_link_curto.sql`: links de aprovação com 16 caracteres.
6. `006_romaneios.sql`: módulo Romaneios (entrega / ordem de serviço com o CNPJ e os preços da empresa). Depois, ligue "Romaneios" em Administração.
5. `005_cotacoes.sql`: módulo Cotações (itens, lojas, preços e pedidos de cotação respondidos por link).
   Depois, em **Administração**, ligue "Cotações" na empresa.
7. `007_excluir_cte.sql`: permite ao gestor excluir CT-e (apaga junto a receita do DRE) e excluir viagem (com tudo dela).

> Depois da 002, o app antigo `tms-carretas` para de funcionar. Use a plataforma.

Padrão dos nomes: `core_` = núcleo · `orc_` = Orçamentos · `car_` = Carreta · `cot_` = Cotações.

### Configurar o login (uma vez)

No Supabase: **Authentication → URL Configuration**
- **Site URL**: o endereço onde a plataforma ficar publicada (ex.: `https://amassapatoo.github.io/plataforma/`)
- **Redirect URLs**: o mesmo endereço

Assim os links de confirmação de e-mail e de "esqueci minha senha" voltam para o app.
Em **Authentication → Sign In / Providers → Email** você escolhe se exige confirmação de e-mail.

## Publicar no GitHub Pages

1. No GitHub, crie um repositório novo, por exemplo `plataforma` (pode ser público).
2. **Add file → Upload files** → arraste **todo o conteúdo desta pasta** (menos a pasta `teste/`, se existir) → *Commit changes*.
3. **Settings → Pages** → *Source*: **Deploy from a branch** → *Branch*: `main` / `/ (root)` → **Save**.
4. Em 1–2 minutos o endereço aparece no topo da página de Pages (ex.: `https://amassapatoo.github.io/plataforma/`).
5. Coloque esse endereço no Supabase (Site URL e Redirect URLs, acima).

Para atualizar depois: suba os arquivos alterados de novo e **aumente o número da `VERSAO` no `sw.js`**
(ex.: `plataforma-v2`). Isso faz os aparelhos baixarem a versão nova.

## Primeiro acesso

1. Abra o endereço e entre com o seu e-mail (o que é administrador).
2. Em **Administração**: renomeie "Minha Transportadora", crie as outras empresas e marque os sistemas de cada uma.
3. Para colocar uma pessoa: ela abre o app e toca em **Criar conta**; depois você (ou o dono da empresa)
   adiciona o e-mail em **Equipe** (ou em Administração → **+ Pessoa**).
4. Na Carreta, o gestor define quem é motorista ou gestor em **Usuários**.
5. Nos Orçamentos, quem vinha do app antigo usa **📂 Orçamentos → Importar** com o arquivo de backup do app antigo
   (traz orçamentos, fotos, tabela de preços, Pix e assinatura).

### Papéis

| Onde | Papel | Pode |
|---|---|---|
| Plataforma | **Administrador** (você) | tudo, em todas as empresas |
| Empresa | **Dono** | equipe, dados da empresa, é gestor na Carreta |
| Empresa | **Gerente** | configurações dos Orçamentos (Pix, preços) |
| Empresa | **Usuário** | usar os sistemas liberados |
| Carreta | **Gestor / Motorista / Pendente** | definido dentro da Carreta |

## Link para o cliente aprovar e assinar

- No orçamento, o botão **📤 Enviar** já manda o PDF com o link de aprovação na mensagem.
- Também dá para gerar, copiar, mandar pelo WhatsApp ou cancelar o link em **8 · Aprovação e documentos**.
- O cliente abre o link **sem login**, confere serviços, valores, condições e o Pix, assina com o dedo e aprova.
- O orçamento vira **Aprovado** sozinho, com nome, data/hora e assinatura, e o PDF passa a sair assinado.
- O link nunca mostra custos e lucro internos. Depois de aprovado, não aceita outra assinatura. Orçamento vencido não pode ser aprovado.
- A página do link é `aprovar/index.html` (endereço `…/aprovar/?c=CODIGO`). A prévia do WhatsApp usa `aprovar/previa.png`;
  se o endereço do site mudar, atualize o `og:image` dessa página.

## Cotações (preços do mercado)

- **Itens** e **Lojas**: o que você acompanha e onde pesquisa.
- **Lançar preços**: escolha a loja e digite os preços que pesquisou (telefone, balcão, site, nota).
- **Pedir cotação**: escolha itens e lojas; cada loja recebe pelo WhatsApp um link `cotar/?c=CODIGO`,
  preenche os preços no celular sem login e o comparativo se monta sozinho.
- **Mercado**: menor, média e maior preço de cada item, tendência no período, gráfico e ranking das lojas.

A loja só enxerga o próprio pedido; nada de outros preços, lojas ou custos.

### 🤖 Robô de pesquisa na internet

Uma tarefa agendada do Claude pesquisa toda semana os itens de `robo/itens.json` em sites e anúncios
(seguindo `robo/INSTRUCOES.md`) e grava `robo/achados.json` (+ cópia em `robo/historico/`).
O robô **não acessa o Supabase**: na aba **🤖 Internet** você confere os achados e escolhe o que guardar
no histórico de preços. Para mudar a lista de itens do robô, edite `robo/itens.json` (ou peça ao Claude).

## Instalar no celular

- **Android (Chrome)**: abra o endereço → menu ⋮ → **Instalar app** (ou pelo botão 👤 → Instalar aplicativo).
- **iPhone (Safari)**: abra o endereço → **Compartilhar** → **Adicionar à Tela de Início**.

## Criar um sistema novo (módulo)

1. Crie a pasta `modulos/<codigo>/` com um `index.html` que carregue, nesta ordem:
   ```html
   <script src="../../vendor/supabase.js"></script>
   <script src="../../config.js"></script>
   <script src="../../core/plataforma.js"></script>
   ```
   e no seu código:
   ```js
   const ctx = await Plataforma.exigirModulo('<codigo>');   // confere login e empresa
   if (!ctx) return;
   Plataforma.barraModulo(ctx, 'Nome do sistema');
   const db = ctx.db, empresaId = ctx.empresa.empresa_id;    // use empresa_id em todas as tabelas
   ```
2. No banco: crie as tabelas com prefixo próprio (ex.: `fin_`), sempre com `empresa_id`, e regras de acesso usando
   `core_modulo_liberado(empresa_id, '<codigo>')` (veja `001` como modelo). Registre o módulo:
   ```sql
   insert into core_modulos (codigo, nome, descricao, icone, ordem) values ('<codigo>', 'Nome', 'Descrição', 'file-text', 40);
   ```
3. Em `core/inicio.js`, acrescente o caminho em `APPS` e, em `sw.js`, os arquivos do módulo.
4. Em **Administração**, marque o sistema novo para as empresas que vão usar.

## Segurança

- `config.js` só tem a chave **pública** (publishable/anon), que pode ficar no app. **Nunca** coloque a chave `service_role` / `sb_secret_`.
- Toda proteção está no banco: cada tabela tem regras de acesso por empresa e por papel. Mesmo alguém
  que mexa no código do navegador não consegue ver nem alterar dados de outra empresa.

## Verificação na SEFAZ (NF-e, CT-e e selo da SEFAZ-AM)

A função `supabase/functions/sefaz` consulta, com o **certificado A1** da empresa:
- se a NF-e e o CT-e estão **autorizados** (ou cancelados/denegados) na SEFAZ que os autorizou;
- na **SEFAZ-AM** (API GAF), se a NF-e está **selada/desembaraçada** e quais notas de um CT-e ainda estão sem selo.

Ao abrir a viagem, a consulta é automática: nota ou CT-e **cancelado/denegado bloqueia**; nota sem selo só avisa.
Em "Visualizar CT-e" há o botão **Verificar na SEFAZ agora**. Sem a função instalada, o app avisa e segue funcionando.

**Instalar (uma vez):**
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Nome: `sefaz`.
   Cole o conteúdo de `supabase/functions/sefaz/index.ts` e clique em **Deploy**.
2. Supabase → **Edge Functions** → **Secrets** → adicione:
   - `SEFAZ_CERT_PFX`: o certificado .pfx em base64. No Windows (PowerShell):
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\certificado.pfx")) | Set-Clipboard`
     e cole o valor.
   - `SEFAZ_CERT_SENHA`: a senha do certificado.
   - opcional `SEFAZ_AM_PERFIL`: perfis da SEFAZ-AM em ordem de tentativa (padrão `1,2`:
     1 = emitente do documento, 2 = CNPJ autorizado no XML, 3 = terminal credenciado).

O certificado fica só nos segredos do Supabase; o app nunca o recebe.

### Intermediário da SEFAZ (`sefaz-proxy`, Vercel em São Paulo)

A SEFAZ-SP e o Ambiente Nacional pedem o certificado por **renegociação TLS**, que o servidor do Supabase
(Deno/rustls) não suporta: a conexão cai ("connection reset"). A função `sefaz` então manda esses pedidos
para o intermediário em Node (`sefaz-proxy/api/sefaz.js`), que faz a conexão com o certificado e só devolve a resposta.

1. Vercel → **Add New → Project** → importe o repositório `tms-carretas`, **Root Directory**: `sefaz-proxy`. Deploy.
   A região já vem fixada em São Paulo (`gru1`, no `vercel.json`).
2. Vercel → projeto → **Settings → Environment Variables**: `SEFAZ_CERT_PFX`, `SEFAZ_CERT_SENHA` (os mesmos do Supabase)
   e `PROXY_TOKEN` (uma senha longa, 32+ caracteres). Faça **Redeploy**.
3. Supabase → Edge Functions → Secrets: `SEFAZ_PROXY_URL` = `https://SEU-PROJETO.vercel.app/api/sefaz` e
   `SEFAZ_PROXY_TOKEN` = o mesmo `PROXY_TOKEN`.
