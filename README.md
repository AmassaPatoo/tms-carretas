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
supabase/migrations/       comandos do banco (rodar no SQL Editor, em ordem)
```

## Banco de dados (Supabase)

Rode no **SQL Editor**, em ordem (cada arquivo inteiro → Run):

1. `001_plataforma_base.sql`: núcleo (empresas, perfis, módulos, clientes) e Orçamentos. *(já rodado)*
2. `002_carreta_na_plataforma.sql`: coloca a Carreta dentro da plataforma (tabelas `car_`), cria a empresa
   "Minha Transportadora" com os dados atuais e passa os usuários para ela. Roda numa transação: se der erro, nada muda.

> Depois da 002, o app antigo `tms-carretas` para de funcionar. Use a plataforma.

Padrão dos nomes: `core_` = núcleo · `orc_` = Orçamentos · `car_` = Carreta.

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
