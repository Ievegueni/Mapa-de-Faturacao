# Plataforma de Controlo de Facturação — Unitel

Controlo da facturação de **Providers** e **Geradores** (Manutenção de Rede). Especificação: `CLAUDE.md`. Plano: `SPRINTS.md`.

## Requisitos
- **Node 16** (`nvm use` lê o `.nvmrc`; `node -v` deve mostrar `v16.x`).
- PostgreSQL.

## Arranque
```bash
cp .env.example .env
cp .env.example apps/api/.env   # o Prisma lê o .env da pasta da API
npm ci
npm run migrate                  # cria/actualiza a BD
npm run seed
npm run dev                      # API :3000 · web :5173 (proxy /api)
```

## Scripts
| Script | O que faz |
|---|---|
| `npm run dev` | shared (watch) + API (`ts-node-dev`) + web (Vite) |
| `npm run build` | shared → API (`prisma generate` + `tsc`) → web (`vite build`) |
| `npm run migrate` | `prisma migrate dev` |
| `npm run seed` | `prisma db seed` (produção: Gestor, providers, faixas e preços; sem equipas) |
| `npm run seed:demo` | Dados **fictícios** para testes locais (ver abaixo) |
| `npm test` | Vitest (shared e API). Os testes de integração da API usam `TEST_DATABASE_URL` (BD recriada a cada execução); sem esta variável são ignorados |

Primeiro acesso: entrar com `SEED_GESTOR_EMAIL` / `SEED_GESTOR_PASSWORD`; a aplicação obriga a trocar a password (mínimo 10 caracteres).

Health check: `GET /api/health` → `200 {"status":"ok","db":"up"}` (503 sem BD).

## Dados de demonstração (só para testes locais)
Numa base de dados **vazia** (sem equipas), depois de `npm run migrate`:
```bash
npm run seed:demo
```
Cria (tudo inventado, numa só transacção; ~5 s):
- 6 contas, sem troca de password obrigatória:

| Perfil | Email | Password |
|---|---|---|
| Super admin (Gestor) | `admin@demo.ao` | `Admin-Demo-2026` |
| Supervisora (Providers Luanda e Sul) | `ana.supervisora@demo.ao` | `Demo-2026-Teste` |
| Supervisor (Geradores Norte e Sul) | `bruno.supervisor@demo.ao` | `Demo-2026-Teste` |
| Técnica (Geradores Norte) | `carla.tecnica@demo.ao` | `Demo-2026-Teste` |
| Técnico (Geradores Sul) | `david.tecnico@demo.ao` | `Demo-2026-Teste` |
| Técnica (Providers Luanda; pode exportar) | `elsa.tecnica@demo.ao` | `Demo-2026-Teste` |

- 4 equipas, preços completos (Comatel sem aluguer, para ver a flag `SEM_PRECO_ALUGUER`), targets global e por provider.
- 100 sites / 102 geradores e mapas de Janeiro até ao mês anterior: meses antigos fechados, penúltimo validado, último em rascunho/submetido; penalizações, indicadores manuais e avisos (horas negativas, litros acima da média, gerador removido).
- 72 facturas de providers em vários estados, com pagamentos parciais e um mês acima do orçamento.

Passwords e email do admin podem ser alterados com `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_USER_PASSWORD`; o ano com `SEED_ANO`.
Para recomeçar: `cd apps/api && npx prisma migrate reset --force` (**apaga a BD**) e voltar a correr `npm run seed:demo`. Nunca correr numa BD com dados reais (o script recusa se já houver equipas).

## Migração dos dados existentes
Depois de criar as equipas na ferramenta:
```bash
npm run import:providers -w apps/api -- --ficheiro "Novo Mapa de Facturação.xlsx" --equipa "<equipa de Providers>" --ano 2026
```
- As facturas ficam validadas (dados históricos); `--rascunho` deixa-as em rascunho.
- Se já existirem facturas do mesmo parceiro/mês/tipo, são ignoradas; `--substituir` troca-as pelas do ficheiro.
- O Auto de Medição importa-se na página do mapa de geradores (Importar Excel).

## Estrutura
```
apps/api        Fastify 4 + Prisma 5 (CommonJS)
apps/web        Vite 4 + React 18 + Tailwind 3 + React Router 6 + TanStack Query 4
packages/shared Funções partilhadas (compilado para CommonJS; a web importa o código-fonte)
docs/brand      Logótipos Unitel
```

## Node 16 e dependências
- `.npmrc` tem `engine-strict=true` e `save-exact=true`: o `npm ci` falha se algum pacote exigir Node ≥ 18.
- Algumas dependências transitivas publicaram versões só para Node ≥ 18/20. Estão fixadas em `overrides` no `package.json` da raiz:
  - `node-releases` 2.0.44 (via browserslist)
  - `postcss-load-config` 4.0.2 (via tailwindcss)
  - `toad-cache` 3.7.0 (via fastify)
- Ao adicionar dependências, se o `npm install` falhar com `EBADENGINE`, descer de versão ou acrescentar um override.
