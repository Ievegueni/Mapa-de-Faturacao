import { execSync } from "child_process";
import "dotenv/config";

/** Recria a BD de teste (TEST_DATABASE_URL) antes dos testes de integração. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("TEST_DATABASE_URL não definido: testes de integração ignorados.");
    return;
  }
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
