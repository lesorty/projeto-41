import { Save } from "lucide-react";
import { useState } from "react";
import type { GoalMode, GoalProgress } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { ColorPicker } from "../ColorPicker.js";
import { DateField } from "../datepicker.js";
import { Drawer } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { AccountSelect } from "./AccountSelect.js";
import { api } from "../../lib/api.js";
import { centsToInput } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";
import { MoneyInput } from "../forms.js";

export function GoalDrawer({
  goal,
  personId,
  onClose,
  onSaved
}: {
  goal: GoalProgress | null;
  personId: number | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const editing = goal != null;
  const [mode, setMode] = useState<GoalMode>(goal?.mode ?? "account");
  const [name, setName] = useState(goal?.name ?? "");
  const [color, setColor] = useState(goal?.color ?? "#00a86b");
  const [targetAmount, setTargetAmount] = useState(centsToInput(goal?.targetAmountCents));
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [cdiPercent, setCdiPercent] = useState(goal?.cdiPercent != null ? String(goal.cdiPercent) : "");
  const [accountId, setAccountId] = useState<number | null>(
    goal?.mode === "earmark" ? goal.accountId : null
  );
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const target = targetAmount.trim() === "" ? null : parseCurrencyInput(targetAmount);
    if (targetAmount.trim() !== "" && target == null) {
      toast.notify("Valor-alvo inválido", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        color,
        targetAmountCents: target,
        targetDate: targetDate || null,
        cdiPercent: mode === "account" && cdiPercent ? Number(cdiPercent) : null
      };
      if (editing) {
        await api(`/ledger/goals/${goal.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/ledger/goals", {
          method: "POST",
          body: JSON.stringify({ ...body, mode, accountId, personId })
        });
      }
      toast.notify("Caixinha salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={editing ? "Editar caixinha" : "Nova caixinha"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="goal-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="goal-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            placeholder="Ex.: Viagem"
          />
        </Field>

        <div className="field">
          <span className="field-label">Modo</span>
          {editing ? (
            // O modo não muda depois de criado: converter marcação em conta
            // significaria criar dinheiro do nada.
            <p className="fin-muted">
              {goal.mode === "account" ? "Conta própria" : "Marcação sobre uma conta"} · o modo
              não muda depois de criado. Para trocar, crie outra caixinha e transfira o dinheiro.
            </p>
          ) : (
            <Segmented<GoalMode>
              value={mode}
              onChange={setMode}
              options={[
                { value: "account", label: "Conta própria" },
                { value: "earmark", label: "Marcação" }
              ]}
            />
          )}
        </div>

        {!editing && mode === "earmark" && (
          <>
            <Field label="Conta marcada">
              <AccountSelect
                value={accountId}
                onChange={setAccountId}
                exclude={["credit_card", "investment", "goal"]}
              />
            </Field>
            <p className="fin-muted">
              Marcação é uma anotação sobre o saldo de uma conta que já existe. O
              dinheiro não se move e <strong>não rende</strong>.
            </p>
          </>
        )}

        <div className="field-row">
          <Field label="Valor-alvo" hint="Opcional">
            <MoneyInput
              value={targetAmount}
              onChange={setTargetAmount}
              placeholder="Sem alvo"
            />
          </Field>
          <Field label="Data-alvo" hint="Opcional">
            <DateField value={targetDate} onChange={setTargetDate} />
          </Field>
        </div>

        {mode === "account" && (
          <Field
            label="Percentual do CDI"
            hint="Vazio significa que a caixinha não rende."
          >
            <input
              type="number"
              min={1}
              max={300}
              step="1"
              value={cdiPercent}
              onChange={(event) => setCdiPercent(event.target.value)}
              placeholder="Ex.: 110"
            />
          </Field>
        )}

        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}
