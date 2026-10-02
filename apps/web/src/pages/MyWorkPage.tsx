import { BILLING_TYPE_LABELS } from "@cf/shared";
import { useAuth } from "../hooks/useAuth";
import { Alert, Badge, Card, PageHeader } from "../components/ui";

/** Página inicial do Técnico: rascunhos e pendentes (os registos chegam nos sprints 3 e 5). */
export default function MyWorkPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <PageHeader title="O meu trabalho" subtitle={`Olá, ${user.nome}. Aqui ficam os seus rascunhos e pendentes.`} />
      {user.teams.length === 0 ? (
        <Alert kind="info">Ainda não pertence a nenhuma equipa. Peça ao Gestor para o associar.</Alert>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {user.teams.map((t) => (
            <Card key={t.id} className="p-5">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-navy-950">{t.nome}</div>
                <Badge tone="brand">{BILLING_TYPE_LABELS[t.tipo]}</Badge>
              </div>
              <p className="mt-3 text-sm text-ink-500">Sem rascunhos pendentes.</p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
