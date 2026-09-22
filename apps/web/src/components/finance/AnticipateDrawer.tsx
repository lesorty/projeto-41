import { FastForward } from "lucide-react";
import { useMemo, useState } from "react";
import type { EntryRecord, StatementSummary } from "@projeto41/contracts";
import { Drawer, useConfirm } from "../dialog.js";
import { Button, Field } from "../ui.js";
import { api } from "../../lib/api.js";
import { ledgerDate, monthLabel, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

/**
 * Antecipação de parcelas.
 *
 * Nada aqui é irreversível: confirmação antes e "Desfazer" no toast depois. A
 * antecipação só move o `statement_month`; a data da compra fica intacta, e é
 * por isso que dá para voltar sempre.
 */
export function AnticipateDrawer({
  cardId,
  installments,
  statements,
  onClose,
  onDone
}: {
  cardId: number;
  installments: EntryRecord[];
  statements: StatementSummary[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<number[]>([]);
  const [targetMonth, setTargetMonth] = useState(statements[0]?.month ?? "");
  const [saving, setSaving] = useState(false);

  const movingCents = useMemo(
    () =>
      installments
        .filter((entry) => selected.includes(entry.id))
        .reduce((total, entry) => total + -entry.amountCents, 0),
    [installments, selected]
  );

  const target = statements.find((statement) => statement.month === targetMonth);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (selected.length === 0) {
      toast.notify("Escolha ao menos uma parcela", "error");
      return;
    }
    const ok = await confirm({
      title: "Antecipar parcelas",
      message: `${selected.length} parcela(s) passam para a fatura de ${monthLabel(targetMonth)}. A data da compra não muda.`,
      confirmLabel: "Antecipar"
    });
    if (!ok) return;

    setSaving(true);
    try {
      await api(`/ledger/cards/${cardId}/anticipate`, {
        method: "POST",
        body: JSON.stringify({ entryIds: selected, targetMonth })
      });
      // O `Toast` do app não tem ação embutida, então o "desfazer" vive na
      // própria linha: parcela antecipada ganha a etiqueta e o botão de
      // restaurar na tela de fatura. A operação nunca fica sem volta.
      toast.notify("Parcelas antecipadas · use Restaurar na linha para desfazer");
      await onDone();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao antecipar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title="Antecipar parcelas"
      subtitle="Move a parcela de fatura, sem mexer na data da compra"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={FastForward} type="submit" form="anticipate-form" disabled={saving}>
            {saving ? "Antecipando…" : "Antecipar"}
          </Button>
        </>
      }
    >
      <form id="anticipate-form" className="stack" onSubmit={submit}>
        <div>
          <span className="field-label">Parcelas futuras</span>
          <ul className="fin-list">
            {installments.map((entry) => (
              <li key={entry.id}>
                <label className="fin-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, entry.id]
                          : current.filter((id) => id !== entry.id)
                      )
                    }
                  />
                  <span>
                    {entry.installmentNumber}/{entry.installmentCount} · {ledgerDate(entry.date)}
                  </span>
                </label>
                <span className="fin-list-meta">
                  <small className="fin-muted">{monthLabel(entry.statementMonth ?? "")}</small>
                  <strong>{moneyFromCents(-entry.amountCents)}</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Field label="Fatura de destino">
          <select value={targetMonth} onChange={(event) => setTargetMonth(event.target.value)}>
            {statements.map((statement) => (
              <option key={statement.month} value={statement.month}>
                {monthLabel(statement.month)}
              </option>
            ))}
          </select>
        </Field>

        {/* O efeito em duas linhas: o que muda e o que não muda. */}
        <div className="fin-effect">
          <p>
            Fatura de destino passa de {moneyFromCents(target?.totalCents ?? 0)} para{" "}
            {moneyFromCents((target?.totalCents ?? 0) + movingCents)}
          </p>
          <p className="fin-muted">O total devido não muda.</p>
        </div>
      </form>
    </Drawer>
  );
}
