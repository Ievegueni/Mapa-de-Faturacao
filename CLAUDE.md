# CLAUDE.md — Plataforma de Controlo de Facturação (Manutenção de Rede)

> Especificação técnica de referência. Ler antes de qualquer tarefa. Plano de execução em `SPRINTS.md`.

## 1. Objectivo

Substituir os Excel manuais por uma plataforma web **leve** e multi-utilizador que controla dois tipos de facturação:

| Tipo | Origem actual | O que controla |
|---|---|---|
| **PROVIDERS** | `Novo Mapa de Facturação.xlsx` | Facturas mensais por parceiro, pagamentos, dívida, orçamento e remanescente |
| **GERADORES** | `Auto de Medição – Energia – Sites` + `MAPA RESUMO VALIDAÇÕES MENSAIS` | Medição mensal de ~1.160 sites com gerador (aluguer, combustível, abastecimento, descontos, penalizações), validação e resumo anual |

**Princípios:**
- O trabalho tem de ficar mais fácil.
- Cada utilizador vê apenas o que precisa.
- Os cálculos são automáticos.
- A exportação é feita com um clique.
- A aplicação deve ser leve, com o mínimo de dependências e processos no servidor.

## 2. ⚠️ Restrição obrigatória: Node.js 16

O servidor **corre Node 16**. Tudo tem de arrancar e correr em Node 16.

- `package.json` (raiz e apps): `"engines": { "node": ">=16.13 <17" }`.
- `.nvmrc` com `16`.
- `.npmrc` com `engine-strict=true`.
- Fixar **versões exactas** (sem `^`) e fazer commit do `package-lock.json`.
- A API é compilada para **CommonJS** (`"module": "commonjs"`, `"target": "ES2020"`). Não usar `"type": "module"` na API. Pacotes só-ESM não são permitidos na API.
- **APIs proibidas** (não existem em Node 16): `fetch` global, `structuredClone`, `Array.prototype.findLast`, `Object.hasOwn` (sem polyfill), `node:test`, `--watch`.
- Para desenvolvimento usar `ts-node-dev` ou `nodemon` + `ts-node`, nunca `node --watch`.
- Antes de instalar qualquer dependência nova, **confirmar o campo `engines`** no npm. Se exigir Node 18 ou superior, escolher outra.
- Nota: o Node 16 está em fim de vida desde Setembro de 2023 (sem patches de segurança). Manter a API atrás do Nginx e planear a migração para Node 20 quando a VPS permitir.

### Versões compatíveis com Node 16 (usar estas)

| Pacote | Versão | Motivo |
|---|---|---|
| fastify | 4.x | Fastify 5 exige Node 20 |
| @fastify/jwt | 7.x | Compatível com Fastify 4 |
| @fastify/cookie | 9.x | Compatível com Fastify 4 |
| @fastify/multipart | 8.x | Compatível com Fastify 4 |
| @fastify/rate-limit | 8.x | Compatível com Fastify 4 |
| @fastify/cors | 8.x | Compatível com Fastify 4 |
| @fastify/static | 6.x | Compatível com Fastify 4 |
| prisma / @prisma/client | 5.x | Prisma 6 exige Node 18 |
| zod | 3.x | — |
| bcryptjs | 2.4.x | JS puro, sem compilação nativa (substitui argon2) |
| exceljs | 4.x | Importação de Excel no servidor; exportação no browser |
| typescript | 5.x | — |
| vite | 4.5.x | Vite 5 exige Node 18 |
| @vitejs/plugin-react | 4.x (compatível com Vite 4) | — |
| tailwindcss | 3.x | Tailwind 4 exige Node 20 |
| vitest | 0.34.x | Vitest 1 exige Node 18 |
| react / react-dom | 18.x | — |
| react-router-dom | 6.x | — |
| @tanstack/react-query | 4.x | — |
| recharts | 2.x | — |
| jspdf + jspdf-autotable | 2.x / 3.x | PDF no browser |

