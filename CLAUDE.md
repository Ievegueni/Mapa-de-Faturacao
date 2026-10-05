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
  teamId String?                // vazio = todas as equipas (por omissão); a linha da equipa sobrepõe-se campo a campo (PO ou orçamento vazios herdam da linha por omissão)
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

**Resumo do mês e Mapa Resumo — decisões de implementação (`calc/summary.ts`):**
- Resumo do mês: Aluguer = aluguer − desconto de rede + manutenção + serviços extras − penalizações (as três categorias somam o total do mapa). Validado = medições validadas/fechadas; IVA calculado sobre o validado.
- Facturado = valor da factura do provider por categoria/zona, quando inserido (campos `fact*Cent` de `MonthlyIndicators`); senão, a soma de todas as medições do mapa. Diferença = facturado − validado.
- Mapa Resumo: aluguer e manutenção = aluguer − desconto de rede + manutenção; total parcial = aluguer e manutenção + combustível + serviço; total global = parcial + transporte extra. As penalizações aparecem à parte (como no Excel) e não são descontadas destes totais.
- Parque de geradores = medições de geradores sem data de remoção até ao fim do mês (confere com o Mapa Resumo real).
- Penalizações: quantidade = medições com valor > 0. Excesso de horas também por escalão de horas acumuladas (35040 / 36480 / 37920 h, como no Excel).
- Variações face ao mês anterior (o Excel divide pelo mês actual; aqui divide-se pelo anterior). Target do provider de "combustível" compara com abastecimento (combustível + serviço), como no Excel. Target global compara com a soma de todos os providers no âmbito do utilizador.

**Detalhes de implementação (`calc/generators.ts`):**
- Arredondamento ao cêntimo meio-para-cima; litros, horas e percentagens tratados em centésimas inteiras (sem vírgula flutuante).
- As faixas aplicam-se às **horas de rede** (`24 − horasTrabalhadas`).
- `DIAS_INVALIDOS`: dias vazios, ≤ 0, não inteiros ou > 31. Com dias ≤ 0 não há horas nem aluguer; com > 31 calcula na mesma.
- `HORAS_NEGATIVAS`: sem desconto (e sem `HORAS_FORA_INTERVALO`). Horas N ou N−1 em falta: sem horas nem desconto, sem flag.
- `SEM_PRECO_COMBUSTIVEL` / `SEM_PRECO_SERV_ABAST` só quando há litros; `SEM_PRECO_ALUGUER` só quando há dias.
- Preço de aluguer: linhas com subtipo/distância vazios valem para todos; entre as compatíveis ganha a mais específica (subtipo pesa mais que distância). Sem compatível, usa a primeira linha da mesma potência.
- Tabela de preços e faixas: a vigência mais recente com início ≤ 1.º dia do mês do mapa.
- Dados mestre (sites e geradores): alterar exige `billing_generators.edit` + `validate`; eliminar também `delete`, e só sem medições.

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
- Orçamento de um provider num conjunto de equipas = soma, por equipa, do orçamento aplicável (equipa → por omissão).
- O PO é preenchido a partir do orçamento aplicável e guardado com a factura.
- Fluxo: `RASCUNHO` → `SUBMETIDO` → `VALIDADO` (devolver: Submetido → Rascunho; reabrir: só o Gestor, Validado → Submetido). Quem não pode validar só altera os seus rascunhos. Factura validada: só valor pago, status e observação.
- O resumo inclui todas as facturas do ano; a opção "Só facturas validadas" limita a Validado/Fechado.
- Migração (`apps/api/scripts/import-providers.ts`): lê as folhas por parceiro (cabeçalho "Valor Total da FT Mensal") e junta os detalhes da folha PAGAMENTOS por parceiro + ano + valor pago (ou mês da data de facturação). Uma factura por parceiro/mês/tipo.
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

**Detalhes de implementação (verificados com o Auto de Medição real de Agosto de 2026):**
- O ficheiro real tem tabelas com filtro por cor que o leitor normal do `exceljs` não abre: usar o **leitor em streaming** (`ExcelJS.stream.xlsx.WorkbookReader`).
- Nomes de coluna comparados sem acentos, pontuação, quebras de linha e sufixos como `.420` ("Litros Abastecidos.420").
- Se várias folhas tiverem o cabeçalho (ex.: `AGOSTO_26` e `Carregamento`), usa a primeira; a pré-visualização permite escolher outra.
- Os preços do Excel são ignorados: aplicam-se os da `PriceTable` do provider do mapa.
- Site identificado por **código P.P. + nome** na equipa (há sites diferentes com o mesmo código, e sites com 2 geradores); o código P.P. não é único.
- Erros (linha não importada): nome, nº de série, região ou província em falta/inválidos; **nº de série repetido no ficheiro**; gerador de outra equipa; medição já submetida/validada.
- Avisos (linha importada): código P.P. partilhado por sites diferentes; proprietário não encontrado ou diferente do provider do mapa; gerador que mudou de site.
- Reimportar substitui os rascunhos do mapa; penalizações e extras vazios no ficheiro mantêm os valores preenchidos na ferramenta.
- O ficheiro real não vai para o repositório (`apps/api/test/fixtures/*.xlsx` está no `.gitignore`); os testes que o usam correm só se estiver presente.

### 9.2 Formulário por site
- Pesquisa por código P.P., nome ou nº de série.
- `horasN1` é preenchido automaticamente com `horasN` do mês anterior.
- Campos manuais (penalizações, serviços extras) começam **em branco**.
- Os cálculos aparecem em tempo real, usando a mesma função de `packages/shared/calc`.
- Atalho: Enter grava e passa para o site seguinte da lista.

### 9.3 Fluxo de estados
`RASCUNHO` (Técnico) → `SUBMETIDO` → `VALIDADO` (Supervisor) → `FECHADO` (fecho do mês; só o Gestor reabre).

- As acções são por mapa e aplicam-se às medições: submeter (quem não valida só submete as suas), validar, devolver (submetidas/validadas → rascunho), fechar (só com todas validadas), reabrir (Gestor; volta a Validado).
- O estado do mapa segue o estado menos avançado das medições, excepto Fechado.
- Recalcular e alterar medições submetidas/validadas: só quem valida. Média de litros (`LITROS_ACIMA_MEDIA`): média por linha do site nos 3 meses anteriores, nos mapas da mesma equipa.

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
