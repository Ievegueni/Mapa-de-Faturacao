/**
 * Seed de DEMONSTRAÇÃO (dados fictícios) para testar a plataforma localmente.
 * NÃO usar em produção: o seed de produção (seed.ts) não cria equipas nem dados (CLAUDE.md §15).
 *
 *   npm run seed:demo
 *
 * Cria: super admin (Gestor), supervisores e técnicos, 4 equipas, preços completos, targets,
 * ~100 sites com gerador, mapas mensais (Jan → mês anterior) em vários estados e facturas de providers.
 * Todos os nomes, códigos e valores são inventados.
 */
import { Prisma, PrismaClient, RecordState } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { buildMeasurementData, loadMapContext, mediaLitrosBySite, syncMapState } from "../src/modules/generators/compute";
import { seedConfig } from "./seed-config";

const prisma = new PrismaClient();

// ---------- Aleatório determinístico (os mesmos dados em cada execução) ----------
let seed = 20260101;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + rand() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const kz = (v: number) => BigInt(Math.round(v * 100)); // Kz → cêntimos
const daysIn = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

const ADMIN_EMAIL = (process.env.DEMO_ADMIN_EMAIL || "admin@demo.ao").toLowerCase();
const ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || "Admin-Demo-2026";
const USER_PASSWORD = process.env.DEMO_USER_PASSWORD || "Demo-2026-Teste";

const CONSUMO_L_H: Record<number, number> = { 15: 2.2, 20: 2.8, 30: 3.9, 45: 5.6 };

