import { Prisma, PrismaClient } from "@prisma/client";
import { toDate, toIsoDate } from "../../../lib/dates";
import { buildMeasurementData, MapContext, mediaLitrosBySite } from "../compute";
import { ParsedRow } from "./parser";

type Db = PrismaClient | Prisma.TransactionClient;

const BATCH = 200;

const norm = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Identidade do site na equipa: código P.P. + nome (o código sozinho não é único no ficheiro real). */
const siteKey = (codigoPP: string | null, nome: string) => `${norm(codigoPP)}|${norm(nome)}`;
/** Nome do proprietário sem forma jurídica nem pontuação ("Anglobal, S.A." → "anglobal"). */
const ownerKey = (s: string) =>
  norm(s).replace(/\b(s\.?\s?a\.?|lda\.?|limitada|sarl)\b/g, "").replace(/[^a-z0-9]/g, "");

type SiteFields = ParsedRow["site"];

export interface PlanRow {
  line: number;
  siteRef: string; // id existente ou "new:<key>"
  generatorRef: string; // id existente ou "new:<serie>"
  siteNome: string;
  codigoPP: string | null;
  numeroSerie: string;
  measurementId: string | null;
  data: ReturnType<typeof buildMeasurementData>;
}

export interface ImportPlan {
  newSites: Map<string, SiteFields>;
  updatedSites: Map<string, Partial<SiteFields>>;
  newGenerators: Map<string, { siteRef: string; providerId: string; numeroSerie: string; numeroActivo: string | null; potenciaKVA: number | null; dataInstalacao: Date | null; dataRemocao: Date | null; dataEntrada: Date | null }>;
  updatedGenerators: Map<string, Prisma.GeneratorUncheckedUpdateInput & { siteRef?: string }>;
  rows: PlanRow[];
  errors: { line: number; message: string }[];
  warnings: { line: number; message: string }[];
  litrosFicheiroH: bigint;
  litrosValidosH: bigint;
}

const h = (v: string | null) => (v ? BigInt(v.replace(".", "")) : BigInt(0));

