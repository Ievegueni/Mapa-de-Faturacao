import multipart from "@fastify/multipart";
import { randomBytes } from "crypto";
import { FastifyPluginAsync } from "fastify";
import { hundredthsToString } from "@cf/shared";
import { badRequest, notFound } from "../../../lib/errors";
import { AuthUser } from "../../../plugins/auth";
import { assertTeamAccess, requirePermission } from "../../../plugins/rbac";
import { loadMapContext, syncMapState } from "../compute";
import { parseAutoMedicao, ParsedRow } from "./parser";
import { buildImportPlan, executePlan, ImportPlan } from "./plan";

const MAX_BYTES = 20 * 1024 * 1024;
const TTL_MS = 15 * 60 * 1000;

interface Pending {
  userId: string;
  mapId: string;
  fileName: string;
  sheet: string | null;
  rows: ParsedRow[];
  expires: number;
}

/** Ficheiros processados à espera de confirmação (em memória, 15 minutos). */
const pending = new Map<string, Pending>();
function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}

function summarize(plan: ImportPlan) {
  const flags: Record<string, number> = {};
  for (const r of plan.rows) for (const f of r.data.flags) flags[f] = (flags[f] || 0) + 1;
  const sum = (k: "totalCent" | "combustivelCent" | "servAbastCent" | "aluguerCent" | "descontoRedeCent") =>
    plan.rows.reduce((a, r) => a + r.data[k], BigInt(0));
  return {
    linhasValidas: plan.rows.length,
    sitesNovos: plan.newSites.size,
    sitesActualizados: plan.updatedSites.size,
    geradoresNovos: plan.newGenerators.size,
    geradoresActualizados: plan.updatedGenerators.size,
    medicoesNovas: plan.rows.filter((r) => !r.measurementId).length,
    medicoesActualizadas: plan.rows.filter((r) => r.measurementId).length,
    litrosFicheiro: hundredthsToString(plan.litrosFicheiroH),
    litrosValidos: hundredthsToString(plan.litrosValidosH),
    totais: {
      combustivelCent: sum("combustivelCent"),
      servAbastCent: sum("servAbastCent"),
      aluguerCent: sum("aluguerCent"),
      descontoRedeCent: sum("descontoRedeCent"),
      totalCent: sum("totalCent"),
    },
    flags,
    erros: plan.errors,
    avisos: plan.warnings,
    amostra: plan.rows.slice(0, 100).map((r) => ({
      linha: r.line,
      site: r.siteNome,
      codigoPP: r.codigoPP,
      numeroSerie: r.numeroSerie,
      novo: r.generatorRef.startsWith("new:"),
      dias: r.data.dias,
      litros: r.data.litros,
      horasRede: r.data.horasRede,
      descontoPercent: r.data.descontoPercent,
      totalCent: r.data.totalCent,
      flags: r.data.flags,
    })),
  };
}

const importRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1, fields: 5 } });
  app.addHook("onRequest", app.authenticate);
  const perm = requirePermission("billing_generators", "import");

  async function getMap(user: AuthUser, id: string) {
    const map = await app.prisma.generatorMonthlyMap.findUnique({ where: { id } });
    if (!map) throw notFound("Mapa não encontrado");
    assertTeamAccess(user, map.teamId);
    if (map.state === "FECHADO") throw badRequest("O mapa está fechado");
    return map;
  }

  const allowedTeams = (u: AuthUser) => (u.role === "GESTOR" ? null : u.teamIds);

  /** Passo 1: upload → leitura → plano sem gravar. Devolve um token válido 15 minutos. */
  app.post<{ Params: { id: string } }>("/generators/maps/:id/import/preview", { preHandler: perm }, async (req) => {
    sweep();
    const map = await getMap(req.auth, req.params.id);
    if (!req.isMultipart()) throw badRequest("Envie o ficheiro .xlsx");
    const file = await req.file();
    if (!file) throw badRequest("Envie o ficheiro .xlsx");
    if (!/\.xlsx$/i.test(file.filename)) throw badRequest("Só são aceites ficheiros .xlsx");
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw badRequest("O ficheiro excede 20 MB");
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw badRequest("O ficheiro não é um .xlsx válido");
    const sheetField = file.fields.sheet as { value?: string } | undefined;
    const sheet = typeof sheetField?.value === "string" && sheetField.value ? sheetField.value : undefined;

    let parsed;
    try {
      parsed = await parseAutoMedicao(buffer, { sheet });
    } catch (err) {
      req.log.warn({ err }, "import: leitura falhou");
      throw badRequest("Não foi possível ler o ficheiro Excel");
    }
    if (!parsed.sheet) throw badRequest('Não foi encontrada nenhuma folha com a coluna "Nome Ponto Produção"');
    if (parsed.missingColumns.length) throw badRequest(`Faltam colunas obrigatórias: ${parsed.missingColumns.join(", ")}`);

    const ctx = await loadMapContext(app.prisma, map.id);
    const plan = await buildImportPlan(app.prisma, ctx, parsed.rows, allowedTeams(req.auth));
    const token = randomBytes(18).toString("hex");
    pending.set(token, { userId: req.auth.id, mapId: map.id, fileName: file.filename, sheet: parsed.sheet, rows: parsed.rows, expires: Date.now() + TTL_MS });
    return {
      token,
      expiraEm: new Date(Date.now() + TTL_MS).toISOString(),
      ficheiro: file.filename,
      folhas: parsed.sheets,
      folha: parsed.sheet,
      linhaCabecalho: parsed.headerLine,
      linhasLidas: parsed.rows.length,
      semPrecos: !ctx!.priceTable,
      ...summarize(plan),
    };
  });

  /** Passo 2: confirmar → grava numa transacção, em lotes de 200, medições em rascunho. */
  app.post<{ Params: { id: string }; Body: { token?: string } }>("/generators/maps/:id/import/confirm", { preHandler: perm }, async (req) => {
    sweep();
    const token = req.body?.token;
    const p = token ? pending.get(token) : undefined;
    if (!p || p.userId !== req.auth.id || p.mapId !== req.params.id) throw badRequest("A pré-visualização expirou ou é inválida; carregue o ficheiro de novo");
    const map = await getMap(req.auth, req.params.id);
    const t0 = Date.now();
    const result = await app.prisma.$transaction(
      async (tx) => {
        const ctx = await loadMapContext(tx, map.id);
        const plan = await buildImportPlan(tx, ctx, p.rows, allowedTeams(req.auth));
        const written = await executePlan(tx, ctx, plan, req.auth.id);
        return { plan, written };
      },
      { timeout: 180000, maxWait: 10000 },
    );
    pending.delete(token!);
    await syncMapState(app.prisma, map.id);
    const summary = summarize(result.plan);
    await app.audit({
      userId: req.auth.id,
      entity: "GeneratorMonthlyMap",
      entityId: map.id,
      action: "import",
      diff: { ficheiro: p.fileName, folha: p.sheet, ...result.written, erros: summary.erros.length, litros: summary.litrosValidos },
    });
    return { ...result.written, litrosImportados: summary.litrosValidos, litrosFicheiro: summary.litrosFicheiro, erros: summary.erros, duracaoMs: Date.now() - t0 };
  });
};

export default importRoutes;
