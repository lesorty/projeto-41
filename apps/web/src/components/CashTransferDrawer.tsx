import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useState } from "react";
import type { AccountRecord } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { DateField } from "./datepicker.js";
import { Drawer } from "./dialog.js";
import { Button, Field } from "./ui.js";
import { moneyFromCents, todayIso } from "../lib/format.js";
import { ledgerApi } from "../lib/ledger.js";
import { useToast } from "../lib/toast.js";

/**
 * Aporte e resgate do caixa da corretora.
 *
 * Os dois são transferências comuns do livro, com `purpose='investment'`: o
 * dinheiro muda de conta, mas não é gasto nem receita, e não conta no alvo de
 * gastos (6.4).
 */
export function CashTransferDrawer({
  direction,
  broker,
  banks,
  onClose,
  onDone
}: {
  direction: "deposit" | "withdraw";
  broker: AccountRecord;
  banks: AccountRecord[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const depositing = direction === "deposit";
  const [bankId, setBankId] = useState<number | null>(banks[0]?.id ?? null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const bank = banks.find((account) => account.id === bankId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseCurrencyInput(amount);
    if (cents == null || cents <= 0) {
      toast.notify("Informe um valor", "error");
      return;
    }
    if (bankId == null) {
      toast.notify("Escolha a conta", "error");
      return;
    }
    setSaving(true);
    try {
      await ledgerApi.createTransfer({
        fromAccountId: depositing ? bankId : broker.id,
        toAccountId: depositing ? broker.id : bankId,
        amountCents: cents,
        date,
        purpose: "investment",
        description: depositing ? `Aporte · ${broker.name}` : `Resgate · ${broker.name}`
      });
      toast.notify(depositing ? "Aporte registrado: o valor está em caixa" : "Resgate registrado");
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={depositing ? "Aportar no caixa" : "Resgatar do caixa"}
      subtitle={broker.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon={depositing ? ArrowDownToLine : ArrowUpFromLine}
            type="submit"
            form="cash-transfer-form"
            disabled={saving}
          >
            {saving ? "Salvando…" : depositing ? "Aportar" : "Resgatar"}
          </Button>
        </>
      }
    >
      <form id="cash-transfer-form" className="stack" onSubmit={submit}>
        <Field
          label={depositing ? "Sai de" : "Vai para"}
          hint={bank ? `Saldo hoje: ${moneyFromCents(bank.currentBalanceCents)}` : undefined}
        >
          <select value={bankId ?? ""} onChange={(event) => setBankId(Number(event.target.value))}>
            {banks.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.personName ? ` · ${account.personName}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-row">
          <Field label="Valor">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              autoFocus
              required
            />
          </Field>
          <Field label="Data">
            <DateField value={date} onChange={setDate} />
          </Field>
        </div>
        <p className="fin-muted">
          {depositing
            ? `O dinheiro fica em caixa na ${broker.name} até você alocar numa compra.`
            : `Caixa disponível: ${moneyFromCents(broker.currentBalanceCents)}.`}
        </p>
      </form>
    </Drawer>
  );
}