/** Resolve as linhas lidas contra a BD (só leituras). A gravação é feita por executePlan. */
export async function buildImportPlan(db: Db, ctx: MapContext, parsed: ParsedRow[], allowedTeamIds: string[] | null): Promise<ImportPlan> {
  const { map } = ctx!;
  const plan: ImportPlan = {
    newSites: new Map(),
    updatedSites: new Map(),
    newGenerators: new Map(),
    updatedGenerators: new Map(),
    rows: [],
    errors: [],
    warnings: [],
    litrosFicheiroH: BigInt(0),
    litrosValidosH: BigInt(0),
  };

  const series = Array.from(new Set(parsed.map((r) => r.generator.numeroSerie).filter(Boolean)));
  const [sites, generators, measurements, providers, media] = await Promise.all([
    db.site.findMany({ where: { teamId: map.teamId } }),
    db.generator.findMany({ where: { numeroSerie: { in: series } }, include: { site: { select: { teamId: true } } } }),
    db.generatorMeasurement.findMany({ where: { mapId: map.id }, select: { id: true, generatorId: true, state: true, servExtrasCent: true, penExcessoHorasCent: true, penSLACent: true, penNivelCombustCent: true, penAvariaCent: true } }),
    db.provider.findMany({ where: { ativo: true, tipo: "GERADORES" }, select: { id: true, nome: true } }),
    mediaLitrosBySite(db, map.teamId, map.ano, map.mes),
  ]);

  const siteByKey = new Map(sites.map((s) => [siteKey(s.codigoPP, s.nome), s]));
  const genBySerie = new Map(generators.map((g) => [g.numeroSerie, g]));
  const measByGen = new Map(measurements.map((m) => [m.generatorId, m]));
  const providerByKey = new Map(providers.map((p) => [ownerKey(p.nome), p]));
  const findOwner = (txt: string | null) => {
    if (!txt) return null;
    const k = ownerKey(txt);
    if (providerByKey.has(k)) return providerByKey.get(k)!;
    for (const [pk, p] of providerByKey) if (pk && (k.startsWith(pk) || pk.startsWith(k))) return p;
    return null;
  };

  const seenSerie = new Map<string, number>();
  const ppNames = new Map<string, { nome: string; line: number }>();
  const ownerWarned = new Set<string>();

  for (const r of parsed) {
    plan.litrosFicheiroH += h(r.measurement.litros);
    if (r.errors.length) {
      for (const e of r.errors) plan.errors.push({ line: r.line, message: e });
      continue;
    }
    const serie = r.generator.numeroSerie;
    const prev = seenSerie.get(serie);
    if (prev) {
      plan.errors.push({ line: r.line, message: `Nº de série ${serie} repetido no ficheiro (já na linha ${prev}); linha ignorada` });
      continue;
    }
    seenSerie.set(serie, r.line);

    if (r.site.codigoPP) {
      const other = ppNames.get(norm(r.site.codigoPP));
      if (other && norm(other.nome) !== norm(r.site.nome)) {
        plan.warnings.push({ line: r.line, message: `Código P.P. ${r.site.codigoPP} também usado pelo site "${other.nome}" (linha ${other.line}); ficam como sites diferentes` });
      } else if (!other) ppNames.set(norm(r.site.codigoPP), { nome: r.site.nome, line: r.line });
    }

    // Site
    const key = siteKey(r.site.codigoPP, r.site.nome);
    const existingSite = siteByKey.get(key);
    let siteRef: string;
    let siteData: SiteFields;
    if (existingSite) {
      siteRef = existingSite.id;
      const changes: Partial<SiteFields> = {};
      for (const [k, v] of Object.entries(r.site) as [keyof SiteFields, never][]) {
        if (v !== null && (existingSite as Record<string, unknown>)[k] !== v) (changes as Record<string, unknown>)[k] = v;
      }
      if (Object.keys(changes).length) plan.updatedSites.set(existingSite.id, { ...(plan.updatedSites.get(existingSite.id) || {}), ...changes });
      siteData = { ...(existingSite as unknown as SiteFields), ...changes };
    } else {
      siteRef = `new:${key}`;
      if (!plan.newSites.has(siteRef)) plan.newSites.set(siteRef, r.site);
      siteData = plan.newSites.get(siteRef)!;
    }

    // Proprietário
    const owner = findOwner(r.generator.proprietario);
    const providerId = owner?.id ?? map.providerId;
    if (!owner && r.generator.proprietario && !ownerWarned.has(r.generator.proprietario)) {
      ownerWarned.add(r.generator.proprietario);
      plan.warnings.push({ line: r.line, message: `Proprietário "${r.generator.proprietario}" não encontrado; usado o provider do mapa (${ctx!.map.provider.nome})` });
    } else if (owner && owner.id !== map.providerId && !ownerWarned.has(owner.id)) {
      ownerWarned.add(owner.id);
      plan.warnings.push({ line: r.line, message: `Proprietário ${owner.nome} diferente do provider do mapa (${ctx!.map.provider.nome})` });
    }

    // Gerador
    const g = r.generator;
    const dates = {
      dataInstalacao: g.dataInstalacao ? toDate(g.dataInstalacao) : null,
      dataRemocao: g.dataRemocao ? toDate(g.dataRemocao) : null,
      dataEntrada: g.dataEntrada ? toDate(g.dataEntrada) : null,
    };
    const existingGen = genBySerie.get(serie);
    let generatorRef: string;
    let genKey: { potenciaKVA: number | null; dataRemocao: Date | null };
    if (existingGen) {
      if (allowedTeamIds && !allowedTeamIds.includes(existingGen.site.teamId)) {
        plan.errors.push({ line: r.line, message: `O gerador ${serie} pertence a um site de outra equipa` });
        continue;
      }
      if (existingGen.site.teamId !== map.teamId) {
        plan.errors.push({ line: r.line, message: `O gerador ${serie} pertence a um site de outra equipa; mude-o de site antes de importar` });
        continue;
      }
      generatorRef = existingGen.id;
      const upd: Prisma.GeneratorUncheckedUpdateInput & { siteRef?: string } = {};
      if (siteRef !== existingGen.siteId) {
        upd.siteRef = siteRef;
        plan.warnings.push({ line: r.line, message: `Gerador ${serie} mudou de site` });
      }
      if (g.numeroActivo && g.numeroActivo !== existingGen.numeroActivo) upd.numeroActivo = g.numeroActivo;
      if (g.potenciaKVA !== null && g.potenciaKVA !== existingGen.potenciaKVA) upd.potenciaKVA = g.potenciaKVA;
      if (providerId !== existingGen.providerId) upd.providerId = providerId;
      for (const k of ["dataInstalacao", "dataRemocao", "dataEntrada"] as const) {
        const v = dates[k];
        const cur = existingGen[k];
        if (v && (!cur || toIsoDate(cur) !== toIsoDate(v))) upd[k] = v;
      }
      if (Object.keys(upd).length) plan.updatedGenerators.set(existingGen.id, upd);
      genKey = {
        potenciaKVA: (upd.potenciaKVA as number | undefined) ?? existingGen.potenciaKVA,
        dataRemocao: (upd.dataRemocao as Date | undefined) ?? existingGen.dataRemocao,
      };
    } else {
      generatorRef = `new:${serie}`;
      plan.newGenerators.set(generatorRef, { siteRef, providerId, numeroSerie: serie, numeroActivo: g.numeroActivo, potenciaKVA: g.potenciaKVA, ...dates });
      genKey = { potenciaKVA: g.potenciaKVA, dataRemocao: dates.dataRemocao };
    }

    // Medição
    const existingMeas = existingGen ? measByGen.get(existingGen.id) : undefined;
    if (existingMeas && existingMeas.state !== "RASCUNHO") {
      plan.errors.push({ line: r.line, message: `A medição do gerador ${serie} já está ${existingMeas.state.toLowerCase()} e não é substituída` });
      continue;
    }
    // Valores manuais vazios no ficheiro mantêm o que já foi preenchido na ferramenta.
    const m = r.measurement;
    const keep = (v: string | null, cur: bigint | null | undefined) => v ?? (cur === null || cur === undefined ? null : cur.toString());
    const fields = {
      ...m,
      servExtrasCent: keep(m.servExtrasCent, existingMeas?.servExtrasCent),
      penExcessoHorasCent: keep(m.penExcessoHorasCent, existingMeas?.penExcessoHorasCent),
      penSLACent: keep(m.penSLACent, existingMeas?.penSLACent),
      penNivelCombustCent: keep(m.penNivelCombustCent, existingMeas?.penNivelCombustCent),
      penAvariaCent: keep(m.penAvariaCent, existingMeas?.penAvariaCent),
    };
    const mediaSite = existingSite ? media.get(existingSite.id) ?? null : null;
    plan.rows.push({
      line: r.line,
      siteRef,
      generatorRef,
      siteNome: siteData.nome,
      codigoPP: siteData.codigoPP,
      numeroSerie: serie,
      measurementId: existingMeas?.id ?? null,
      data: buildMeasurementData(ctx, siteData, genKey, fields, mediaSite),
    });
    plan.litrosValidosH += h(m.litros);
  }
  return plan;
}