Se `npm install` reclamar de `engines`, **não forçar**: descer de versão. Para dependências transitivas, fixar a última versão compatível em `overrides` no `package.json` da raiz (ver `README.md`).

## 3. Arquitectura leve

| Camada | Tecnologia |
|---|---|
| API | Node 16 + Fastify 4 + TypeScript (CommonJS) |
| BD | PostgreSQL + Prisma 5 |
| Frontend | React 18 + Vite 4 + Tailwind 3 + TanStack Query 4 + Recharts |
| Auth | JWT de acesso (15 min) + refresh em cookie httpOnly (7 dias), `bcryptjs` |
| Importação Excel | `exceljs` no servidor, de forma síncrona e em lotes (sem filas) |
| Relatórios PDF/Excel | **Gerados no browser** (jsPDF + autotable; exceljs no browser). Os gráficos Recharts são convertidos em PNG e embutidos no ficheiro |
| Deploy | VPS com **1 processo PM2** (API) + Nginx (serve o build da web e faz proxy de `/api`) |

**Sem** Redis, BullMQ, Puppeteer, Chromium ou canvas nativo. O servidor só guarda e calcula dados; os ficheiros são montados no browser.

**Valores monetários:** inteiros em **cêntimos de AOA** (`BigInt`), porque os valores reais têm cêntimos. A API serializa `BigInt` como string e recebe cêntimos como string; percentagens (IVA, faixas) são guardadas em pontos percentuais (`14` = 14%). Os litros e as horas são guardados como `Decimal(12,2)`.

## 4. Estrutura do repositório

```
controlo-facturacao/
├── CLAUDE.md
├── SPRINTS.md
├── .nvmrc                    # 16
├── .npmrc                    # engine-strict=true
├── package.json              # npm workspaces
├── apps/
│   ├── api/
│   │   ├── prisma/schema.prisma
│   │   ├── prisma/seed.ts
│   │   └── src/
│   │       ├── server.ts
│   │       ├── plugins/       # auth, rbac, prisma, audit
│   │       └── modules/
│   │           ├── auth/  users/  teams/  permissions/
│   │           ├── providers/          # inclui preços e targets
│   │           ├── billing-providers/
│   │           ├── generators/         # sites, medições, import, mapa mensal
│   │           ├── dashboard/
│   │           ├── reports/            # só devolve dados agregados (JSON)
│   │           └── audit/
│   └── web/
│       └── src/
│           ├── pages/  components/  layouts/
│           ├── hooks/          # useAuth, usePermission
│           ├── export/         # pdf.ts, xlsx.ts, chartToPng.ts
│           └── lib/api.ts
└── packages/
    └── shared/
        ├── calc/              # funções de cálculo puras (testadas)
        ├── schemas/           # Zod
        └── permissions.ts     # catálogo de módulos/acções
```

`packages/shared` é compilado para CommonJS (usado pela API) e importado directamente pelo Vite (usado pela web).

## 5. Perfis, permissões e equipas

### 5.1 Perfis

| Perfil | Âmbito | Resumo |
|---|---|---|
| **GESTOR** | Global | Vê e faz tudo: utilizadores, equipas, providers, preços, targets, todos os mapas, relatórios e auditoria |
| **SUPERVISOR** | As suas equipas | Insere, edita, valida e fecha mapas da equipa; vê o dashboard e os relatórios da equipa |
| **TECNICO** | As suas equipas | Só insere e edita os seus registos em rascunho |

### 5.2 Permissões granulares

O perfil define permissões **por omissão**. O Gestor pode **ajustar por utilizador** (activar ou desactivar acções específicas).

| Módulo | Acções |
|---|---|
| `dashboard` | view |
| `providers` | view, create, edit, delete |
| `prices_targets` | view, edit |
| `billing_providers` | view, create, edit, delete, validate, export |
| `billing_generators` | view, create, edit, delete, import, validate, close, export |
| `reports` | view, export |
| `users` | view, create, edit, delete |
| `teams` | view, create, edit, delete |
| `audit` | view |

