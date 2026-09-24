import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCheck,
  Paperclip,
  PiggyBank,
  Receipt,
  Undo2
} from "lucide-react";
import { useMemo, useState } from "react";
import type { EntryRecord } from "@projeto41/contracts";
import { Modal } from "../dialog.js";
import { Empty } from "../ui.js";
import { ColorDot } from "../ColorPicker.js";
import { InstallmentBadge } from "./InstallmentBadge.js";
import { moneyFromCents, signedMoneyFromCents, todayIso } from "../../lib/format.js";
import { attachmentThumbUrl, attachmentUrl } from "../../lib/ledger.js";

/**
 * O livro, agrupado por dia.
 *
 * Transacoes, Gastos, Entradas e o extrato da caixinha usam exatamente este
 * componente: a diferenca entre as telas e so o filtro, entao o design e
 * identico por construcao, e nao por disciplina.
 *
 * Cada dia mostra o saldo do que entrou e saiu nele. Transferencia fica fora
 * dessa conta: mover dinheiro entre contas proprias nao e ganhar nem gastar.
 */

type DayGroup = { date: string; rows: EntryRecord[]; netCents: number };

/**
 * Transferência tem duas pontas, e sem filtro de conta as duas aparecem: a
 * mesma movimentação em duas linhas, uma positiva e outra negativa. Fica só a
 * de saída, que já diz "de onde → para onde". Com filtro de conta sobra uma
 * ponta só, e ela continua aparecendo com o sinal daquela conta.
 */
function withoutMirroredLegs(rows: EntryRecord[]): EntryRecord[] {
  const outgoing = new Set(
    rows
      .filter((entry) => entry.transferId != null && entry.amountCents < 0)
      .map((entry) => entry.transferId)
  );
  return rows.filter(
    (entry) => !(entry.transferId != null && entry.amountCents > 0 && outgoing.has(entry.transferId))
  );
}

function groupByDay(rows: EntryRecord[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of withoutMirroredLegs(rows)) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== entry.date) {
      group = { date: entry.date, rows: [], netCents: 0 };
      groups.push(group);
    }
    group.rows.push(entry);
    if (entry.kind === "income" || entry.kind === "expense") group.netCents += entry.amountCents;
  }
  return groups;
}

