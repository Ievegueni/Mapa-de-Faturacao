import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { seedConfig } from "./seed-config";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_GESTOR_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_GESTOR_PASSWORD;
  if (!email || !password) throw new Error("Defina SEED_GESTOR_EMAIL e SEED_GESTOR_PASSWORD no .env");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed: Gestor ${email} já existe (não alterado).`);
  } else {
    await prisma.user.create({
      data: {
        nome: "Gestor",
        email,
        role: "GESTOR",
        passwordHash: await bcrypt.hash(password, 12),
        mustChangePassword: true,
      },
    });
    console.log(`Seed: Gestor ${email} criado (troca de password obrigatória no primeiro acesso).`);
  }
  await seedConfig(prisma);
  // Equipas e targets: nenhum (são criados na ferramenta).
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