async function inBatches<T>(items: T[], fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += BATCH) await fn(items.slice(i, i + BATCH));
}

/** Grava o plano numa transacção, em lotes de 200 (CLAUDE.md §9.1). */
export async function executePlan(tx: Prisma.TransactionClient, ctx: MapContext, plan: ImportPlan, userId: string) {
  const { map } = ctx!;
  const ids = new Map<string, string>();

  // Sites novos
  const newSites = Array.from(plan.newSites.entries());
  await inBatches(newSites, async (batch) => {
    const created = await tx.site.createManyAndReturn({ data: batch.map(([, s]) => ({ ...s, teamId: map.teamId })), select: { id: true, codigoPP: true, nome: true } });
    for (const c of created) ids.set(`new:${siteKey(c.codigoPP, c.nome)}`, c.id);
  });
  await inBatches(Array.from(plan.updatedSites.entries()), (batch) =>
    Promise.all(batch.map(([id, data]) => tx.site.update({ where: { id }, data }))),
  );
  const ref = (r: string) => (r.startsWith("new:") ? ids.get(r)! : r);

  // Geradores
  const newGens = Array.from(plan.newGenerators.entries());
  await inBatches(newGens, async (batch) => {
    const created = await tx.generator.createManyAndReturn({
      data: batch.map(([, g]) => {
        const { siteRef, ...rest } = g;
        return { ...rest, siteId: ref(siteRef) };
      }),
      select: { id: true, numeroSerie: true },
    });
    for (const c of created) ids.set(`new:${c.numeroSerie}`, c.id);
  });
  await inBatches(Array.from(plan.updatedGenerators.entries()), (batch) =>
    Promise.all(
      batch.map(([id, upd]) => {
        const { siteRef, ...data } = upd;
        return tx.generator.update({ where: { id }, data: siteRef ? { ...data, siteId: ref(siteRef) } : data });
      }),
    ),
  );

  // Medições (sempre em rascunho)
  const toCreate = plan.rows.filter((r) => !r.measurementId);
  const toUpdate = plan.rows.filter((r) => r.measurementId);
  await inBatches(toCreate, (batch) =>
    tx.generatorMeasurement.createMany({
      data: batch.map((r) => ({ ...r.data, mapId: map.id, siteId: ref(r.siteRef), generatorId: ref(r.generatorRef), createdById: userId, state: "RASCUNHO" as const })),
    }),
  );
  await inBatches(toUpdate, (batch) =>
    Promise.all(batch.map((r) => tx.generatorMeasurement.update({ where: { id: r.measurementId! }, data: { ...r.data, siteId: ref(r.siteRef) } }))),
  );

  return {
    sitesCriados: newSites.length,
    sitesActualizados: plan.updatedSites.size,
    geradoresCriados: newGens.length,
    geradoresActualizados: plan.updatedGenerators.size,
    medicoesCriadas: toCreate.length,
    medicoesActualizadas: toUpdate.length,
  };
}
