import { Download, HardDriveDownload, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntryRecord } from "@projeto41/contracts";
import { CategoryGoals } from "../../components/finance/CategoryGoals.js";
import { EntryDrawer } from "../../components/finance/EntryDrawer.js";
import { EntryFilters, type LedgerFilter } from "../../components/finance/EntryFilters.js";
import { EntryTable } from "../../components/finance/EntryTable.js";
import { Button, Loading, Panel, SectionHeading } from "../../components/ui.js";
import { moneyFromCents, signedMoneyFromCents } from "../../lib/format.js";
import { filterToQuery, ledgerApi, useLedgerReference } from "../../lib/ledger.js";
import type { LedgerPreset } from "../../lib/navigation.js";
import { useToast } from "../../lib/toast.js";

/**
 * O livro. Transacoes, Gastos e Entradas sao a mesma tela com um filtro fixo
 * de tipo — o design e identico nas tres por construcao (Task 8 da fase 1).
 */

type LedgerKind = "expense" | "income";

function firstDayOfMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(
    last.getDate()
  ).padStart(2, "0")}`;
}

export function LedgerPage({
  title,
  subtitle,
  fixedKind,
  preset = {}
}: {
  title: string;
  subtitle: string;
  /** Ausente em Transações: a tela mostra tudo, inclusive transferências. */
  fixedKind?: LedgerKind;
  /** Recorte trazido de outra tela, como o card do Painel. */
  preset?: LedgerPreset;
}) {
  const toast = useToast();
  const reference = useLedgerReference();
  const [filter, setFilter] = useState<LedgerFilter>(() => ({
    from: preset.from ?? firstDayOfMonth(),
    to: preset.to ?? lastDayOfMonth(),
    ...(preset.personId != null ? { personId: preset.personId } : {}),
    page: 1,
    pageSize: 50
  }));
  const [result, setResult] = useState<Awaited<ReturnType<typeof ledgerApi.entries>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EntryRecord | null>(null);
  const [creating, setCreating] = useState(false);

  const effectiveFilter = useMemo(
    () => (fixedKind ? { ...filter, kind: fixedKind } : filter),
    [filter, fixedKind]
  );

  const load = useCallback(async () => {
    try {
      setResult(await ledgerApi.entries(effectiveFilter));
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [effectiveFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = result?.totals;
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <>
      <SectionHeading title={title} subtitle={subtitle}>
        {/* Backup fica visível: num app local sem nuvem é requisito, não conveniência. */}
        <Button
          variant="ghost"
          icon={HardDriveDownload}
          onClick={() => window.open("/api/backup", "_blank")}
        >
          Backup
        </Button>
        <Button
          variant="ghost"
          icon={Download}
          onClick={() =>
            window.open(`/api/ledger/export.csv${filterToQuery(effectiveFilter)}`, "_blank")
          }
        >
          Exportar CSV
        </Button>
        <Button icon={Plus} onClick={() => setCreating(true)}>
          Novo lançamento
        </Button>
      </SectionHeading>

      <Panel bodyClass="fin-filter-body">
        <EntryFilters
          filter={filter}
          onChange={setFilter}
          reference={reference}
          lockedKind={fixedKind != null}
        />
      </Panel>

      <div className="fin-summary">
        <Panel title="Entradas">
          <strong className="fin-positive">{moneyFromCents(totals?.incomeCents ?? 0)}</strong>
        </Panel>
        <Panel title="Saídas">
          <strong className="fin-negative">{moneyFromCents(totals?.expenseCents ?? 0)}</strong>
        </Panel>
        <Panel title="Líquido">
          <strong>{signedMoneyFromCents(totals?.netCents ?? 0)}</strong>
        </Panel>
      </div>

      {fixedKind === "expense" && filter.from && filter.to && (
        <Panel
          title="Objetivos por categoria"
          subtitle={
            filter.personId != null
              ? "Da casa toda: o objetivo é da categoria, não de uma pessoa"
              : "Quanto cada categoria gastou contra o objetivo, em valor ou em percentual"
          }
        >
          <CategoryGoals from={filter.from} to={filter.to} />
        </Panel>
      )}

      <Panel
        title={`${result?.total ?? 0} lançamento${(result?.total ?? 0) === 1 ? "" : "s"}`}
        subtitle="Os totais acima consideram o filtro inteiro, não só esta página"
      >
        {loading ? (
          <Loading />
        ) : (
          <EntryTable rows={result?.rows ?? []} onSelect={setEditing} />
        )}

        {pageCount > 1 && (
          <div className="fin-pager">
            <Button
              variant="ghost"
              disabled={(filter.page ?? 1) <= 1}
              onClick={() => setFilter((current) => ({ ...current, page: (current.page ?? 1) - 1 }))}
            >
              Anterior
            </Button>
            <span>
              Página {filter.page ?? 1} de {pageCount}
            </span>
            <Button
              variant="ghost"
              disabled={(filter.page ?? 1) >= pageCount}
              onClick={() => setFilter((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}
            >
              Próxima
            </Button>
          </div>
        )}
      </Panel>

      {(creating || editing) && (
        <EntryDrawer
          entry={editing}
          reference={reference}
          defaultKind={fixedKind ?? "expense"}
          onReloadReference={reference.reload}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
            await reference.reload();
          }}
        />
      )}
    </>
  );
}

type PresetProps = { preset?: LedgerPreset };

export const TransactionsPage = ({ preset }: PresetProps) => (
  <LedgerPage
    title="Transações"
    subtitle="Tudo que entrou, saiu e foi transferido"
    preset={preset}
  />
);

export const ExpensesPage = ({ preset }: PresetProps) => (
  <LedgerPage
    title="Gastos"
    subtitle="Só as saídas, pelo mesmo livro"
    fixedKind="expense"
    preset={preset}
  />
);

export const IncomePage = ({ preset }: PresetProps) => (
  <LedgerPage
    title="Entradas"
    subtitle="Só as receitas, pelo mesmo livro"
    fixedKind="income"
    preset={preset}
  />
);
