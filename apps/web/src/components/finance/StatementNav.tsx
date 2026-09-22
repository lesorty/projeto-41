import { ChevronLeft, ChevronRight } from "lucide-react";
import type { StatementStatus, StatementSummary } from "@projeto41/contracts";
import { IconButton, Tag } from "../ui.js";
import { ledgerDate, monthLabel } from "../../lib/format.js";

const STATUS_LABEL: Record<StatementStatus, string> = {
  open: "Aberta",
  closed: "Fechada",
  paid: "Paga",
  overdue: "Vencida"
};

/** Tons já existentes no app; nenhum token novo. */
const STATUS_TONE: Record<StatementStatus, string> = {
  open: "info",
  closed: "warning",
  paid: "positive",
  overdue: "negative"
};

/**
 * Navegação entre faturas.
 *
 * A navegação para frente **não para na fatura corrente**: vai até a última que
 * contém parcela, porque é justamente esse dinheiro já comprometido que se
 * precisa enxergar.
 */
export function StatementNav({
  statements,
  current,
  onChange
}: {
  statements: StatementSummary[];
  current: string;
  onChange: (month: string) => void;
}) {
  const index = statements.findIndex((statement) => statement.month === current);
  const active = statements[index];

  return (
    <div className="fin-statement-nav">
      <IconButton
        icon={ChevronLeft}
        label="Fatura anterior"
        disabled={index <= 0}
        onClick={() => onChange(statements[index - 1]!.month)}
      />

      <div className="fin-statement-label">
        <select value={current} onChange={(event) => onChange(event.target.value)}>
          {statements.map((statement) => (
            <option key={statement.month} value={statement.month}>
              {monthLabel(statement.month)}
              {statement.isFuture ? " · futura" : ""}
            </option>
          ))}
        </select>
        {active && (
          <small className="fin-muted">
            fecha em {ledgerDate(active.closingDate)} · vence em {ledgerDate(active.dueDate)}
          </small>
        )}
      </div>

      {active && <Tag tone={STATUS_TONE[active.status]}>{STATUS_LABEL[active.status]}</Tag>}
      {active?.isFuture && <Tag tone="info">Futura</Tag>}

      <IconButton
        icon={ChevronRight}
        label="Próxima fatura"
        disabled={index < 0 || index >= statements.length - 1}
        onClick={() => onChange(statements[index + 1]!.month)}
      />
    </div>
  );
}