| Permissão | GESTOR | SUPERVISOR | TECNICO |
|---|:-:|:-:|:-:|
| dashboard.view | ✔ | ✔ (equipa) | ✔ (simplificado) |
| providers.view | ✔ | ✔ | — |
| providers.create/edit/delete | ✔ | — | — |
| prices_targets.view | ✔ | ✔ | — |
| prices_targets.edit | ✔ | — | — |
| billing_*.view | ✔ | ✔ | ✔ |
| billing_*.create/edit | ✔ | ✔ | ✔ (só rascunhos próprios) |
| billing_*.delete | ✔ | ✔ | — |
| billing_generators.import | ✔ | ✔ | ✔ |
| billing_*.validate / close | ✔ | ✔ | — |
| billing_*.export, reports.* | ✔ | ✔ | — |
| users.*, teams.*, audit.view | ✔ | — | — |

**Regra de resolução:** `permissão efectiva = default do perfil ± override do utilizador`. A verificação é feita **sempre na API** (plugin `rbac`). O frontend só esconde menus e botões.

### 5.3 Equipas

- **As equipas são criadas na ferramenta** pelo Gestor. O seed não cria nenhuma.
- Cada equipa tem nome e tipo (`PROVIDERS` ou `GERADORES`), e pode ser activada ou desactivada.
- Cada mapa pertence a uma equipa.
- Um utilizador pode pertencer a uma ou mais equipas.
- Toda a query de facturação passa por `scopeFilter(user)`:
  - Gestor: sem filtro.
  - Restantes perfis: `teamId IN (equipas do utilizador)`.
- O menu é gerado a partir das permissões e dos tipos das equipas do utilizador. Uma rota sem permissão devolve 403 e o frontend redirecciona para a página inicial do perfil.

### 5.4 Página inicial e painel de inserção

| Perfil | Página inicial | Painel de inserção |
|---|---|---|
| GESTOR | Dashboard global com selector de tipo | Todos os painéis |
| SUPERVISOR | Dashboard da(s) equipa(s) | Inserção + rascunhos para validar + fecho do mês |
| TECNICO | "O meu trabalho" (rascunhos e pendentes) | Só o formulário do tipo da sua equipa; os campos calculados ficam em leitura apenas |

## 6. Modelo de dados (Prisma — resumo)

