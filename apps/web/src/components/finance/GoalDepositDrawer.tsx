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
import { MoneyInput } from "../forms.js";

type Direction = "deposit" | "withdraw" | "correct";


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
  // Marcação não move dinheiro: separa ou libera parte do saldo da conta que
  // ela marca. Não tem conta de origem, data nem descrição.
  const earmark = goal.mode === "earmark";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseCurrencyInput(amount);
    if (direction === "correct") {
      if (cents == null || cents < 0) {
        toast.notify("Informe o saldo real", "error");
        return;
      }
      setSaving(true);
      try {
        await api(`/ledger/goals/${goal.id}/correct`, {
          method: "POST",
          body: JSON.stringify({ date, valueCents: cents })
        });
        toast.notify("Saldo corrigido: o rendimento foi refeito a partir dele");
        await onDone();
      } catch (error) {
        toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (cents == null || cents <= 0) {
      toast.notify("Informe um valor válido", "error");
      return;
    }
    if (earmark) {
      setSaving(true);
      try {
        await api(`/ledger/goals/${goal.id}/mark`, {
          method: "POST",
          body: JSON.stringify({ amountCents: direction === "deposit" ? cents : -cents })
        });
        toast.notify(direction === "deposit" ? "Valor separado" : "Valor liberado");
        await onDone();
      } catch (error) {
        toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
      } finally {
        setSaving(false);
      }
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
      <dl className="position-summary">
        <div>
          <dt>Você colocou</dt>
          <dd>{moneyFromCents(goal.contributedCents)}</dd>
        </div>
        {goal.cdiPercent != null && (
          <div>
            <dt>Rendeu</dt>
            <dd className="positive-text">{moneyFromCents(goal.yieldCents)}</dd>
          </div>
        )}
        {goal.correctionCents !== 0 && (
          <div title="Diferença entre o calculado e o saldo real que você informou">
            <dt>Correções</dt>
            <dd>{moneyFromCents(goal.correctionCents)}</dd>
          </div>
        )}
        <div className="position-summary-total">
          <dt>Saldo hoje</dt>
          <dd>{moneyFromCents(goal.balanceCents)}</dd>
        </div>
      </dl>
      <form id="goal-move" className="stack" onSubmit={submit}>
        <Segmented<Direction>
          value={direction}
          onChange={setDirection}
          options={
            earmark
              ? [
                  { value: "deposit", label: "Separar" },
                  { value: "withdraw", label: "Liberar" },
                  { value: "correct", label: "Corrigir saldo" }
                ]
              : [
                  { value: "deposit", label: "Depositar" },
                  { value: "withdraw", label: "Sacar" },
                  { value: "correct", label: "Corrigir saldo" }
                ]
          }
        />

        {direction === "correct" && (
          <p className="fin-muted">
            O saldo que o banco mostrava para esta caixinha no fim de um dia. O sistema passa a
            calcular a partir dele: o rendimento depois desse dia é refeito.
          </p>
        )}

        {earmark && direction !== "correct" && (
          <p className="fin-muted">
            {direction === "deposit"
              ? `Separa parte do saldo de ${goal.accountName ?? "conta"} para esta caixinha. O dinheiro continua na conta.`
              : `Devolve parte do que está separado ao saldo livre de ${goal.accountName ?? "conta"}.`}
          </p>
        )}

        <div className="field-row">
          <Field label={direction === "correct" ? "Saldo real" : "Valor"}>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              autoFocus
              required
              placeholder="0,00"
            />
          </Field>
          {(!earmark || direction === "correct") && (
            <Field label={direction === "correct" ? "No fim do dia" : "Data"}>
              <DateField value={date} onChange={setDate} />
            </Field>
          )}
        </div>

        {!earmark && direction !== "correct" && (
          <Field label={direction === "deposit" ? "Sai da conta" : "Volta para a conta"}>
            <AccountSelect
              value={accountId}
              onChange={setAccountId}
              exclude={["credit_card", "investment", "goal"]}
            />
          </Field>
        )}

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

        {!earmark && direction !== "correct" && (
          <Field label="Descrição" hint="Opcional">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Ex.: sobra do mês"
            />
          </Field>
        )}
      </form>
    </Drawer>
  );
}
