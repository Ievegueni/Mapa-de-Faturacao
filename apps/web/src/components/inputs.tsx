import { useEffect, useState } from "react";
import { centsToInput, parseKzInput, parsePercentInput } from "@cf/shared";

const base =
  "block w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 disabled:bg-ink-50 disabled:text-ink-600";

interface ParsedInputProps {
  value: string | null;
  onChange(value: string | null): void;
  parse(text: string): string | null | undefined;
  format(value: string | null): string;
  disabled?: boolean;
  compact?: boolean;
  suffix?: string;
  className?: string;
  "aria-label"?: string;
}

/** Campo com texto livre convertido no blur. Vazio = null (mostra "—"). Inválido fica a vermelho. */
function ParsedInput({ value, onChange, parse, format, disabled, compact, suffix, className = "", ...rest }: ParsedInputProps) {
  const [text, setText] = useState(format(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(format(value));
    setInvalid(false);
  }, [value, format]);

  function commit() {
    const parsed = parse(text);
    if (parsed === undefined) return setInvalid(true);
    setInvalid(false);
    setText(format(parsed));
    if (parsed !== value) onChange(parsed);
  }

  return (
    <div className={`relative ${className}`}>
      <input
        {...rest}
        inputMode="decimal"
        disabled={disabled}
        value={text}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        title={invalid ? "Valor inválido" : undefined}
        className={`${base} text-right tabular-nums ${compact ? "px-2 py-1 text-xs" : ""} ${suffix ? "pr-9" : ""} ${
          invalid ? "border-red-400 focus:ring-red-100" : "border-ink-200 focus:border-brand-400 focus:ring-brand-100"
        }`}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink-400">{suffix}</span>}
    </div>
  );
}

const formatMoney = (v: string | null) => centsToInput(v);
const formatPct = (v: string | null) => (v === null ? "" : v.replace(".", ","));

/** Valor em Kz; `value`/`onChange` em cêntimos (string). */
export function MoneyInput(props: Omit<ParsedInputProps, "parse" | "format">) {
  return <ParsedInput suffix={props.compact ? undefined : "Kz"} {...props} parse={parseKzInput} format={formatMoney} />;
}

export function PercentInput(props: Omit<ParsedInputProps, "parse" | "format">) {
  return <ParsedInput suffix="%" {...props} parse={parsePercentInput} format={formatPct} />;
}
