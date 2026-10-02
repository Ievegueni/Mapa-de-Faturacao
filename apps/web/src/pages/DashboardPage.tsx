import { BILLING_TYPE_LABELS, ROLE_LABELS } from "@cf/shared";
import { useAuth } from "../hooks/useAuth";
import { Badge, Card, PageHeader } from "../components/ui";

/** Dashboard (Sprint 7). Por agora mostra o âmbito do utilizador. */
export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const global = user.role === "GESTOR";

  return (
    <>
      <PageHeader title="Dashboard" subtitle={global ? "Visão global" : "Visão das suas equipas"} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Perfil</div>
          <div className="mt-2 text-lg font-semibold text-navy-950">{ROLE_LABELS[user.role]}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Tipos de facturação</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {user.billingTypes.length ? user.billingTypes.map((t) => <Badge key={t} tone="brand">{BILLING_TYPE_LABELS[t]}</Badge>) : <span className="text-sm text-ink-400">—</span>}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-400">Equipas</div>
          <div className="mt-2 text-sm text-ink-700">
            {global ? "Todas" : user.teams.length ? user.teams.map((t) => t.nome).join(", ") : "Sem equipa atribuída"}
          </div>
        </Card>
      </div>
      <Card className="mt-6 p-6 text-sm text-ink-500">Os indicadores e gráficos de Providers e Geradores ficam disponíveis no Sprint 7.</Card>
    </>
  );
}
