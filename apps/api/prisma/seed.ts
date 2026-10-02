import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Sprint 1: Gestor (SEED_GESTOR_EMAIL / SEED_GESTOR_PASSWORD).
  // Sprint 2: providers, faixas de desconto e preços (CLAUDE.md §15).
  console.log("Seed: nada a criar nesta fase.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