```prisma
enum Role          { GESTOR SUPERVISOR TECNICO }
enum BillingType   { PROVIDERS GERADORES }
enum InvoiceStatus { ABERTO ANDAMENTO PENDENTE FECHADO }
enum RecordState   { RASCUNHO SUBMETIDO VALIDADO FECHADO }

model User {
  id String @id @default(cuid())
  nome String
  email String @unique
  passwordHash String
  role Role
  ativo Boolean @default(true)
  mustChangePassword Boolean @default(true)
  teams TeamMember[]
  permissionOverrides UserPermission[]
  createdAt DateTime @default(now())
}

model Team {
  id String @id @default(cuid())
  nome String @unique
  tipo BillingType
  ativo Boolean @default(true)
  members TeamMember[]
}

model TeamMember {
  userId String
  teamId String
  @@id([userId, teamId])
}

model UserPermission {
  userId String
  module String
  action String
  allowed Boolean
  @@id([userId, module, action])
}

// ---------- Página única de providers ----------
model Provider {
  id String @id @default(cuid())
  nome String @unique
  nif String?
  contacto String?
  email String?
  tipos BillingType[]
  ativo Boolean @default(true)
}

model ProviderBudget {          // PO e orçamento por provider/equipa/ano
  id String @id @default(cuid())
  providerId String
  teamId String?                // vazio = todas as equipas (por omissão); a linha da equipa sobrepõe-se
  ano Int
  po String?
  orcamentoMensalCent BigInt?
  @@unique([providerId, teamId, ano])
}

// Preços — TODOS os valores podem ficar em branco e ser preenchidos na ferramenta
model PriceTable {
  id String @id @default(cuid())
  providerId String
  validFrom DateTime
  precoCombustivelCent BigInt?
  precoServAbastCent BigInt?
  precoManutencaoCent BigInt?
  ivaPercent Decimal?
  rentPrices RentPrice[]
}

model RentPrice {               // preço de aluguer por dia (linhas criadas e editadas na UI)
  id String @id @default(cuid())
  priceTableId String
  potenciaKVA Int?
  subtipo String?               // vazio = aplica-se a todos
  distancia String?             // vazio = aplica-se a todas
  precoDiaCent BigInt?
}

model GridDiscountRule {        // faixas de desconto da rede (editáveis na UI)
  id String @id @default(cuid())
  horasMin Int
  horasMax Int
  percent Decimal
  validFrom DateTime
}

// Targets — global E por provider
model Target {
  id String @id @default(cuid())
  ano Int
  mes Int
  providerId String?            // null = target GLOBAL
  aluguerCent BigInt?
  combustivelCent BigInt?
  @@unique([ano, mes, providerId])
}

// ---------- PROVIDERS (modelo actual, sem alterações) ----------
model ProviderInvoice {
  id String @id @default(cuid())
  teamId String
  providerId String
  ano Int
  mes Int
  tipo String               // Manutenção | Material
  numeroFactura String?
  dataFacturacao DateTime?
  dataExecucao DateTime?
  qtdOTs Int?
  consumiveis Int?
  valorFTCent BigInt
  valorPagoCent BigInt @default(0)
  status InvoiceStatus @default(ABERTO)
  observacao String?
  state RecordState @default(RASCUNHO)
  createdById String
  validatedById String?
  @@index([teamId, ano, mes])
}

// ---------- GERADORES ----------
model Site {
  id String @id @default(cuid())
  codigoPP String?
  codigoLocalizacao String?
  codigoCliente String?
  nome String
  regiao String                 // normalizado: Norte|Centro|Sul|Leste
  provincia String
  nivel String?
  tipo String?
  powerCube1000 Boolean?
  subtipo String?
  distanciaFacturacao String?
  tipoAcesso String?
  pavimentadoInterior Boolean?
  ligadoRede Boolean?
  teamId String
  generators Generator[]
}

model Generator {
  id String @id @default(cuid())
  siteId String
  providerId String             // Proprietário
  numeroSerie String @unique
  numeroActivo String?
  potenciaKVA Int?
  dataInstalacao DateTime?
  dataRemocao DateTime?
  dataEntrada DateTime?
}

model GeneratorMonthlyMap {     // um mapa por equipa/provider/mês
  id String @id @default(cuid())
  teamId String
  providerId String
  ano Int
  mes Int
  state RecordState @default(RASCUNHO)
  closedById String?
  closedAt DateTime?
  @@unique([teamId, providerId, ano, mes])
}

model GeneratorMeasurement {    // uma linha do Auto de Medição
  id String @id @default(cuid())
  mapId String
  siteId String
  generatorId String
  dias Int
  horasN1 Decimal?
  horasN Decimal?
  litros Decimal?
  // snapshot dos preços aplicados (vazio se ainda não definidos)
  precoCombustivelCent BigInt?
  precoServAbastCent BigInt?
  precoAluguerDiaCent BigInt?
  precoManutencaoCent BigInt?
  // valores manuais — ficam em branco até serem preenchidos
  servExtrasCent BigInt?
  penExcessoHorasCent BigInt?
  penSLACent BigInt?
  penNivelCombustCent BigInt?
  penAvariaCent BigInt?
  // calculados (persistidos para relatórios rápidos)
  horasTrabalhadas Int?
  horasRede Int?
  descontoPercent Decimal?
  combustivelCent BigInt
  servAbastCent BigInt
  abastecimentoCent BigInt
  aluguerCent BigInt
  descontoRedeCent BigInt
  totalCent BigInt
  flags String[]
  state RecordState @default(RASCUNHO)
  createdById String
  @@unique([mapId, generatorId])
}

model MonthlyIndicators {       // linhas manuais do Mapa Resumo de Validações
  id String @id @default(cuid())
  mapId String @unique
  sitesRedePublica Int?
  sitesRedeConfiguradosNetEco Int?
  sitesRedeSemGarantia Int?
  poupancaCent BigInt?
  transporteExtraCent BigInt?
}

model AuditLog {
  id String @id @default(cuid())
  userId String
  entity String
  entityId String
  action String
  diff Json?
  createdAt DateTime @default(now())
}
```

