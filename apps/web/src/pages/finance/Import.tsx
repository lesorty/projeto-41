import { FileUp, ListChecks, RotateCcw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ImportBatchSummary,
  ImportBatchView,
  ImportRowConfirm,
  ImportRowStatus,
  ImportRowView,
  StatementKind
} from "@projeto41/contracts";
import { useConfirm } from "../../components/dialog.js";
import { Dropdown } from "../../components/forms.js";
import { ImportRowDialog } from "../../components/finance/ImportRowDialog.js";
import { Button, Empty, Field, Loading, Panel, SectionHeading, Segmented, Tag } from "../../components/ui.js";
import { ledgerDate, signedMoneyFromCents } from "../../lib/format.js";
import { ACCOUNT_KIND_LABEL, useLedgerReference } from "../../lib/ledger.js";
import { importApi } from "../../lib/ledger-import.js";
import { useToast } from "../../lib/toast.js";
import { FilePicker } from "../../components/FilePicker.js";

const STATUS: Record<ImportRowStatus, { label: string; tone: string }> = {
  needs_review: { label: "A revisar", tone: "warning" },
  new: { label: "Pronto (automático)", tone: "info" },
  duplicate: { label: "Já importado", tone: "neutral" },
  ignored: { label: "Pulado", tone: "neutral" },
  committed: { label: "Importado", tone: "positive" }
};

/** Contas que recebem extrato; a fatura vai sempre para um cartão. */
const BANK_KINDS = new Set(["checking", "savings", "cash", "meal_voucher"]);

const HELP: Record<StatementKind, React.ReactNode> = {
  bank: (
    <>
      No app do Nubank: <strong>Extrato → ícone de exportar → CSV</strong>. O arquivo tem as
      colunas Data, Valor, Identificador e Descrição. O identificador de cada transação evita
      importar a mesma linha duas vezes.
    </>
  ),
  card: (
    <>
      No app do Nubank: <strong>Cartão → Faturas → escolha a fatura → exportar CSV</strong>. O
      arquivo tem as colunas date, title e amount, com a compra em valor positivo. Parcelas
      (&quot;Parcela 2/4&quot;) contam como o mesmo estabelecimento, e &quot;Pagamento recebido&quot; é
      pulado: o pagamento da fatura já sai da conta pela tela Fatura.
    </>
  )
};

/**
 * Importação de extrato: sobe o arquivo e revisa lançamento por lançamento.
 *
 * Nada vai para o livro sem passar pelo popup ou por uma regra "sempre
 * automático" que o próprio usuário criou num popup anterior.
 */
