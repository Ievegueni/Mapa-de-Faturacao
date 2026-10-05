import { PrismaClient } from "@prisma/client";

/** Providers, orçamentos, faixas de desconto e preços iniciais (CLAUDE.md §15). Idempotente. */
export async function seedConfig(prisma: PrismaClient) {
  const ano = Number(process.env.SEED_ANO) || new Date().getFullYear();
  const inicio = new Date(`${ano}-01-01T00:00:00Z`);
  const orcamentoMensalCent = BigInt(295000000); // 2.950.000,00

  const providers: { nome: string; po: string | null }[] = [
    { nome: "Anglobal", po: "4500614726" },
    { nome: "Blinder", po: "4500614723" },
    { nome: "Comatel", po: null },
  ];

  for (const p of providers) {
    const provider = await prisma.provider.upsert({
      where: { nome: p.nome },
      create: { nome: p.nome, tipos: ["PROVIDERS", "GERADORES"] },
      update: {},
    });
    // Orçamento por omissão (todas as equipas) para o ano.
    const budget = await prisma.providerBudget.findFirst({ where: { providerId: provider.id, teamId: null, ano } });
    if (!budget) {
      await prisma.providerBudget.create({ data: { providerId: provider.id, teamId: null, ano, po: p.po, orcamentoMensalCent } });
    }
  }

  if ((await prisma.gridDiscountRule.count()) === 0) {
    await prisma.gridDiscountRule.createMany({
      data: [
        { horasMin: 0, horasMax: 5, percent: "0", validFrom: inicio },
        { horasMin: 6, horasMax: 11, percent: "35", validFrom: inicio },
        { horasMin: 12, horasMax: 17, percent: "45", validFrom: inicio },
        { horasMin: 18, horasMax: 24, percent: "55", validFrom: inicio },
      ],
    });
  }

  // Anglobal: combustível 420,00, serviço de abastecimento 48,00, IVA 14%. Aluguer e manutenção em branco.
  const anglobal = await prisma.provider.findUniqueOrThrow({ where: { nome: "Anglobal" } });
  if ((await prisma.priceTable.count({ where: { providerId: anglobal.id } })) === 0) {
    await prisma.priceTable.create({
      data: {
        providerId: anglobal.id,
        validFrom: inicio,
        precoCombustivelCent: BigInt(42000),
        precoServAbastCent: BigInt(4800),
        precoManutencaoCent: null,
        ivaPercent: "14",
      },
    });
  }
  console.log(`Seed: providers, orçamentos (${ano}), faixas de desconto e preços Anglobal verificados.`);
}