### Campos em branco

Preços, penalizações, serviços extras, targets e indicadores podem ficar **vazios** (`null`).

- Nos cálculos, um valor vazio conta como **0** e gera uma flag:
  - `SEM_PRECO_ALUGUER`
  - `SEM_PRECO_COMBUSTIVEL`
  - `SEM_PRECO_SERV_ABAST`
- Na interface, um campo vazio aparece como "—" e o campo fica editável.
- **Recálculo:** quando um preço é definido ou alterado, o botão "Recalcular mapa" aplica os novos preços às medições do mês que ainda não estão em estado FECHADO.

## 7. Regras de cálculo — Geradores

Implementar em `packages/shared/calc/generators.ts`, como funções puras com testes. Todos os valores em cêntimos.

| Campo | Fórmula |
|---|---|
| horasTrabalhadas | `floor((horasN − horasN1) / dias)` (horas por dia) |
| horasRede | `24 − horasTrabalhadas` |
| descontoPercent | Pelas faixas de `GridDiscountRule` (seed: 0–5 → 0%, 6–11 → 35%, 12–17 → 45%, 18–24 → 55%). Fora das faixas → flag `HORAS_FORA_INTERVALO` e desconto 0 |
| combustivel | `litros × precoCombustivel` |
| servAbast | `litros × precoServAbast` |
| abastecimento | `combustivel + servAbast` |
| aluguer | `precoAluguerDia × dias` |
| descontoRede | `aluguer × descontoPercent` |
| total | `aluguer + manutencao + servExtras + abastecimento − descontoRede − (penExcessoHoras + penSLA + penNivelCombust + penAvaria)` |

**Escolha do preço de aluguer:** procurar a linha de `RentPrice` com a mesma potência e, se existirem, o mesmo subtipo e distância. Prioridade: correspondência exacta → só potência → sem preço (fica 0 com flag).

**Resumo do mês** (substitui a folha "Resumo"):
- Agregar por categoria (Aluguer, Combustível, Serviço de Abastecimento) e por zona.
  - Zona = Luanda se `provincia = 'Luanda'`, caso contrário Província.
- IVA (taxa da `PriceTable`; se estiver vazia, mostrar aviso e assumir 0) sobre Aluguer e Serviço de Abastecimento. **O combustível não leva IVA.**
- Colunas: Validado | Diferença (facturado − validado) | IVA | Total + IVA.

**Mapa Resumo de Validações** (vista anual Jan–Dez, por provider):
- Calculado a partir das medições:
  - Penalizações: quantidade e valor por tipo.
  - Valor global das penalizações.
  - Parque de geradores total e por potência.
  - Aluguer e manutenção.
  - Litros, combustível, abastecimento.
  - Variações mensais (absolutas e %).
  - Total parcial e global, com transporte extra.
- Indicadores manuais vêm de `MonthlyIndicators`.
- **Targets:** mostrar o target **do provider** e o target **global**, com desvio em valor e em %.
- Divisão por zero → mostrar "—".

**Flags (avisos, não bloqueiam a gravação):**
- `HORAS_NEGATIVAS`
- `DIAS_INVALIDOS`
- `HORAS_FORA_INTERVALO`
- `SEM_PRECO_*`
- `LITROS_ACIMA_MEDIA` (mais de 2× a média dos últimos 3 meses do site)
- `GERADOR_REMOVIDO`

