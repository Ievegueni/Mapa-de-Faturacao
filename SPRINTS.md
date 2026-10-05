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
- [x] Schema: `User`, `Team`, `TeamMember`, `UserPermission`, `AuditLog`.
- [x] Login com JWT + refresh em cookie (`bcryptjs`); troca de password obrigatória no primeiro acesso.
- [x] Catálogo de permissões e matriz por perfil (`packages/shared/permissions.ts`).
- [x] Plugin `rbac`: `requirePermission(module, action)` e `scopeFilter(user)`.
- [x] Páginas do Gestor:
  - Utilizadores: criar, editar, desactivar e atribuir perfil.
  - **Equipas: criar, editar e desactivar** (nome + tipo).
  - Membros: associar utilizadores às equipas.
  - Permissões por utilizador: grelha módulo × acção (default / permitir / negar).
- [x] `/me` com as permissões efectivas; menu dinâmico; guardas de rota; página inicial por perfil.
- [x] Seed do Gestor.

**Aceitação:**
- Um Técnico da equipa A recebe 403 em tudo o que é da equipa B.
- Um override "negar export" esconde o botão e bloqueia o endpoint.

## Sprint 2 — Providers, preços e targets (configuração)
- [x] Página única de providers: CRUD com tipos servidos e, por equipa/ano, PO e orçamento mensal.
- [x] Separador **Preços**:
  - Tabela com vigência: combustível, serviço de abastecimento, manutenção, IVA.
  - Linhas de aluguer por potência, subtipo e distância.
  - **Todos os campos podem ficar vazios e ser editados depois.**
- [x] Página **Faixas de desconto da rede** (editável).
- [x] Página **Targets**: grelha ano × mês com uma linha **Global** e uma linha por provider (aluguer e combustível), editável e com campos vazios permitidos.
- [x] Seed: providers, faixas e preços 420 / 48 / IVA 14%. O resto fica em branco.

**Aceitação:**
- Um preço ou target deixado em branco grava como `null` e aparece como "—".
- Editar um preço depois funciona.

## Sprint 3 — Facturação de Providers (modelo actual)
- [x] `ProviderInvoice` com os mesmos campos do Excel actual.
- [x] Painel de inserção (PO preenchido automaticamente), lista com filtros, estados Rascunho → Submetido → Validado.
- [x] Resumo:
  - Tabela mês × provider.
  - Remanescente, dívida e % de execução.
  - Alerta quando um mês ultrapassa o orçamento mensal.
- [x] Script de importação do `Novo Mapa de Facturação.xlsx` (`npm run import:providers -w apps/api`).

**Aceitação:** os totais coincidem com a app HTML actual (Anglobal: Julho 660.000,00; Agosto 588.549,42). *(confirmado com o ficheiro real: Julho 660.000,00, Agosto 588.549,42, total 1.248.549,42 e remanescente 34.151.450,58, iguais ao Excel)*

## Sprint 4 — Geradores: cálculos e dados mestre
- [x] `packages/shared/calc/generators.ts` com todas as fórmulas do §7 do `CLAUDE.md`, incluindo o tratamento de valores vazios e as flags `SEM_PRECO_*`.
- [x] Testes Vitest com pelo menos 10 linhas reais de Agosto de 2026 e casos-limite: horas negativas, dias 0, limites das faixas, potência em texto, preços vazios. *(11 linhas reais)*
- [x] Schema: `Site`, `Generator`, `GeneratorMonthlyMap`, `GeneratorMeasurement`, `MonthlyIndicators`.
- [x] CRUD de Sites e Geradores, com pesquisa e filtros.

**Aceitação:** os testes passam e os resultados batem com o Excel. *(horas trabalhadas 1063/1063, horas de rede 1160/1160 e % de desconto 1130/1130 iguais aos valores em cache do Excel)*

## Sprint 5 — Geradores: importação e formulário
- [x] Importação em dois passos: preview (exceljs, mapeamento pelo cabeçalho, normalização) e depois confirmação (transacção em lotes de 200).
- [x] Formulário por site:
  - Pesquisa.
  - `horasN1` do mês anterior.
  - Penalizações e extras em branco.
  - Cálculo em tempo real.
  - Enter grava e avança para o site seguinte.
