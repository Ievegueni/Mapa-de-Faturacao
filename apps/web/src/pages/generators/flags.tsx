import { GENERATOR_FLAG_LABELS, GeneratorFlag } from "@cf/shared";

/** Abreviaturas para as tabelas (o nome completo fica no title). */
const SHORT: Record<GeneratorFlag, string> = {
  HORAS_NEGATIVAS: "H<0",
  DIAS_INVALIDOS: "Dias",
  HORAS_FORA_INTERVALO: "Faixa",
  SEM_PRECO_ALUGUER: "P. aluguer",
  SEM_PRECO_COMBUSTIVEL: "P. comb.",
  SEM_PRECO_SERV_ABAST: "P. serviço",
  LITROS_ACIMA_MEDIA: "Litros",
  GERADOR_REMOVIDO: "Removido",
};

const PRICE = ["SEM_PRECO_ALUGUER", "SEM_PRECO_COMBUSTIVEL", "SEM_PRECO_SERV_ABAST"];

export function FlagChips({ flags, full = false }: { flags: string[]; full?: boolean }) {
  if (!flags.length) return <span className="text-ink-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span
          key={f}
          title={GENERATOR_FLAG_LABELS[f as GeneratorFlag] || f}
          className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${
            PRICE.includes(f) ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-red-50 text-red-700 ring-1 ring-red-200"
          }`}
        >
          {full ? GENERATOR_FLAG_LABELS[f as GeneratorFlag] || f : SHORT[f as GeneratorFlag] || f}
        </span>
      ))}
    </div>
  );
}
