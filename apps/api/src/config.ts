import "dotenv/config";

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  appUrl: process.env.APP_URL || "http://localhost:5173",
};
