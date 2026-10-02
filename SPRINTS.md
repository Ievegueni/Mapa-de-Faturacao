# SPRINTS.md — Plataforma de Controlo de Facturação

> Executar por ordem. Cada sprint só fecha quando os critérios de aceitação passam. Referência técnica: `CLAUDE.md`.
> **Regra transversal:** tudo tem de correr em **Node 16** (ver §2 do `CLAUDE.md`). Correr `node -v` antes de cada sprint.

## Sprint 0 — Fundação (Node 16)
- [x] Monorepo com npm workspaces (`apps/api`, `apps/web`, `packages/shared`).
- [x] `.nvmrc` (16), `.npmrc` (`engine-strict=true`) e `engines` em todos os `package.json`.
- [x] Instalar só as versões da tabela do §2 do `CLAUDE.md`, sem `^`.
- [x] API em TypeScript compilada para CommonJS; desenvolvimento com `ts-node-dev`.
- [x] Fastify 4 com plugin `prisma` e health check em `/api/health`.
- [x] Vite 4 + React 18 + Tailwind 3 + React Router 6 + TanStack Query 4.
- [x] Scripts: `dev`, `build`, `migrate`, `seed`, `test`.
- [x] Identidade visual Unitel (§18 do `CLAUDE.md`): paleta `brand`/`navy`/`ink` no `tailwind.config.js`, fonte Inter e logótipos de `docs/brand/` em `apps/web/public/`.

**Aceitação:**
- Com Node 16, `npm ci && npm run build && npm run dev` corre sem erros nem avisos de `engines`.
- `/api/health` devolve 200.

## Sprint 1 — Autenticação, utilizadores, equipas e permissões
- [ ] Schema: `User`, `Team`, `TeamMember`, `UserPermission`, `AuditLog`.
- [ ] Login com JWT + refresh em cookie (`bcryptjs`); troca de password obrigatória no primeiro acesso.
- [ ] Catálogo de permissões e matriz por perfil (`packages/shared/permissions.ts`).
- [ ] Plugin `rbac`: `requirePermission(module, action)` e `scopeFilter(user)`.
- [ ] Páginas do Gestor:
  - Utilizadores: criar, editar, desactivar e atribuir perfil.
  - **Equipas: criar, editar e desactivar** (nome + tipo).
  - Membros: associar utilizadores às equipas.
  - Permissões por utilizador: grelha módulo × acção (default / permitir / negar).
- [ ] `/me` com as permissões efectivas; menu dinâmico; guardas de rota; página inicial por perfil.
- [ ] Seed do Gestor.

**Aceitação:**
- Um Técnico da equipa A recebe 403 em tudo o que é da equipa B.
- Um override "negar export" esconde o botão e bloqueia o endpoint.

## Sprint 2 — Providers, preços e targets (configuração)
- [ ] Página única de providers: CRUD com tipos servidos e, por equipa/ano, PO e orçamento mensal.
- [ ] Separador **Preços**:
  - Tabela com vigência: combustível, serviço de abastecimento, manutenção, IVA.
  - Linhas de aluguer por potência, subtipo e distância.
  - **Todos os campos podem ficar vazios e ser editados depois.**
- [ ] Página **Faixas de desconto da rede** (editável).
- [ ] Página **Targets**: grelha ano × mês com uma linha **Global** e uma linha por provider (aluguer e combustível), editável e com campos vazios permitidos.
- [ ] Seed: providers, faixas e preços 420 / 48 / IVA 14%. O resto fica em branco.

**Aceitação:**
- Um preço ou target deixado em branco grava como `null` e aparece como "—".
- Editar um preço depois funciona.

## Sprint 3 — Facturação de Providers (modelo actual)
- [ ] `ProviderInvoice` com os mesmos campos do Excel actual.
- [ ] Painel de inserção (PO preenchido automaticamente), lista com filtros, estados Rascunho → Submetido → Validado.
- [ ] Resumo:
  - Tabela mês × provider.
  - Remanescente, dívida e % de execução.
  - Alerta quando um mês ultrapassa o orçamento mensal.