## 8. Regras de cálculo — Providers (modelo actual)

- Orçamento anual = orçamento mensal × 12 (vazio → não calcula remanescente nem %).
- Dívida = valor FT − valor pago.
- Remanescente = orçamento anual − facturado no ano.
- % de execução = facturado / orçamento anual.
- Alerta quando o facturado de um provider num mês é maior que o orçamento mensal.
- A inserção mantém **exactamente** os campos actuais:
  - Parceiro, PO (preenchido automaticamente), ano, mês, tipo, nº factura.
  - Data de facturação, data de execução, OTs, consumíveis.
  - Valor FT, valor pago, status, observação.

## 9. Inserção de geradores — dois modos

### 9.1 Importação do Excel (Auto de Medição)
1. **Upload `.xlsx`** (até 20 MB): escolher equipa, provider e mês/ano.
2. **Leitura no servidor** com `exceljs`, de forma síncrona: 1.200 linhas demoram poucos segundos, por isso não há filas.
3. **Detecção do cabeçalho**: procura a linha com "Nome Ponto Produção". O mapeamento é feito **pelo nome da coluna**, não pela posição. As fórmulas são ignoradas e os cálculos são refeitos no servidor.
4. **Normalização**:
   - Remover espaços no início e no fim ("Sul " passa a "Sul").
   - SIM/NÃO passa a booleano.
   - Potência em texto passa a número.
   - Datas do Excel passam a ISO.
5. **Pré-visualização**: a API devolve o resultado sem gravar (novos, actualizados, erros, flags). O ficheiro processado fica em memória (ou em `/tmp`) durante 15 minutos com um token.
6. **Confirmação**:
   - Grava numa transacção Prisma, em lotes de 200.
   - Faz upsert de `Site` e `Generator` (chave: nº de série).
   - As medições ficam em RASCUNHO.
   - Regista a operação no `AuditLog`.

### 9.2 Formulário por site
- Pesquisa por código P.P., nome ou nº de série.
- `horasN1` é preenchido automaticamente com `horasN` do mês anterior.
- Campos manuais (penalizações, serviços extras) começam **em branco**.
- Os cálculos aparecem em tempo real, usando a mesma função de `packages/shared/calc`.
- Atalho: Enter grava e passa para o site seguinte da lista.

### 9.3 Fluxo de estados
`RASCUNHO` (Técnico) → `SUBMETIDO` → `VALIDADO` (Supervisor) → `FECHADO` (fecho do mês; só o Gestor reabre).

## 10. Dashboard

- **Selector no topo:** Providers | Controlo de Geradores. Só aparecem os tipos a que o utilizador tem acesso.
- **Providers:**
  - KPIs: orçamento, facturado, pago, dívida, remanescente.
  - Consumo do orçamento por provider.
  - Gráfico mensal.
  - Facturas pendentes.
- **Geradores:**
  - KPIs do mês: total, aluguer, combustível, litros, desconto de rede, penalizações, nº de geradores.
  - Comparação com o **target do provider** e com o **target global**.
  - Evolução mensal.
  - Distribuição por região e por potência.
  - Top 10 sites por litros.
  - Flags pendentes, incluindo preços em falta.
- **Filtros:** ano, mês, equipa (só para o Gestor) e provider.

## 11. Relatórios (gerados no browser)

1. **Tipo de facturação** (obrigatório): Providers ou Geradores.
2. **Modelo:**
   - Providers: Resumo anual, Por provider, Pagamentos/Dívida.
   - Geradores: Auto de Medição mensal, Resumo do mês (com IVA), Mapa Resumo de Validações anual, Penalizações, Consumo por região.
