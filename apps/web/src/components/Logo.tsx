/** Logótipo Unitel + nome da aplicação. `dark` = sobre fundo azul-marinho. */
export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <img src={dark ? "/unitel-logo-branco.png" : "/unitel-logo.png"} alt="Unitel" className="h-9 w-auto self-start" />
      <div className={`text-xs font-semibold uppercase tracking-wider ${dark ? "text-brand-400" : "text-brand-600"}`}>
        Controlo de Facturação
      </div>
    </div>
  );
}
