export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange(v: T): void; items: { value: T; label: string }[] }) {
  return (
    <div className="mb-6 inline-flex rounded-xl bg-ink-100 p-1">
      {items.map((i) => (
        <button
          key={i.value}
          type="button"
          onClick={() => onChange(i.value)}
          className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
            value === i.value ? "bg-white text-navy-950 shadow-sm" : "text-ink-500 hover:text-ink-800"
          }`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