3. **Filtros:** período, equipa, provider, região/província.
4. **Pré-visualização** no ecrã (tabelas + gráficos Recharts).
5. **Exportação:**
   - **PDF**: `jspdf` + `jspdf-autotable`. Cabeçalho com título, período, utilizador e data. Os gráficos são convertidos de SVG para PNG (`export/chartToPng.ts`, usando canvas do browser) e inseridos no documento.
   - **Excel**: `exceljs` (build browser). Uma folha por secção, números formatados `#,##0.00`, totais com `SUM`, gráficos como imagem PNG. Gráficos nativos do Excel não são suportados.
6. A API só fornece os dados: `GET /reports/data?tipo&modelo&filtros`. A exportação fica registada no `AuditLog` (`POST /reports/log`).

## 12. API (principais endpoints)

```
POST   /auth/login | /auth/refresh | /auth/logout | /auth/change-password
GET    /me
CRUD   /users  /teams  /teams/:id/members  /users/:id/permissions
CRUD   /providers  /providers/:id/budgets
CRUD   /prices  /prices/:id/rent-prices  /discount-rules  /targets
CRUD   /billing/providers/invoices          ?teamId&ano&mes&providerId&status
POST   /billing/providers/invoices/:id/validate
GET    /billing/providers/summary           ?ano&teamId
CRUD   /generators/sites  /generators/generators
CRUD   /generators/maps
GET    /generators/maps/:id/measurements    ?q&regiao&flag&page
POST   /generators/maps/:id/measurements
POST   /generators/maps/:id/import/preview  # multipart → token + preview
POST   /generators/maps/:id/import/confirm  # {token}
POST   /generators/maps/:id/recalculate
POST   /generators/maps/:id/submit|validate|close|reopen
GET    /generators/summary/:mapId
GET    /generators/validations              ?ano&providerId
GET    /dashboard                           ?tipo&ano&mes&teamId&providerId
GET    /reports/data                        ?tipo&modelo&...
POST   /reports/log
GET    /audit                               ?entity&userId&from&to
```

## 13. Segurança

- Rate-limit no login: 5 tentativas a cada 15 minutos.
- Password obrigatória no primeiro acesso, com mínimo de 10 caracteres.
- CORS só para o domínio da plataforma.
- Cookies `Secure` + `SameSite=Strict`.
- Upload limitado a `.xlsx`, até 20 MB.
- Todas as mutações ficam registadas no `AuditLog`.
- Backup diário com `pg_dump` (cron às 02:00, retenção de 30 dias, cópia para fora da VPS).

## 14. Deploy (VPS, Node 16)

- `nvm use 16` (ou o Node 16 do sistema), depois `node -v` deve mostrar `v16.x`.
- Build: `npm ci && npm run build`. A web gera `apps/web/dist`; a API gera `apps/api/dist`.
- `npx prisma migrate deploy && npx prisma generate`.
- **PM2: um só processo:**
  - `pm2 start apps/api/dist/server.js --name controlo-fact --interpreter $(nvm which 16)`
  - Fixar o interpretador evita arrancar com outra versão do Node.
