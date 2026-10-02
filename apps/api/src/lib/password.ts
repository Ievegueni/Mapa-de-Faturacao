import bcrypt from "bcryptjs";
import { config } from "../config";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.bcryptRounds);
}

// Hash usado quando o email não existe, para o tempo de resposta ser semelhante.
let dummyHash: Promise<string> | null = null;

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    dummyHash = dummyHash || hashPassword("dummy-password");
    await bcrypt.compare(password, await dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
