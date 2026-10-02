import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";

function secret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`Variável de ambiente em falta: ${name}`);
  return devDefault;
}

export const config = {
  isProduction,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  appUrl: process.env.APP_URL || "http://localhost:5173",
  jwtSecret: secret("JWT_SECRET", "dev-access-secret"),
  jwtRefreshSecret: secret("JWT_REFRESH_SECRET", "dev-refresh-secret"),
  accessTokenTtl: "15m",
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,
  bcryptRounds: 12,
};