- Nginx: `/` serve `apps/web/dist` (SPA, com `try_files ... /index.html`); `/api` faz proxy para `127.0.0.1:3000`; `client_max_body_size 25m`.
- `.env`: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`, `PORT=3000`, `SEED_GESTOR_EMAIL`, `SEED_GESTOR_PASSWORD`.
- Script `deploy.sh`: pull → `npm ci` → build → migrate → `pm2 reload controlo-fact`.

## 15. Seed inicial

- Utilizador Gestor (email e password vêm do `.env`).
- Providers: Anglobal (PO 4500614726), Blinder (PO 4500614723), Comatel (PO em branco), todos com orçamento mensal de 2.950.000,00 (linha por omissão, sem equipa, para o ano corrente ou `SEED_ANO`).
- Faixas de desconto da rede: 0–5 → 0%, 6–11 → 35%, 12–17 → 45%, 18–24 → 55%.
- Tabela de preços Anglobal: combustível 420,00, serviço de abastecimento 48,00, IVA 14%. **Aluguer, manutenção e penalizações ficam em branco.**
- **Equipas: nenhuma.** São criadas na ferramenta.
- **Targets: em branco.** São preenchidos na ferramenta (global e por provider).
- Script opcional de migração dos dados existentes (Excel de Providers e Auto de Medição de Agosto de 2026), executado depois de criadas as equipas.

## 16. Pontos em aberto (não bloqueiam o desenvolvimento)

1. Domínio e subdomínio da plataforma na VPS.
2. Regras automáticas de penalização: por agora o valor é inserido manualmente; podem ser automatizadas no futuro.

## 17. Convenções

- Código em inglês; textos da interface em português de Angola.
- Formatação: `1.234.567,89 Kz`; datas `dd/mm/aaaa`.
- Nunca colocar preços, IVA, faixas ou targets fixos no código; ler sempre da BD.
- Os cálculos existem num só lugar (`packages/shared/calc`) e são usados pela API e pela web.
- Testes obrigatórios para `calc/*` (Vitest 0.34), usando linhas reais do Auto de Medição.
- Cada nova dependência: verificar `engines` (Node 16) antes de instalar.

## 18. Identidade visual (Unitel — igual ao ARA)

Mesma paleta e tipografia do projecto **ARA** (`Ievegueni/ARA`, `frontend/src/index.css`), amostradas do logótipo oficial.

- **brand** = laranja `#FB8100` (acções principais, destaques, foco).
- **navy** = azul-marinho `#08003C` (sidebar, títulos, botões escuros).
- **ink** = cinzentos neutros (texto, bordas, fundos).
- Fonte: **Inter Variable** (`@fontsource-variable/inter`).
- Fundo da app `ink-50`, texto `ink-900`; títulos `navy-950`; sidebar `bg-navy-950 text-navy-100`; selecção `brand-200`.

**Logótipos** (em `docs/brand/`, copiar para `apps/web/public/` no Sprint 0):

| Ficheiro | Uso |
|---|---|
| `unitel-logo.png` | Logótipo sobre fundo claro (login, cabeçalho de PDF) |
| `unitel-logo-branco.png` | Logótipo sobre fundo `navy-950` (sidebar) |
| `unitel-simbolo.png` | Símbolo (círculo laranja) para ícones e estados vazios |
| `unitel-logo-slogan.png` | Logótipo com "O próximo mais próximo." (capa de relatórios) |
| `favicon.png` | Favicon |

**Tailwind 3** (o ARA usa Tailwind 4 com `@theme`; aqui os mesmos valores vão em `apps/web/tailwind.config.js`):

```js
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', "ui-sans-serif", "system-ui", "sans-serif"] },
      colors: {
        brand: { 50: "#fff6eb", 100: "#ffe8cc", 200: "#ffcf94", 300: "#ffb257", 400: "#fd9a2b",
                 500: "#fb8100", 600: "#dc6f00", 700: "#b35700", 800: "#8f4508", 900: "#75390b" },
        navy:  { 50: "#f0effa", 100: "#dcdaf2", 200: "#b6b1e3", 300: "#8a82cf", 400: "#5f55b5",
                 500: "#3d3296", 600: "#2a2078", 700: "#1c145e", 800: "#120b4b", 900: "#0c0642", 950: "#08003c" },
        ink:   { 50: "#f7f7f8", 100: "#eeeef0", 200: "#dcdce0", 300: "#b9b9c0", 400: "#8c8c96",
                 500: "#676771", 600: "#4d4d56", 700: "#3a3a41", 800: "#26262b", 900: "#18181b", 950: "#0f0f11" },
      },
    },
  },
};
```

- Gráficos (Recharts) e exportações PDF/Excel usam as mesmas cores: série principal `brand-500`, secundária `navy-950`, restantes em tons `navy`/`ink`. Cabeçalhos de tabelas no PDF/Excel em `navy-950` com texto branco.
- Não usar cores fora destas escalas (excepto vermelho/verde/âmbar para estados e alertas).
- Verificar `engines` de `@fontsource-variable/inter` antes de instalar (Node 16).
