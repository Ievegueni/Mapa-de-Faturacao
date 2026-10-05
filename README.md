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
| `npm run seed` | `prisma db seed` |
| `npm test` | Vitest (shared e API). Os testes de integração da API usam `TEST_DATABASE_URL` (BD recriada a cada execução); sem esta variável são ignorados |

Primeiro acesso: entrar com `SEED_GESTOR_EMAIL` / `SEED_GESTOR_PASSWORD`; a aplicação obriga a trocar a password (mínimo 10 caracteres).

Health check: `GET /api/health` → `200 {"status":"ok","db":"up"}` (503 sem BD).

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