export function ImportPage() {
  const reference = useLedgerReference();
  const toast = useToast();
  const confirm = useConfirm();

  const [kind, setKind] = useState<StatementKind>("bank");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [view, setView] = useState<ImportBatchView | null>(null);
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const accounts = useMemo(
    () =>
      reference.accounts
        .filter(
          (account) =>
            !account.archived &&
            (kind === "card" ? account.kind === "credit_card" : BANK_KINDS.has(account.kind))
        )
        .map((account) => ({
          value: account.id,
          label: account.name,
          color: account.color,
          hint: [account.personName, ACCOUNT_KIND_LABEL[account.kind]].filter(Boolean).join(" · ")
        })),
    [reference.accounts, kind]
  );

  const loadBatches = useCallback(async () => {
    try {
      setBatches(await importApi.list());
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao carregar importações", "error");
    }
  }, [toast]);

  useEffect(() => void loadBatches(), [loadBatches]);

  const queue = useMemo(() => view?.rows.filter((row) => row.status === "needs_review") ?? [], [view]);
  const openRow = view?.rows.find((row) => row.id === openRowId) ?? null;

  /**
   * Depois de cada resposta, o próximo da fila **depois** do que acabou de ser
   * respondido — quem escolheu um lançamento no meio da lista segue dali, e
   * só volta ao começo quando chega ao fim.
   */
  function advance(next: ImportBatchView, fromRowId?: number) {
    setView(next);
    const from = next.rows.findIndex((row) => row.id === fromRowId);
    const pending =
      next.rows.find((row, index) => index > from && row.status === "needs_review") ??
      next.rows.find((row) => row.status === "needs_review");
    setOpenRowId(pending?.id ?? null);
    if (!pending) {
      const ready = next.counts.ready;
      toast.notify(
        ready > 0
          ? `Revisão concluída. ${ready} lançamento(s) automático(s) prontos para importar.`
          : "Revisão concluída"
      );
    }
  }

  async function sendFile() {
    if (!file || accountId == null) return;
    setUploading(true);
    try {
      const next = await importApi.upload(accountId, kind, file);
      if (next.previousImportAt) {
        toast.notify(
          `Este arquivo já foi enviado em ${ledgerDate(next.previousImportAt.slice(0, 10))}. O que já entrou aparece como "Já importado".`
        );
      }
      setFile(null);
      await loadBatches();
      advance(next);
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao ler o arquivo", "error");
    } finally {
      setUploading(false);
    }
  }

  async function openBatch(batchId: number) {
    try {
      const next = await importApi.get(batchId);
      setView(next);
      setOpenRowId(next.rows.find((row) => row.status === "needs_review")?.id ?? null);
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao abrir o lote", "error");
    }
  }

  async function submitRow(row: ImportRowView, body: ImportRowConfirm) {
    if (!view) return;
    setBusy(true);
    try {
      const next = await importApi.confirm(view.batch.id, row.id, body);
      advance(next, row.id);
      void loadBatches();
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao gravar", "error");
    } finally {
      setBusy(false);
    }
  }

  async function reopenRow(row: ImportRowView) {
    if (!view) return;
    try {
      const next = await importApi.reopen(view.batch.id, row.id);
      setView(next);
      setOpenRowId(row.id);
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao reabrir a linha", "error");
    }
  }

  async function commitReady() {
    if (!view) return;
    const ok = await confirm({
      title: "Importar os automáticos",
      message: `Gravar ${view.counts.ready} lançamento(s) com a categoria e o local das regras "sempre automático"?`,
      confirmLabel: "Importar"
    });
    if (!ok) return;
    setBusy(true);
    try {
      const next = await importApi.commitReady(view.batch.id);
      setView(next);
      toast.notify(`${view.counts.ready} lançamento(s) importado(s)`);
      void loadBatches();
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao importar", "error");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!view) return;
    const pending = view.counts.review + view.counts.ready;
    const ok = await confirm({
      title: "Encerrar lote",
      message: `${pending} lançamento(s) ainda não gravado(s) serão deixados de fora. O que já foi importado continua no livro.`,
      confirmLabel: "Encerrar",
      tone: "danger"
    });
    if (!ok) return;
    try {
      setView(await importApi.discard(view.batch.id));
      void loadBatches();
    } catch (cause) {
      toast.notify(cause instanceof Error ? cause.message : "Falha ao encerrar", "error");
    }
  }

  const categoryName = (id: number | null) =>
    id == null ? null : (reference.categories.find((category) => category.id === id)?.name ?? null);

  if (reference.loading) return <Loading />;

  return (
    <>
      <SectionHeading
        title="Importar extrato"
        subtitle="Suba o extrato da conta ou a fatura do cartão (CSV do Nubank ou OFX) e revise lançamento por lançamento antes de gravar."
      />

      <Panel title="Enviar arquivo">
        <Field label="Tipo de arquivo">
          <Segmented<StatementKind>
            value={kind}
            onChange={(next) => {
              setKind(next);
              setAccountId(null);
            }}
            options={[
              { value: "bank", label: "Extrato da conta" },
              { value: "card", label: "Fatura do cartão" }
            ]}
          />
        </Field>
        <div className="fin-import-upload">
          <Field label={kind === "card" ? "Cartão" : "Conta do extrato"}>
            <Dropdown<number>
              value={accountId}
              onChange={setAccountId}
              options={accounts}
              placeholder={kind === "card" ? "Escolher cartão" : "Escolher conta"}
              aria-label={kind === "card" ? "Cartão" : "Conta do extrato"}
            />
          </Field>
          <Field label="Arquivo">
            <FilePicker
              file={file}
              onChange={setFile}
              accept=".csv,.ofx,text/csv"
              placeholder="CSV ou OFX, até 10 MB"
              aria-label="Escolher o arquivo do extrato"
            />
          </Field>
          <Button icon={Upload} onClick={() => void sendFile()} disabled={!file || accountId == null || uploading}>
            {uploading ? "Lendo…" : kind === "card" ? "Ler fatura" : "Ler extrato"}
          </Button>
        </div>
        <p className="fin-callout">
          {HELP[kind]} Um lançamento que já está no livro com o mesmo valor no mesmo dia é
          oferecido para vincular, em vez de duplicar.
        </p>
      </Panel>

      {view && (
        <Panel
          title={`${view.batch.fileName} · ${view.batch.accountName}`}
          subtitle={
            view.batch.periodStart
              ? `${ledgerDate(view.batch.periodStart)} a ${ledgerDate(view.batch.periodEnd ?? view.batch.periodStart)} · ${view.rows.length} linhas`
              : `${view.rows.length} linhas`
          }
          action={
            <Button variant="ghost" icon={X} onClick={() => setView(null)}>
              Fechar
            </Button>
          }
        >
          <div className="fin-import-summary">
            <Tag tone="warning">{view.counts.review} a revisar</Tag>
            <Tag tone="info">{view.counts.ready} prontos</Tag>
            <Tag tone="positive">{view.counts.committed} importados</Tag>
            <Tag tone="neutral">{view.counts.duplicate} já importados</Tag>
            <Tag tone="neutral">{view.counts.ignored} pulados</Tag>
            {view.batch.status === "discarded" && <Tag tone="negative">Lote encerrado</Tag>}
          </div>
          {view.batch.status !== "discarded" && (
            <div className="fin-import-toolbar">
              <Button
                icon={ListChecks}
                disabled={queue.length === 0}
                onClick={() => setOpenRowId(queue[0]?.id ?? null)}
              >
                Revisar ({queue.length})
              </Button>
              <Button variant="soft" icon={FileUp} disabled={view.counts.ready === 0 || busy} onClick={() => void commitReady()}>
                Importar prontos ({view.counts.ready})
              </Button>
              {view.counts.review + view.counts.ready > 0 && (
                <Button variant="ghost" onClick={() => void discard()}>
                  Encerrar lote
                </Button>
              )}
            </div>
          )}

          <div className="table-scroll">
            <table className="data-table fin-import-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Com quem</th>
                  <th>Classificação</th>
                  <th className="right">Valor</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => {
                  const status = row.skippedBefore
                    ? { label: "Já pulado antes", tone: "neutral" }
                    : STATUS[row.status];
                  const editable = row.status === "needs_review" || row.status === "new";
                  const reopenable =
                    view.batch.status !== "discarded" && (row.status === "ignored" || row.status === "duplicate");
                  return (
                    <tr key={row.id}>
                      <td>{ledgerDate(row.date)}</td>
                      <td>
                        <strong>{row.payee.display}</strong>
                        <small className="fin-import-raw-inline">{row.rawDescription}</small>
                      </td>
                      <td>
                        {[
                          categoryName(row.suggestion.categoryId),
                          // Sem regra o local sugerido é o próprio nome, já na coluna ao lado.
                          row.rule || row.suggestion.placeName !== row.payee.display
                            ? row.suggestion.placeName
                            : null,
                          row.suggestion.description
                        ]
                          .filter(Boolean)
                          .join(" · ") || <span className="muted">—</span>}
                      </td>
                      <td className={`num right ${row.amountCents < 0 ? "negative" : "positive"}`}>
                        {signedMoneyFromCents(row.amountCents)}
                      </td>
                      <td>
                        <Tag tone={status.tone}>{status.label}</Tag>
                      </td>
                      <td className="fin-import-row-action">
                        {editable && view.batch.status !== "discarded" && (
                          <Button variant="ghost" onClick={() => setOpenRowId(row.id)}>
                            {row.status === "new" ? "Editar" : "Revisar"}
                          </Button>
                        )}
                        {reopenable && (
                          <Button variant="ghost" icon={RotateCcw} onClick={() => void reopenRow(row)}>
                            {row.status === "duplicate" ? "Importar mesmo assim" : "Revisar"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Importações recentes">
        {batches.length === 0 ? (
          <Empty icon={FileUp} text="Nenhum extrato enviado ainda." />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Arquivo</th>
                  <th>Conta</th>
                  <th>Enviado</th>
                  <th className="right">Importados</th>
                  <th className="right">Pendentes</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td>{batch.fileName}</td>
                    <td>{batch.accountName}</td>
                    <td>{ledgerDate(batch.importedAt.slice(0, 10))}</td>
                    <td className="num right">
                      {batch.committedCount} de {batch.rowCount}
                    </td>
                    <td className="num right">
                      {batch.status === "discarded" ? <Tag tone="neutral">encerrado</Tag> : batch.pendingCount}
                    </td>
                    <td className="fin-import-row-action">
                      <Button variant="ghost" onClick={() => void openBatch(batch.id)}>
                        {batch.pendingCount > 0 && batch.status !== "discarded" ? "Continuar" : "Abrir"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {view && openRow && (
        <ImportRowDialog
          key={openRow.id}
          row={openRow}
          accountId={view.batch.accountId}
          reference={reference}
          cardInvoice={view.batch.statementKind === "card"}
          queue={view.rows.filter((row) => row.status === "needs_review" || row.id === openRow.id)}
          onPick={setOpenRowId}
          remaining={Math.max(queue.length, 1)}
          busy={busy}
          onSubmit={(body) => submitRow(openRow, body)}
          onClose={() => setOpenRowId(null)}
        />
      )}
    </>
  );
}
