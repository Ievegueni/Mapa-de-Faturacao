import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@cf/shared";
import { api } from "../lib/api";

interface Health {
  status: "ok" | "error";
  db: "up" | "down";
}

export default function HomePage() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api<Health>("/health") });
  const ok = health.data?.status === "ok";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Plataforma de Controlo de Facturação</h1>
      <p className="mt-1 text-sm text-ink-500">Providers e Controlo de Geradores · {formatDate(new Date())}</p>

      <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-ink-100">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Estado do sistema</div>
        <div className="mt-3 flex items-center gap-3">
          <span
            className={`size-2.5 rounded-full ${
              health.isLoading ? "bg-ink-300" : ok ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          <span className="font-medium text-navy-950">
            {health.isLoading ? "A verificar…" : ok ? "API e base de dados operacionais" : "Serviço indisponível"}
          </span>
        </div>
      </div>
    </div>
  );
}
