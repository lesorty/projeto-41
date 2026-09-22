import { DateField } from "../datepicker.js";
import { Field, Segmented } from "../ui.js";
import { monthNames } from "../../lib/format.js";

/** Período selecionado, já resolvido em datas concretas. */
export type SelectedPeriod = {
  mode: "current" | "previous" | "year" | "custom";
  from: string;
  to: string;
  /** `YYYY-MM` quando o período é um mês-calendário; as rotas de alvo pedem isso. */
  period: string | null;
  year: number | null;
};

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;

export function monthPeriod(offset = 0, today = new Date()): SelectedPeriod {
  const year = today.getFullYear();
  const month = today.getMonth() + offset;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return {
    mode: offset === 0 ? "current" : "previous",
    from: iso(start),
    to: iso(end),
    period: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    year: null
  };
}

export function yearPeriod(today = new Date()): SelectedPeriod {
  const year = today.getFullYear();
  return { mode: "year", from: `${year}-01-01`, to: `${year}-12-31`, period: null, year };
}

/** Rótulo curto do período, usado nos títulos das telas. */
export function periodLabel(period: SelectedPeriod): string {
  if (period.mode === "year") return String(period.year);
  if (period.period) {
    const [year, month] = period.period.split("-");
    return `${monthNames[Number(month) - 1] ?? ""} de ${year}`;
  }
  return `${period.from} a ${period.to}`;
}

export function PeriodPicker({
  value,
  onChange
}: {
  value: SelectedPeriod;
  onChange: (next: SelectedPeriod) => void;
}) {
  return (
    <div className="fin-period-picker">
      <Segmented<SelectedPeriod["mode"]>
        value={value.mode}
        onChange={(mode) => {
          if (mode === "current") onChange(monthPeriod(0));
          else if (mode === "previous") onChange(monthPeriod(-1));
          else if (mode === "year") onChange(yearPeriod());
          // "custom" mantém o intervalo atual e só libera os dois campos de data.
          else onChange({ ...value, mode: "custom", period: null, year: null });
        }}
        options={[
          { value: "current", label: "Este mês" },
          { value: "previous", label: "Mês passado" },
          { value: "year", label: "Ano" },
          { value: "custom", label: "Personalizado" }
        ]}
      />

      {value.mode === "custom" && (
        <div className="field-row">
          <Field label="De">
            <DateField value={value.from} onChange={(from) => onChange({ ...value, from })} />
          </Field>
          <Field label="Até">
            <DateField value={value.to} onChange={(to) => onChange({ ...value, to })} />
          </Field>
        </div>
      )}
    </div>
  );
}
