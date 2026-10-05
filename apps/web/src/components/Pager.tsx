import { Button } from "./ui";

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage(p: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-sm text-ink-500">
      <span>{total.toLocaleString("pt-PT")} registos{pages > 1 ? ` · página ${page} de ${pages}` : ""}</span>
      {pages > 1 && (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</Button>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Seguinte</Button>
        </div>
      )}
    </div>
  );
}
