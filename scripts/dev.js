// Arranca shared (tsc -w), API (ts-node-dev) e web (Vite) em paralelo. Sem dependências extra.
const { spawn, spawnSync } = require("child_process");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const first = spawnSync(npm, ["run", "build", "-w", "packages/shared"], { stdio: "inherit" });
if (first.status !== 0) process.exit(first.status || 1);

const tasks = [
  ["shared", ["run", "dev", "-w", "packages/shared"]],
  ["api", ["run", "dev", "-w", "apps/api"]],
  ["web", ["run", "dev", "-w", "apps/web"]],
];

const children = tasks.map(([name, args]) => {
  const child = spawn(npm, args, { stdio: "inherit" });
  child.on("exit", (code) => {
    if (code) {
      console.error(`[${name}] terminou com código ${code}`);
      shutdown(code);
    }
  });
  return child;
});

function shutdown(code) {
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