function dayLabel(date: string, today = todayIso()) {
  const value = new Date(`${date}T12:00:00`);
  const yesterday = new Date(`${today}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const sameYear = value.getFullYear() === new Date(`${today}T12:00:00`).getFullYear();
  const long = value.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" })
  });
  const label = long.charAt(0).toUpperCase() + long.slice(1);
  if (date === today) return `Hoje · ${long}`;
  if (date === todayIso(yesterday)) return `Ontem · ${long}`;
  return label;
}

/**
 * O ícone diz o tipo de movimento antes de qualquer texto. Gasto com categoria
 * leva a inicial dela na cor dela: uma seta verde num gasto parecia entrada.
 */
function EntryIcon({ entry }: { entry: EntryRecord }) {
  if (entry.kind === "expense" && entry.refundOfEntryId == null && entry.categoryName) {
    return (
      <span
        className="fin-entry-icon letter"
        style={{ "--entry-color": entry.categoryColor ?? undefined } as React.CSSProperties}
        aria-hidden
      >
        {entry.categoryName.charAt(0).toUpperCase()}
      </span>
    );
  }
  const Icon =
    entry.refundOfEntryId != null
      ? Undo2
      : entry.goalId != null
        ? PiggyBank
        : entry.kind === "transfer"
          ? ArrowLeftRight
          : entry.amountCents < 0
            ? ArrowDownRight
            : ArrowUpRight;
  return (
    <span className={`fin-entry-icon ${entry.kind}`} aria-hidden>
      <Icon size={16} />
    </span>
  );
}

export function EntryTable({
  rows,
  onSelect,
  emptyText = "Nenhum lançamento no período."
}: {
  rows: EntryRecord[];
  onSelect: (entry: EntryRecord) => void;
  emptyText?: string;
}) {
  const [photo, setPhoto] = useState<{ id: number; label: string } | null>(null);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  // Transferências cujas duas pontas estão na lista: viram uma linha só.
  const mergedTransfers = useMemo(() => {
    const seen = new Map<number, number>();
    for (const entry of rows) {
      if (entry.transferId != null) seen.set(entry.transferId, (seen.get(entry.transferId) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([id]) => id));
  }, [rows]);

  if (rows.length === 0) return <Empty icon={Receipt} text={emptyText} />;

  return (
    <>
      <div className="fin-feed">
        {groups.map((group) => (
          <section className="fin-day" key={group.date}>
            <header className="fin-day-head">
              <strong>{dayLabel(group.date)}</strong>
              {group.netCents !== 0 && (
                <span
                  className={group.netCents < 0 ? "fin-negative" : "fin-positive"}
                  title="Entradas menos saídas do dia, sem transferências"
                >
                  {signedMoneyFromCents(group.netCents)}
                </span>
              )}
            </header>
            <ul>
              {group.rows.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  merged={entry.transferId != null && mergedTransfers.has(entry.transferId)}
                  onSelect={onSelect}
                  onPhoto={(id, label) => setPhoto({ id, label })}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {photo && (
        <Modal title={photo.label} onClose={() => setPhoto(null)}>
          <img className="fin-photo-full" src={attachmentUrl(photo.id)} alt={photo.label} />
        </Modal>
      )}
    </>
  );
}

function EntryRow({
  entry,
  merged,
  onSelect,
  onPhoto
}: {
  entry: EntryRecord;
  /** As duas pontas da transferência estão na lista: o valor sai sem sinal. */
  merged: boolean;
  onSelect: (entry: EntryRecord) => void;
  onPhoto: (id: number, label: string) => void;
}) {
  const isTransfer = entry.kind === "transfer";
  const attachment = entry.attachments[0];
  const title =
    entry.description ?? entry.placeName ?? entry.categoryName ?? (isTransfer ? "Transferência" : "Sem descrição");

  // A linha de detalhe responde "de onde, para onde e de quem" sem abrir nada.
  const meta: React.ReactNode[] = [];
  if (entry.categoryName) {
    meta.push(
      <span key="category" className="fin-inline">
        <ColorDot color={entry.categoryColor ?? "#8b949e"} size={8} />
        {entry.categoryName}
      </span>
    );
  }
  if (entry.placeName && entry.description) meta.push(<span key="place">{entry.placeName}</span>);
  if (isTransfer && entry.counterpartAccountName) {
    meta.push(
      <span key="account">
        {entry.amountCents < 0
          ? `${entry.accountName} → ${entry.counterpartAccountName}`
          : `${entry.counterpartAccountName} → ${entry.accountName}`}
      </span>
    );
  } else {
    meta.push(<span key="account">{entry.accountName}</span>);
  }
  if (entry.personName) meta.push(<span key="person">{entry.personName}</span>);

  return (
    <li className={`fin-entry ${entry.status === "pending" ? "pending" : ""}`}>
      {attachment ? (
        <button
          type="button"
          className="fin-thumb"
          onClick={() => onPhoto(attachment.id, entry.description ?? entry.placeName ?? "Comprovante")}
          aria-label="Ver comprovante"
        >
          <img src={attachmentThumbUrl(attachment.id)} alt="" loading="lazy" />
        </button>
      ) : (
        <EntryIcon entry={entry} />
      )}

      <button type="button" className="fin-entry-main" onClick={() => onSelect(entry)}>
        <span className="fin-entry-title">
          <span className="fin-entry-name">{title}</span>
          <InstallmentBadge entry={entry} />
          {entry.refundOfEntryId != null && <em className="fin-refund-tag">estorno</em>}
          {entry.goalId != null && (
            // Movimento de caixinha continua sendo transferência: não vira
            // receita nem despesa em relatório nenhum (D21).
            <em
              className="fin-goal-chip"
              style={{ borderColor: entry.goalColor ?? undefined }}
              title={`Caixinha ${entry.goalName ?? ""}`}
            >
              <PiggyBank size={11} aria-hidden />
              {entry.goalName}
            </em>
          )}
          {entry.tags.map((tag) => (
            <em key={tag.id} className="fin-tag-chip" style={{ borderColor: tag.color }}>
              {tag.name}
            </em>
          ))}
          {entry.attachments.length > 1 && (
            <span className="fin-clip" title={`${entry.attachments.length} anexos`}>
              <Paperclip size={12} />
              {entry.attachments.length}
            </span>
          )}
        </span>
        <span className="fin-entry-meta">{meta}</span>
      </button>

      <span className="fin-entry-side">
        <strong
          className={`fin-amount ${
            isTransfer ? "" : entry.amountCents < 0 ? "fin-negative" : "fin-positive"
          }`}
        >
          {merged ? moneyFromCents(Math.abs(entry.amountCents)) : signedMoneyFromCents(entry.amountCents)}
        </strong>
        {entry.status === "pending" && <em className="fin-status-pill">Pendente</em>}
        {entry.status === "reconciled" && (
          <em className="fin-status-ok" title="Conciliado com o extrato">
            <CheckCheck size={12} aria-hidden />
            Conciliado
          </em>
        )}
      </span>
    </li>
  );
}
