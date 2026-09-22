import { Save } from "lucide-react";
import { useState } from "react";
import type { SplitMode, TargetReport } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { Drawer } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { api } from "../../lib/api.js";
import { centsToInput, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

/** Campo monetário opcional: vazio significa "não definido", não zero. */
function optionalCents(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  const cents = parseCurrencyInput(text);
  return cents == null ? "invalid" : cents;
}

export function TargetDrawer({
  report,
  onClose,
  onSaved
}: {
  report: TargetReport;
  onClose: () => void;
  onSaved: (next: TargetReport) => void;
}) {
  const toast = useToast();
  const [splitMode, setSplitMode] = useState<SplitMode>(report.splitMode);
  const [totalTarget, setTotalTarget] = useState(centsToInput(report.totalExpenseTargetCents));
  const [pooledIncome, setPooledIncome] = useState(centsToInput(report.pooledIncomeCents));
  const [jointTarget, setJointTarget] = useState(centsToInput(report.jointExpenseTargetCents));
  const [overrides, setOverrides] = useState(() =>
    Object.fromEntries(
      report.people.map((person) => [
        person.id,
        {
          income: centsToInput(person.incomeOverrideCents),
          target: centsToInput(person.targetOverrideCents)
        }
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const values = {
      totalExpenseTargetCents: optionalCents(totalTarget),
      pooledIncomeCents: optionalCents(pooledIncome),
      jointExpenseTargetCents: optionalCents(jointTarget)
    };
    if (Object.values(values).includes("invalid")) {
      toast.notify("Algum valor está inválido", "error");
      return;
    }

    setSaving(true);
    try {
      let result = await api<{ targets: TargetReport }>(`/ledger/targets/${report.period}`, {
        method: "PUT",
        body: JSON.stringify({ splitMode, ...values })
      });

      // Os overrides vão em chamadas próprias; a última resposta já traz o
      // agregado recalculado, então a tela não precisa reconsultar.
      for (const person of report.people) {
        const draft = overrides[person.id];
        if (!draft) continue;
        const income = optionalCents(draft.income);
        const target = optionalCents(draft.target);
        if (income === "invalid" || target === "invalid") continue;
        if (income === person.incomeOverrideCents && target === person.targetOverrideCents) continue;
        result = await api<{ targets: TargetReport }>(
          `/ledger/targets/${report.period}/people/${person.id}`,
          {
            method: "PUT",
            body: JSON.stringify({ incomeOverrideCents: income, targetOverrideCents: target })
          }
        );
      }

      toast.notify("Alvo do período salvo");
      onSaved(result.targets);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Alvo do período"
      subtitle="Quanto cada um deveria gastar neste mês"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="target-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="target-form" className="stack" onSubmit={submit}>
        <Segmented<SplitMode>
          value={splitMode}
          onChange={setSplitMode}
          options={[
            { value: "none", label: "Sem divisão" },
            { value: "income_proportional", label: "Pela renda" },
            { value: "pooled", label: "Bolo comum" }
          ]}
        />

        {splitMode !== "pooled" && (
          <Field
            label="Teto de gasto do período"
            hint="Vazio usa a soma dos orçamentos de categoria."
          >
            <input
              value={totalTarget}
              onChange={(event) => setTotalTarget(event.target.value)}
              inputMode="decimal"
              placeholder="Soma dos orçamentos"
            />
          </Field>
        )}

        {splitMode === "pooled" && (
          <div className="field-row">
            <Field label="Renda do bolo" hint="Vazio soma a renda de todos.">
              <input
                value={pooledIncome}
                onChange={(event) => setPooledIncome(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </Field>
            <Field label="Teto dos gastos conjuntos">
              <input
                value={jointTarget}
                onChange={(event) => setJointTarget(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
              />
            </Field>
          </div>
        )}

        {splitMode === "income_proportional" && (
          <Field label="Teto dos gastos conjuntos" hint="Reservado antes de repartir o restante.">
            <input
              value={jointTarget}
              onChange={(event) => setJointTarget(event.target.value)}
              inputMode="decimal"
              placeholder="Sem teto conjunto"
            />
          </Field>
        )}

        {splitMode !== "none" && (
          <div className="fin-override-list">
            <span className="field-label">Ajustes por pessoa</span>
            {report.people.map((person) => (
              <div key={person.id} className="fin-override">
                <span className="fin-inline">
                  <span className="fin-dot" style={{ background: person.color }} aria-hidden />
                  {person.name}
                </span>
                <div className="field-row">
                  <Field
                    label="Renda"
                    // Mostrar o apurado ao lado deixa claro o que está sendo
                    // sobrescrito, em vez de o usuário adivinhar.
                    hint={`Apurado: ${moneyFromCents(person.incomeCents)}`}
                  >
                    <input
                      value={overrides[person.id]?.income ?? ""}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [person.id]: {
                            income: event.target.value,
                            target: current[person.id]?.target ?? ""
                          }
                        }))
                      }
                      inputMode="decimal"
                      placeholder="Usar o apurado"
                    />
                  </Field>
                  <Field label="Alvo" hint="Vence o cálculo proporcional.">
                    <input
                      value={overrides[person.id]?.target ?? ""}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [person.id]: {
                            income: current[person.id]?.income ?? "",
                            target: event.target.value
                          }
                        }))
                      }
                      inputMode="decimal"
                      placeholder="Calcular"
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </form>
    </Drawer>
  );
}
