import { useMemo } from "react";
import { installmentDates, splitCents, statementMonthFor } from "@projeto41/finance";
import { Field, Segmented } from "../ui.js";
import { ledgerDate, monthLabel, moneyFromCents } from "../../lib/format.js";

/**
 * Campos de parcelamento, exibidos no drawer quando a conta é cartão.
 *
 * A prévia usa o **mesmo** `splitCents` de `packages/finance` que o servidor —
 * uma divisão escrita à mão aqui divergiria do que é gravado, e o usuário veria
 * um valor na tela e outro no extrato.
 */
export function InstallmentFields({
  mode,
  onModeChange,
  installmentCount,
  onCountChange,
  totalCents,
  purchaseDate,
  closingDay,
  dueDay,
  readOnly = false
}: {
  mode: "single" | "installments";
  onModeChange: (mode: "single" | "installments") => void;
  installmentCount: number;
  onCountChange: (count: number) => void;
  totalCents: number | null;
  purchaseDate: string;
  closingDay: number;
  dueDay: number;
  /** Na edição de um plano, total e número viram texto (6.3). */
  readOnly?: boolean;
}) {
  const preview = useMemo(() => {
    if (mode !== "installments" || totalCents == null || totalCents <= 0) return [];
    const amounts = splitCents(totalCents, installmentCount);
    const dates = installmentDates(purchaseDate, installmentCount);
    return amounts.map((amountCents, index) => ({
      number: index + 1,
      amountCents,
      date: dates[index]!,
      statementMonth: statementMonthFor(dates[index]!, closingDay, dueDay)
    }));
  }, [mode, totalCents, installmentCount, purchaseDate, closingDay, dueDay]);

  if (readOnly) {
    return (
      <div className="fin-readonly-plan">
        <span className="field-label">Parcelamento</span>
        <p>
          {installmentCount}× de {moneyFromCents(Math.round((totalCents ?? 0) / installmentCount))}{" "}
          · total {moneyFromCents(totalCents ?? 0)}
        </p>
        {/* Campo desabilitado sem explicação faz o usuário tentar, não
            conseguir e não entender. */}
        <small className="fin-muted">
          Total e número de parcelas não mudam depois de criados. Para alterar,
          exclua o parcelamento e crie de novo.
        </small>
      </div>
    );
  }

  return (
    <div className="stack">
      <Segmented<"single" | "installments">
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "single", label: "À vista" },
          { value: "installments", label: "Parcelado" }
        ]}
      />

      {mode === "installments" && (
        <>
          <Field label="Número de parcelas">
            <input
              type="number"
              min={2}
              max={120}
              value={installmentCount}
              onChange={(event) => onCountChange(Math.max(1, Number(event.target.value) || 1))}
            />
          </Field>

          {preview.length > 0 && (
            <div className="fin-installment-preview">
              <span className="field-label">Prévia das parcelas</span>
              <ul>
                {preview.map((item) => (
                  <li key={item.number}>
                    <span>
                      {item.number}/{installmentCount} · {ledgerDate(item.date)}
                    </span>
                    <span className="fin-list-meta">
                      <small className="fin-muted">{monthLabel(item.statementMonth)}</small>
                      <strong>{moneyFromCents(item.amountCents)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
              <small className="fin-muted">
                O resto dos centavos vai todo para a primeira parcela.
              </small>
            </div>
          )}
        </>
      )}
    </div>
  );
}
