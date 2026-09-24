import { Save } from "lucide-react";
import { useState } from "react";
import type { GoalProgress } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { DateField } from "../datepicker.js";
import { Drawer } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { AccountSelect } from "./AccountSelect.js";
import { api } from "../../lib/api.js";
import { moneyFromCents, todayIso } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

type Direction = "deposit" | "withdraw";


export function GoalDepositDrawer({
  goal,
  onClose,
  onDone
}: {
  goal: GoalProgress;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const [direction, setDirection] = useState<Direction>("deposit");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  /**
   * Ao sacar, o usuário precisa ver o que recebe de verdade. A estimativa é a
   * do resgate total; num saque parcial ela é o teto do imposto.
   */
  const showTaxes = direction === "withdraw" && (goal.iofCents > 0 || goal.irCents > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseCurrencyInput(amount);
    if (cents == null || cents <= 0) {
      toast.notify("Informe um valor válido", "error");
      return;
    }
    if (accountId == null) {
      toast.notify("Escolha a conta", "error");
      return;
    }
    setSaving(true);
    try {
      const path = direction === "deposit" ? "deposit" : "withdraw";
      await api(`/ledger/goals/${goal.id}/${path}`, {
        method: "POST",
        body: JSON.stringify({
          amountCents: cents,
          date,
          [direction === "deposit" ? "fromAccountId" : "toAccountId"]: accountId,
          description: description || null
        })
      });
      toast.notify(direction === "deposit" ? "Depósito registrado" : "Saque registrado");
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={goal.name}
      subtitle={`Saldo ${moneyFromCents(goal.balanceCents)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="goal-move" disabled={saving}>
            {saving ? "Salvando…" : "Confirmar"}
          </Button>
        </>
      }
    >
      <form id="goal-move" className="stack" onSubmit={submit}>
        <Segmented<Direction>
          value={direction}
          onChange={setDirection}
          options={[
            { value: "deposit", label: "Depositar" },
            { value: "withdraw", label: "Sacar" }
          ]}
        />

        <div className="field-row">
          <Field label="Valor">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              autoFocus
              required
              placeholder="0,00"
            />
          </Field>
          <Field label="Data">
            <DateField value={date} onChange={setDate} />
          </Field>
        </div>

        <Field label={direction === "deposit" ? "Sai da conta" : "Volta para a conta"}>
          <AccountSelect
            value={accountId}
            onChange={setAccountId}
            exclude={["credit_card", "investment", "goal"]}
          />
        </Field>

        {showTaxes && (
          <div className="fin-effect">
            <p>
              Resgatando tudo hoje: IOF {moneyFromCents(goal.iofCents)} · IR{" "}
              {moneyFromCents(goal.irCents)}
            </p>
            <p className="fin-muted">
              Você receberia {moneyFromCents(goal.netCents)} de{" "}
              {moneyFromCents(goal.grossCents)}.
            </p>
          </div>
        )}

        <Field label="Descrição" hint="Opcional">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: sobra do mês"
          />
        </Field>
      </form>
    </Drawer>
  );
}
