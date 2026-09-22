import { ArrowLeftRight, Paperclip, Receipt } from "lucide-react";
import { useState } from "react";
import type { EntryRecord } from "@projeto41/contracts";
import { Modal } from "../dialog.js";
import { Empty, StatusDot } from "../ui.js";
import { ColorDot } from "../ColorPicker.js";
import { ledgerDate, signedMoneyFromCents } from "../../lib/format.js";
import { STATUS_LABEL, attachmentThumbUrl, attachmentUrl } from "../../lib/ledger.js";

/**
 * A tabela unica do livro.
 *
 * Transacoes, Gastos e Entradas usam exatamente este componente: a diferenca
 * entre as tres telas e so o filtro fixo de tipo, entao o design e identico por
 * construcao, e nao por disciplina.
 */
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

  if (rows.length === 0) return <Empty icon={Receipt} text={emptyText} />;

  return (
    <>
      <div className="table-scroll">
        <table className="data-table fin-entries">
          <thead>
            <tr>
              <th>Data</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Pessoa</th>
              <th>Conta</th>
              <th>Status</th>
              <th className="num">Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const isTransfer = entry.kind === "transfer";
              const attachment = entry.attachments[0];
              return (
                <tr key={entry.id} className={entry.status === "pending" ? "fin-row-pending" : ""}>
                  <td className="fin-date">{ledgerDate(entry.date)}</td>
                  <td>
                    <div className="fin-desc">
                      {attachment && (
                        <button
                          type="button"
                          className="fin-thumb"
                          onClick={() =>
                            setPhoto({
                              id: attachment.id,
                              label: entry.description ?? entry.placeName ?? "Comprovante"
                            })
                          }
                          aria-label="Ver comprovante"
                        >
                          <img src={attachmentThumbUrl(attachment.id)} alt="" loading="lazy" />
                        </button>
                      )}
                      <button className="fin-link" onClick={() => onSelect(entry)}>
                        <span className="fin-desc-main">
                          {isTransfer && <ArrowLeftRight size={13} aria-hidden />}
                          {entry.description ?? entry.placeName ?? "Sem descrição"}
                          {entry.installmentNumber != null && entry.installmentCount != null && (
                            <em
                              className={`fin-installment ${
                                entry.installmentNumber === entry.installmentCount ? "last" : ""
                              }`}
                            >
                              {entry.installmentNumber}/{entry.installmentCount}
                            </em>
                          )}
                        </span>
                        {entry.placeName && entry.description && (
                          <small className="fin-sub">{entry.placeName}</small>
                        )}
                        {isTransfer && entry.counterpartAccountName && (
                          <small className="fin-sub">
                            {entry.amountCents < 0 ? "para " : "de "}
                            {entry.counterpartAccountName}
                          </small>
                        )}
                      </button>
                      {entry.tags.length > 0 && (
                        <span className="fin-tags">
                          {entry.tags.map((tag) => (
                            <em key={tag.id} style={{ borderColor: tag.color }}>
                              {tag.name}
                            </em>
                          ))}
                        </span>
                      )}
                      {entry.attachments.length > 1 && (
                        <span className="fin-clip" title={`${entry.attachments.length} anexos`}>
                          <Paperclip size={12} />
                          {entry.attachments.length}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    {entry.categoryName ? (
                      <span className="fin-inline">
                        <ColorDot color={entry.categoryColor ?? "#8b949e"} />
                        {entry.categoryName}
                      </span>
                    ) : (
                      <span className="fin-muted">{isTransfer ? "Transferência" : "—"}</span>
                    )}
                  </td>
                  <td>
                    {entry.personName ? (
                      <span className="fin-inline">
                        <ColorDot color={entry.personColor ?? "#8b949e"} />
                        {entry.personName}
                      </span>
                    ) : (
                      <span className="fin-muted">—</span>
                    )}
                  </td>
                  <td>{entry.accountName}</td>
                  <td>
                    <span className="fin-inline">
                      <StatusDot status={entry.status === "pending" ? "stale" : "ok"} />
                      {STATUS_LABEL[entry.status]}
                    </span>
                  </td>
                  <td
                    className={`num fin-amount ${
                      entry.amountCents < 0 ? "fin-negative" : "fin-positive"
                    }`}
                  >
                    {signedMoneyFromCents(entry.amountCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {photo && (
        <Modal title={photo.label} onClose={() => setPhoto(null)}>
          <img className="fin-photo-full" src={attachmentUrl(photo.id)} alt={photo.label} />
        </Modal>
      )}
    </>
  );
}