- [x] Lista de medições:
  - Paginação no servidor (50 por página).
  - Filtro por flag.
  - Edição em linha (Supervisor).
- [x] Botão **Recalcular mapa** (aplica os preços actuais às medições ainda não fechadas).
- [x] Fluxo: submeter, validar, fechar; reabrir só pelo Gestor.

**Aceitação:**
- O Auto de Medição de Agosto de 2026 (1.161 linhas) é importado em menos de 30 s numa VPS modesta.
- O total de litros coincide com o Excel.

*Resultado com o ficheiro real: 1.161 linhas lidas e gravadas em ~1 s. Litros no ficheiro: 509.812,49 (igual ao Excel). 2 linhas com nº de série repetido ficam de fora (410 + 500 L) até o Excel ser corrigido; importadas 508.902,49.*

## Sprint 6 — Geradores: resumos
- [x] Resumo do mês: categorias × zona (Luanda / Província), IVA, Validado / Diferença / Total + IVA.
- [x] Mapa Resumo de Validações anual (Jan–Dez) por provider, com **target do provider e target global** e os respectivos desvios.
- [x] Formulário de indicadores manuais (`MonthlyIndicators`).

**Aceitação:** sem erros nem divisões por zero; os valores coincidem com os Excel de Agosto de 2026 (com os mesmos preços). *(o parque de Agosto confere com o Mapa Resumo real: 1152 = 543 + 575 + 30 + 4 geradores sem data de remoção; 1150 importados por causa dos 2 nºs de série repetidos no Auto. Os valores em Kz do Mapa Resumo estão vazios no ficheiro e o Auto não tem preço de aluguer, por isso não há valores monetários do Excel para comparar)*

## Sprint 7 — Dashboard
- [x] Selector de tipo (Providers / Geradores), só com os tipos permitidos.
- [x] KPIs e gráficos (Recharts) do §10 do `CLAUDE.md`.
- [x] Âmbito por perfil; versão simplificada para o Técnico.
- [x] Aviso visível quando faltam preços ou targets.

**Aceitação:** o dashboard carrega em menos de 2 s com 12 meses de dados. *(API: 37 ms com 12 meses × 1.200 medições; no browser, troca de separador em ~0,2 s)*

## Sprint 8 — Relatórios (no browser)
- [x] Página de relatórios: tipo de facturação → modelo → filtros → pré-visualização.
- [x] `GET /reports/data` para cada modelo.
- [x] `export/chartToPng.ts`: converte o SVG do Recharts em PNG.
- [x] `export/pdf.ts` (jsPDF + autotable) e `export/xlsx.ts` (exceljs no browser), ambos com gráficos.
- [x] Registo de cada exportação na auditoria.

**Aceitação:** cada modelo gera PDF e Excel que abrem sem erro, com gráficos visíveis.

**Resultado:** 8 modelos (3 Providers, 5 Geradores) testados no browser com os dados reais de Agosto de 2026: todos descarregam PDF (`%PDF`) e Excel (`PK`) válidos, com gráficos; pré-visualização < 1 s. PDF ≈ 40–65 kB (Auto de Medição completo, 58 páginas, ≈ 550 kB). Excel com valores numéricos `#,##0.00`, totais `SUM` e folha "Gráficos". Cada exportação fica no `AuditLog`. Testes: shared 67, API 61.

## Ajuste — Módulos separados (após o Sprint 8)
- [x] Dois módulos independentes: **Rede Residencial** (antigo "Providers") e **Combustível e Geradores**, com menu, rotas, dashboard, relatórios e configuração próprios (CLAUDE.md §5.5).
- [x] Parceiros em listas separadas por módulo (`Provider.tipo`); migração divide os parceiros partilhados e move geradores, mapas, preços e targets para o registo de Geradores.
- [x] API: parceiros, preços, faixas, targets e relatórios filtrados/validados por módulo.
- [x] Selector de módulo na barra lateral (Gestor ou quem tem equipas dos dois tipos); "O meu trabalho" por módulo.

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
