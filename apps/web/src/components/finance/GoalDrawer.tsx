import { Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { GoalMode, GoalProgress } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { ColorPicker } from "../ColorPicker.js";
import { DateField } from "../datepicker.js";
import { Drawer, useConfirm } from "../dialog.js";
import { Button, Field } from "../ui.js";
import { AccountSelect } from "./AccountSelect.js";
import { api } from "../../lib/api.js";
import { centsToInput } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";
import { MoneyInput } from "../forms.js";

/**
 * Os dois tipos lado a lado. A diferença decide onde o dinheiro está e como ele
 * rende, então cada cartão diz o que é, o que acontece e quando usar.
 */
const GOAL_MODES: {
  value: GoalMode;
  label: string;
  what: string;
  facts: string[];
  when: string;
}[] = [
  {
    value: "account",
    label: "Conta própria",
    what: "Uma conta separada só para o objetivo, como a caixinha do banco ou um CDB.",
    facts: [
      "O dinheiro sai de uma conta ao depositar e volta ao resgatar",
      "Pode render pelo CDI, com IR e IOF calculados",
      "Aparece como conta, com saldo próprio"
    ],
    when: "Use quando o dinheiro fica de fato guardado em outro lugar."
  },
  {
    value: "earmark",
    label: "Marcação",
    what: "Uma etiqueta sobre parte do saldo de uma conta que já existe.",
    facts: [
      "Nada se move: o dinheiro continua na conta",
      "Pode render pelo CDI que a conta paga",
      "Separa, por exemplo, R$ 1.500 da Nubank para a viagem"
    ],
    when: "Use quando o dinheiro fica na conta corrente e você só quer separá-lo."
  }
];

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
  const confirm = useConfirm();
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
        cdiPercent: cdiPercent ? Number(cdiPercent) : null
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

  /**
   * Excluir de vez. Caixinha com conta própria leva a conta e os lançamentos
   * dela; o depósito que veio de outra conta fica lá como ajuste.
   */
  async function remove() {
    if (!goal) return;
    const ok = await confirm({
      title: "Excluir caixinha de vez",
      message:
        goal.mode === "account"
          ? `"${goal.name}" será apagada com a conta e os lançamentos dela. Depósitos feitos de outras contas ficam lá como ajuste, sem mudar o saldo delas. Não dá para desfazer.`
          : `"${goal.name}" será apagada. A marcação some, e o dinheiro continua na conta. Não dá para desfazer.`,
      confirmLabel: "Excluir de vez",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await api(`/ledger/goals/${goal.id}?purge=1`, { method: "DELETE" });
      toast.notify("Caixinha excluída");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao excluir", "error");
    }
  }

  return (
    <Drawer
      title={editing ? "Editar caixinha" : "Nova caixinha"}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <Button variant="danger" icon={Trash2} onClick={() => void remove()}>
              Excluir
            </Button>
          )}
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
          <span className="field-label">Tipo</span>
          {editing && (
            // O modo não muda depois de criado: converter marcação em conta
            // significaria criar dinheiro do nada.
            <p className="fin-muted">
              O tipo não muda depois de criado. Para trocar, crie outra caixinha e transfira o
              dinheiro.
            </p>
          )}
          <div className="goal-mode-options" role="radiogroup" aria-label="Tipo da caixinha">
            {GOAL_MODES.filter((option) => !editing || option.value === goal.mode).map(
              (option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  className={`goal-mode-option ${mode === option.value ? "active" : ""}`}
                  disabled={editing}
                  onClick={() => setMode(option.value)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.what}</span>
                  <ul>
                    {option.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                  <em>{option.when}</em>
                </button>
              )
            )}
          </div>
        </div>

        {!editing && mode === "earmark" && (
          <Field label="Conta marcada" hint="A conta onde o dinheiro já está.">
            <AccountSelect
              value={accountId}
              onChange={setAccountId}
              exclude={["credit_card", "investment", "goal"]}
            />
          </Field>
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

        <Field
          label="Percentual do CDI"
          hint={
            mode === "earmark"
              ? "Quanto a conta paga sobre o valor separado. Vazio: não rende."
              : "Vazio significa que a caixinha não rende."
          }
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

        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}
