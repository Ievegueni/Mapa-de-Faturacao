/**
 * Migração do "Novo Mapa de Facturação.xlsx" para a facturação de Providers.
 *
 *   npm run import:providers -w apps/api -- --ficheiro <caminho.xlsx> --equipa "<nome da equipa>" --ano 2026 [--rascunho] [--substituir]
 *
 * Executar depois de criadas as equipas. As facturas ficam VALIDADAS (dados históricos), salvo --rascunho.
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import "dotenv/config";
import { formatKz, MONTHS_FULL } from "@cf/shared";
import { importProvidersWorkbook } from "../src/modules/billing-providers/import";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg("ficheiro");
  const teamName = arg("equipa");
  const ano = Number(arg("ano"));
  if (!file || !teamName || !ano) {
    console.error('Uso: --ficheiro <x.xlsx> --equipa "<nome>" --ano <aaaa> [--rascunho] [--substituir]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const team = await prisma.team.findFirst({ where: { nome: { equals: teamName, mode: "insensitive" } } });
    if (!team || team.tipo !== "PROVIDERS") throw new Error(`Equipa de Providers "${teamName}" não encontrada`);
    const gestor = await prisma.user.findFirst({ where: { role: "GESTOR", ativo: true }, orderBy: { createdAt: "asc" } });
    if (!gestor) throw new Error("Não existe nenhum Gestor activo (corra o seed)");

    const r = await importProvidersWorkbook(prisma, readFileSync(file), {
      teamId: team.id,
      ano,
      userId: gestor.id,
      state: process.argv.includes("--rascunho") ? "RASCUNHO" : "VALIDADO",
      replace: process.argv.includes("--substituir"),
    });
    await prisma.auditLog.create({
      data: { userId: gestor.id, entity: "ProviderInvoice", entityId: team.id, action: "import", diff: { ficheiro: file, ano, criadas: r.criadas, substituidas: r.substituidas, ignoradas: r.ignoradas } },
    });
    for (const f of r.facturas) console.log(`  ${f.parceiro.padEnd(12)} ${MONTHS_FULL[f.mes - 1].padEnd(10)} ${formatKz(f.valorFTCent)}`);
    for (const a of r.avisos) console.log(`  aviso: ${a}`);
    console.log(`Importação concluída: ${r.criadas} criadas, ${r.substituidas} substituídas, ${r.ignoradas} ignoradas.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