- [ ] Script de importação do `Novo Mapa de Facturação.xlsx`.

**Aceitação:** os totais coincidem com a app HTML actual (Anglobal: Julho 660.000,00; Agosto 588.549,42).

## Sprint 4 — Geradores: cálculos e dados mestre
- [ ] `packages/shared/calc/generators.ts` com todas as fórmulas do §7 do `CLAUDE.md`, incluindo o tratamento de valores vazios e as flags `SEM_PRECO_*`.
- [ ] Testes Vitest com pelo menos 10 linhas reais de Agosto de 2026 e casos-limite: horas negativas, dias 0, limites das faixas, potência em texto, preços vazios.
- [ ] Schema: `Site`, `Generator`, `GeneratorMonthlyMap`, `GeneratorMeasurement`, `MonthlyIndicators`.
- [ ] CRUD de Sites e Geradores, com pesquisa e filtros.

**Aceitação:** os testes passam e os resultados batem com o Excel.

## Sprint 5 — Geradores: importação e formulário
- [ ] Importação em dois passos: preview (exceljs, mapeamento pelo cabeçalho, normalização) e depois confirmação (transacção em lotes de 200).
- [ ] Formulário por site:
  - Pesquisa.
  - `horasN1` do mês anterior.
  - Penalizações e extras em branco.
  - Cálculo em tempo real.
  - Enter grava e avança para o site seguinte.
- [ ] Lista de medições:
  - Paginação no servidor (50 por página).
  - Filtro por flag.
  - Edição em linha (Supervisor).
- [ ] Botão **Recalcular mapa** (aplica os preços actuais às medições ainda não fechadas).
- [ ] Fluxo: submeter, validar, fechar; reabrir só pelo Gestor.

**Aceitação:**
- O Auto de Medição de Agosto de 2026 (1.161 linhas) é importado em menos de 30 s numa VPS modesta.
- O total de litros coincide com o Excel.

## Sprint 6 — Geradores: resumos
- [ ] Resumo do mês: categorias × zona (Luanda / Província), IVA, Validado / Diferença / Total + IVA.
- [ ] Mapa Resumo de Validações anual (Jan–Dez) por provider, com **target do provider e target global** e os respectivos desvios.
- [ ] Formulário de indicadores manuais (`MonthlyIndicators`).

**Aceitação:** sem erros nem divisões por zero; os valores coincidem com os Excel de Agosto de 2026 (com os mesmos preços).

## Sprint 7 — Dashboard
- [ ] Selector de tipo (Providers / Geradores), só com os tipos permitidos.
- [ ] KPIs e gráficos (Recharts) do §10 do `CLAUDE.md`.
- [ ] Âmbito por perfil; versão simplificada para o Técnico.
- [ ] Aviso visível quando faltam preços ou targets.

**Aceitação:** o dashboard carrega em menos de 2 s com 12 meses de dados.

## Sprint 8 — Relatórios (no browser)
- [ ] Página de relatórios: tipo de facturação → modelo → filtros → pré-visualização.
- [ ] `GET /reports/data` para cada modelo.
- [ ] `export/chartToPng.ts`: converte o SVG do Recharts em PNG.
- [ ] `export/pdf.ts` (jsPDF + autotable) e `export/xlsx.ts` (exceljs no browser), ambos com gráficos.
- [ ] Registo de cada exportação na auditoria.

**Aceitação:** cada modelo gera PDF e Excel que abrem sem erro, com gráficos visíveis.

## Sprint 9 — Auditoria, segurança e deploy
- [ ] Página de auditoria (Gestor).
- [ ] Rate-limit, CORS, cookies seguros e validação dos uploads.
- [ ] Deploy na VPS:
  - PM2 com **interpretador Node 16 fixo**.
  - Nginx (SPA + proxy `/api`) com SSL.
  - `deploy.sh`.
- [ ] Backup diário com `pg_dump`; restauro testado.
- [ ] Manual curto por perfil.

**Aceitação:**
- Deploy do zero numa VPS com Node 16 seguindo só o `README`.
- O restauro do backup funciona.