async function main() {
  // Período: de Janeiro até ao mês anterior ao actual (ou SEED_ANO completo, se for um ano passado).
  const hoje = new Date();
  const ref = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 1, 1));
  const ano = Number(process.env.SEED_ANO) || ref.getUTCFullYear();
  const ultimoMes = ano < ref.getUTCFullYear() ? 12 : ano > ref.getUTCFullYear() ? 1 : ref.getUTCMonth() + 1;
  process.env.SEED_ANO = String(ano);

  // Só corre numa base de dados sem equipas (acabada de criar), para nunca misturar dados fictícios com dados reais.
  if ((await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })) || (await prisma.team.count()) > 0) {
    console.log("A base de dados já tem equipas ou dados de demonstração: o seed demo só corre numa base de dados vazia.");
    console.log("Para recomeçar do zero:");
    console.log("  cd apps/api && npx prisma migrate reset --force   (APAGA a base de dados)");
    console.log("  cd ../.. && npm run seed:demo");
    return;
  }

  console.log(`Seed demo: ano ${ano}, meses 1–${ultimoMes}.`);
  await seedConfig(prisma);

  // Tudo numa transacção: ou fica tudo gravado, ou nada.
  const { nGens, nInvoices } = await prisma.$transaction(
    async (db) => {
    // ---------- Utilizadores ----------
    const userHash = await bcrypt.hash(USER_PASSWORD, 10);
    const admin = await db.user.create({
      data: { nome: "Administrador", email: ADMIN_EMAIL, role: "GESTOR", passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10), mustChangePassword: false },
    });
    const mk = (nome: string, email: string, role: "SUPERVISOR" | "TECNICO") =>
      db.user.create({ data: { nome, email, role, passwordHash: userHash, mustChangePassword: false } });
    const anaSup = await mk("Ana Supervisora", "ana.supervisora@demo.ao", "SUPERVISOR");
    const brunoSup = await mk("Bruno Supervisor", "bruno.supervisor@demo.ao", "SUPERVISOR");
    const carlaTec = await mk("Carla Técnica", "carla.tecnica@demo.ao", "TECNICO");
    const davidTec = await mk("David Técnico", "david.tecnico@demo.ao", "TECNICO");
    const elsaTec = await mk("Elsa Técnica", "elsa.tecnica@demo.ao", "TECNICO");

    // ---------- Equipas ----------
    const team = (nome: string, tipo: "PROVIDERS" | "GERADORES") => db.team.create({ data: { nome, tipo } });
    const tProvLuanda = await team("Providers Luanda", "PROVIDERS");
    const tProvSul = await team("Providers Sul", "PROVIDERS");
    const tGerNorte = await team("Geradores Norte", "GERADORES");
    const tGerSul = await team("Geradores Sul", "GERADORES");
    await db.teamMember.createMany({
      data: [
        { userId: anaSup.id, teamId: tProvLuanda.id },
        { userId: anaSup.id, teamId: tProvSul.id },
        { userId: elsaTec.id, teamId: tProvLuanda.id },
        { userId: brunoSup.id, teamId: tGerNorte.id },
        { userId: brunoSup.id, teamId: tGerSul.id },
        { userId: carlaTec.id, teamId: tGerNorte.id },
        { userId: davidTec.id, teamId: tGerSul.id },
      ],
    });
    // Exemplo de permissão ajustada: a Elsa (técnica) também pode exportar facturas de providers.
    await db.userPermission.create({ data: { userId: elsaTec.id, module: "billing_providers", action: "export", allowed: true } });

    // ---------- Providers, orçamentos e preços ----------
    const providers = await db.provider.findMany({ where: { nome: { in: ["Anglobal", "Blinder", "Comatel"] } } });
    const P = Object.fromEntries(providers.map((p) => [p.nome, p])) as Record<"Anglobal" | "Blinder" | "Comatel", (typeof providers)[number]>;
    await db.provider.update({ where: { id: P.Anglobal.id }, data: { nif: "5000000001", contacto: "+244 900 000 001", email: "facturacao@anglobal.demo" } });
    await db.provider.update({ where: { id: P.Blinder.id }, data: { nif: "5000000002", contacto: "+244 900 000 002", email: "facturacao@blinder.demo" } });
    await db.provider.update({ where: { id: P.Comatel.id }, data: { nif: "5000000003", contacto: "+244 900 000 003", email: "facturacao@comatel.demo" } });
    // Orçamento específico de equipa (sobrepõe-se ao por omissão): Blinder na equipa Providers Sul.
    await db.providerBudget.create({ data: { providerId: P.Blinder.id, teamId: tProvSul.id, ano, po: "4500700001", orcamentoMensalCent: kz(1500000) } });

    const inicio = new Date(Date.UTC(ano, 0, 1));
    const rent = (v15: number, v20: number, v30: number, v45: number) => ({
      create: [
        { potenciaKVA: 15, precoDiaCent: kz(v15) },
        { potenciaKVA: 20, precoDiaCent: kz(v20) },
        { potenciaKVA: 30, precoDiaCent: kz(v30) },
        { potenciaKVA: 45, precoDiaCent: kz(v45) },
        { potenciaKVA: 20, subtipo: "Outdoor", distancia: "Mais de 50 km", precoDiaCent: kz(v20 * 1.1) },
      ],
    });
    // Anglobal: completa a tabela do seed (aluguer e manutenção).
    const angTable = await db.priceTable.findFirstOrThrow({ where: { providerId: P.Anglobal.id }, orderBy: { validFrom: "desc" } });
    await db.priceTable.update({ where: { id: angTable.id }, data: { precoManutencaoCent: kz(25000), rentPrices: rent(8500, 9800, 12500, 16000) } });
    await db.priceTable.create({
      data: { providerId: P.Blinder.id, validFrom: inicio, precoCombustivelCent: kz(415), precoServAbastCent: kz(50), precoManutencaoCent: kz(27000), ivaPercent: "14", rentPrices: rent(8200, 9500, 12000, 15800) },
    });
    // Comatel sem preços de aluguer: mostra a flag SEM_PRECO_ALUGUER e o aviso no dashboard.
    await db.priceTable.create({ data: { providerId: P.Comatel.id, validFrom: inicio, precoCombustivelCent: kz(425), precoServAbastCent: kz(45), precoManutencaoCent: kz(24000), ivaPercent: "14" } });

    // ---------- Sites e geradores ----------
    const zonas = {
      norte: [
        ["Norte", ["Zaire", "Uíge", "Cabinda"]],
        ["Centro", ["Luanda", "Luanda", "Bengo", "Cuanza Norte"]],
      ],
      sul: [
        ["Sul", ["Huíla", "Namibe", "Cunene", "Cuando Cubango"]],
        ["Centro", ["Benguela", "Huambo", "Bié"]],
        ["Leste", ["Lunda Norte", "Lunda Sul", "Moxico"]],
      ],
    } as const;
    type Gen = { id: string; siteId: string; teamId: string; providerId: string; kva: number; hDia: number; horas: number; removidoMes: number | null };
    const gens: Gen[] = [];

    async function createSites(teamId: string, prefixo: string, regioes: readonly (readonly [string, readonly string[]])[], provs: string[], n: number) {
      for (let i = 1; i <= n; i++) {
        const [regiao, provincias] = pick(regioes);
        const provincia = pick(provincias);
        const rede = chance(0.6);
        const site = await db.site.create({
          data: {
            teamId,
            codigoPP: `DM-${prefixo}-${String(i).padStart(4, "0")}`,
            codigoLocalizacao: `LOC-${prefixo}${String(i).padStart(4, "0")}`,
            nome: `${provincia} ${prefixo}${String(i).padStart(3, "0")}`,
            regiao,
            provincia,
            nivel: pick(["N1", "N2", "N3"]),
            tipo: pick(["Macro", "Macro", "Micro"]),
            powerCube1000: chance(0.1),
            subtipo: pick(["Outdoor", "Indoor"]),
            distanciaFacturacao: pick(["Até 50 km", "Mais de 50 km"]),
            tipoAcesso: pick(["Estrada asfaltada", "Picada", "Terra batida"]),
            pavimentadoInterior: chance(0.5),
            ligadoRede: rede,
          },
        });
        const nGen = i === 7 ? 2 : 1; // um site com 2 geradores
        for (let g = 0; g < nGen; g++) {
          const kva = pick([15, 15, 20, 20, 20, 30, 45]);
          const serie = `DEMO-${prefixo}-${String(i).padStart(4, "0")}${g ? "B" : ""}`;
          const removidoMes = i === 13 && ultimoMes >= 4 ? ultimoMes - 2 : null; // um gerador removido a meio do ano
          const gen = await db.generator.create({
            data: {
              siteId: site.id,
              providerId: P[provs[(i + g) % provs.length] as keyof typeof P].id,
              numeroSerie: serie,
              numeroActivo: `AT-${serie.slice(5)}`,
              potenciaKVA: kva,
              dataInstalacao: new Date(Date.UTC(int(2021, ano - 1), int(0, 11), int(1, 28))),
              dataRemocao: removidoMes ? new Date(Date.UTC(ano, removidoMes - 1, 15)) : null,
            },
          });
          // Contador de horas inicial; alguns perto dos escalões de penalização (35040 / 36480 / 37920 h)
          const horas = i % 17 === 0 ? between(35500, 38500) : between(3000, 30000);
          // Horas de funcionamento por dia: estáveis por gerador (rede → poucas horas), com variação mensal de ±15%
          const hDia = rede ? between(2, 14) : between(16, 22);
          gens.push({ id: gen.id, siteId: site.id, teamId, providerId: gen.providerId, kva, hDia, horas: Math.round(horas), removidoMes });
        }
      }
    }
    await createSites(tGerNorte.id, "N", zonas.norte, ["Anglobal", "Blinder"], 50);
    await createSites(tGerSul.id, "S", zonas.sul, ["Comatel", "Anglobal"], 50);
    const siteInfo = new Map((await db.site.findMany({ where: { teamId: { in: [tGerNorte.id, tGerSul.id] } } })).map((s) => [s.id, s]));
    const genInfo = new Map((await db.generator.findMany({ where: { id: { in: gens.map((g) => g.id) } } })).map((g) => [g.id, g]));

    // ---------- Mapas mensais e medições ----------
    const totaisProvMes = new Map<string, { aluguer: bigint; abast: bigint }>(); // `${providerId}:${mes}`
    const geradoresTeams = [
      { team: tGerNorte, provs: [P.Anglobal, P.Blinder], tecnico: carlaTec },
      { team: tGerSul, provs: [P.Comatel, P.Anglobal], tecnico: davidTec },
    ];
    for (let mes = 1; mes <= ultimoMes; mes++) {
      const dias = daysIn(ano, mes);
      for (const gt of geradoresTeams) {
        const medias = await mediaLitrosBySite(db, gt.team.id, ano, mes);
        for (const [pi, prov] of gt.provs.entries()) {
          // Estado: meses antigos fechados, penúltimo validado, último em curso (rascunho ou submetido).
          const alvo: RecordState = mes <= ultimoMes - 2 ? "FECHADO" : mes === ultimoMes - 1 ? "VALIDADO" : pi === 0 ? "SUBMETIDO" : "RASCUNHO";
          const map = await db.generatorMonthlyMap.create({ data: { teamId: gt.team.id, providerId: prov.id, ano, mes } });
          const ctx = await loadMapContext(db, map.id);
          const rows: Prisma.GeneratorMeasurementCreateManyInput[] = [];
          let soma = { aluguer: BigInt(0), abast: BigInt(0) };
          for (const g of gens.filter((x) => x.teamId === gt.team.id && x.providerId === prov.id)) {
            if (g.removidoMes !== null && mes > g.removidoMes) continue;
            const hDia = Math.min(24, g.hDia * between(0.85, 1.15));
            const horasN1 = g.horas;
            let horasN = Math.round((horasN1 + hDia * dias) * 100) / 100;
            if (mes === ultimoMes && g.siteId === gens.find((x) => x.teamId === gt.team.id)!.siteId) horasN = horasN1 - 12; // erro de leitura → HORAS_NEGATIVAS
            g.horas = Math.max(horasN, horasN1);
            let litros = Math.max(0, (horasN - horasN1) * CONSUMO_L_H[g.kva] * between(0.85, 1.1));
            if (mes === ultimoMes && rows.length === 3) litros *= 2.6; // consumo anormal → LITROS_ACIMA_MEDIA
            const pen = (p: number, a: number, b: number) => (chance(p) ? String(kz(int(a, b) * 1000)) : null);
            const f = {
              dias,
              horasN1: horasN1.toFixed(2),
              horasN: horasN.toFixed(2),
              litros: litros.toFixed(2),
              servExtrasCent: pen(0.03, 20, 80),
              penExcessoHorasCent: horasN1 >= 35040 ? String(kz(horasN1 >= 37920 ? 60000 : horasN1 >= 36480 ? 40000 : 25000)) : null,
              penSLACent: pen(0.05, 15, 50),
              penNivelCombustCent: pen(0.03, 10, 30),
              penAvariaCent: pen(0.02, 20, 60),
            };
            const data = buildMeasurementData(ctx, siteInfo.get(g.siteId)!, genInfo.get(g.id)!, f, medias.get(g.siteId) ?? null);
            const state: RecordState = alvo;
            rows.push({ ...data, mapId: map.id, siteId: g.siteId, generatorId: g.id, state, createdById: alvo === "RASCUNHO" || alvo === "SUBMETIDO" ? gt.tecnico.id : brunoSup.id });
            soma = { aluguer: soma.aluguer + data.aluguerCent - data.descontoRedeCent + (data.precoManutencaoCent ?? BigInt(0)), abast: soma.abast + data.abastecimentoCent };
          }
          for (let i = 0; i < rows.length; i += 200) await db.generatorMeasurement.createMany({ data: rows.slice(i, i + 200) });
          if (alvo === "FECHADO") {
            await db.generatorMonthlyMap.update({ where: { id: map.id }, data: { state: "FECHADO", closedById: admin.id, closedAt: new Date(Date.UTC(ano, mes, 10)) } });
          } else {
            await syncMapState(db, map.id);
          }
          const key = `${prov.id}:${mes}`;
          const prev = totaisProvMes.get(key) ?? { aluguer: BigInt(0), abast: BigInt(0) };
          totaisProvMes.set(key, { aluguer: prev.aluguer + soma.aluguer, abast: prev.abast + soma.abast });

          // Indicadores manuais do Mapa Resumo (só nos meses já validados/fechados)
          if (alvo === "FECHADO" || alvo === "VALIDADO") {
            const n = rows.length;
            const naRede = Math.round(n * 0.6);
            await db.monthlyIndicators.create({
              data: {
                mapId: map.id,
                sitesRedePublica: naRede,
                sitesRedeConfiguradosNetEco: Math.round(naRede * between(0.35, 0.5)),
                sitesRedeSemGarantia: Math.round(naRede * between(0.1, 0.2)),
                poupancaCent: kz(int(800, 2500) * 1000),
                transporteExtraCent: chance(0.3) ? kz(int(150, 600) * 1000) : null,
              },
            });
          }
        }
      }
    }

    // ---------- Targets (por provider e global), perto dos valores reais (±10%) ----------
    for (let mes = 1; mes <= 12; mes++) {
      let gAlug = BigInt(0);
      let gAbast = BigInt(0);
      for (const p of providers) {
        const t = totaisProvMes.get(`${p.id}:${Math.min(mes, ultimoMes)}`);
        if (!t) continue;
        const aluguer = (t.aluguer * BigInt(Math.round(between(90, 110)))) / BigInt(100);
        const combustivel = (t.abast * BigInt(Math.round(between(90, 110)))) / BigInt(100);
        gAlug += aluguer;
        gAbast += combustivel;
        await db.target.create({ data: { ano, mes, providerId: p.id, aluguerCent: aluguer, combustivelCent: combustivel } });
      }
      await db.target.create({ data: { ano, mes, providerId: null, aluguerCent: gAlug, combustivelCent: gAbast } });
    }

    // ---------- Facturas de providers ----------
    let nFactura = 0;
    const budgets = await db.providerBudget.findMany({ where: { ano } });
    const poFor = (providerId: string, teamId: string) =>
      budgets.find((b) => b.providerId === providerId && b.teamId === teamId)?.po ?? budgets.find((b) => b.providerId === providerId && b.teamId === null)?.po ?? null;
    const invoices: Prisma.ProviderInvoiceCreateManyInput[] = [];
    for (const [teamObj, criador] of [[tProvLuanda, elsaTec], [tProvSul, anaSup]] as const) {
      for (const p of providers) {
        const orcMensal = teamObj.id === tProvSul.id && p.id === P.Blinder.id ? 1500000 : 2950000;
        for (let mes = 1; mes <= ultimoMes; mes++) {
          const tipos = mes % 3 === 0 ? ["Manutenção", "Material"] : ["Manutenção"];
          for (const tipo of tipos) {
            const valor = tipo === "Material" ? between(200000, 600000) : orcMensal * between(0.7, mes === 5 && p.nome === "Blinder" ? 1.25 : 1.02);
            const valorFT = kz(Math.round(valor * 100) / 100);
            const antigo = mes <= ultimoMes - 3;
            const pago = antigo ? valorFT : mes < ultimoMes && chance(0.5) ? (valorFT * BigInt(int(30, 80))) / BigInt(100) : BigInt(0);
            const state: RecordState = mes < ultimoMes ? "VALIDADO" : chance(0.5) ? "SUBMETIDO" : "RASCUNHO";
            const fact = new Date(Date.UTC(ano, mes, int(3, 12)));
            invoices.push({
              teamId: teamObj.id,
              providerId: p.id,
              ano,
              mes,
              po: poFor(p.id, teamObj.id),
              tipo,
              numeroFactura: `FT ${ano}/${String(++nFactura).padStart(4, "0")}`,
              dataFacturacao: fact > hoje ? hoje : fact,
              dataExecucao: new Date(Date.UTC(ano, mes, 0)),
              qtdOTs: tipo === "Manutenção" ? int(20, 80) : null,
              consumiveis: tipo === "Material" ? int(5, 40) : int(0, 10),
              valorFTCent: valorFT,
              valorPagoCent: pago,
              status: pago === valorFT ? "FECHADO" : pago > BigInt(0) ? "ANDAMENTO" : state === "VALIDADO" ? "PENDENTE" : "ABERTO",
              observacao: pago > BigInt(0) && pago < valorFT ? "Pagamento parcial" : null,
              state,
              createdById: criador.id,
              validatedById: state === "VALIDADO" ? anaSup.id : null,
              validatedAt: state === "VALIDADO" ? new Date(Date.UTC(ano, mes, 20)) : null,
            });
          }
        }
      }
    }
    await db.providerInvoice.createMany({ data: invoices });

    await db.auditLog.create({ data: { userId: admin.id, entity: "Seed", entityId: "demo", action: "seed_demo", diff: { ano, meses: ultimoMes } } });
      return { nGens: gens.length, nInvoices: invoices.length };
    },
    { timeout: 300000, maxWait: 10000 },
  );

  const nMed = await prisma.generatorMeasurement.count();
  console.log(`Seed demo concluído: ${nGens} geradores, ${nMed} medições, ${nInvoices} facturas.`);
  console.log("");
  console.log("Contas (password entre parênteses):");
  console.log(`  Super admin (Gestor): ${ADMIN_EMAIL} (${ADMIN_PASSWORD})`);
  console.log(`  Supervisora Providers: ana.supervisora@demo.ao (${USER_PASSWORD})`);
  console.log(`  Supervisor Geradores:  bruno.supervisor@demo.ao (${USER_PASSWORD})`);
  console.log(`  Técnica Geradores Norte: carla.tecnica@demo.ao (${USER_PASSWORD})`);
  console.log(`  Técnico Geradores Sul:   david.tecnico@demo.ao (${USER_PASSWORD})`);
  console.log(`  Técnica Providers:       elsa.tecnica@demo.ao (${USER_PASSWORD})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
