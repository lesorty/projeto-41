import { PiggyBank, Plus, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CdiStatus, EntryListResult, GoalProgress } from "@projeto41/contracts";
import { EntryTable } from "../../components/finance/EntryTable.js";
import { GoalCard } from "../../components/finance/GoalCard.js";
import { GoalDepositDrawer } from "../../components/finance/GoalDepositDrawer.js";
import { GoalDrawer } from "../../components/finance/GoalDrawer.js";
import { Modal } from "../../components/dialog.js";
import { Button, Empty, Kpi, Loading, SectionHeading } from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { longDate, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

export function GoalsPage() {
  const toast = useToast();
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [cdi, setCdi] = useState<CdiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GoalProgress | null>(null);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<GoalProgress | null>(null);
  const [statement, setStatement] = useState<{ goal: GoalProgress; rows: EntryListResult } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const [nextGoals, nextCdi] = await Promise.all([
        api<GoalProgress[]>("/ledger/goals"),
        api<CdiStatus>("/cdi/status")
      ]);
      setGoals(nextGoals);
      setCdi(nextCdi);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao carregar", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(
    () => ({
      saved: goals.reduce((sum, goal) => sum + goal.balanceCents, 0),
      yielding: goals
        .filter((goal) => goal.cdiPercent != null)
        .reduce((sum, goal) => sum + goal.balanceCents, 0),
      realized: goals.reduce((sum, goal) => sum + goal.realizedYieldCents, 0),
      projected: goals.reduce((sum, goal) => sum + goal.projectedYieldCents, 0)
    }),
    [goals]
  );

  async function openStatement(goal: GoalProgress) {
    const rows = await api<EntryListResult>(`/ledger/goals/${goal.id}/entries?pageSize=200`);
    setStatement({ goal, rows });
  }

  if (loading) return <Loading />;

  return (
    <>
      <SectionHeading title="Caixinhas" subtitle="Dinheiro separado com objetivo">
        <Button icon={Plus} onClick={() => setCreating(true)}>
          Nova caixinha
        </Button>
      </SectionHeading>

      <div className="fin-summary">
        <Kpi icon={PiggyBank} label="Total guardado" value={moneyFromCents(totals.saved)} />
        <Kpi icon={Wallet} label="Rendendo" value={moneyFromCents(totals.yielding)} />
        {/* Realizado e projetado em elementos separados, nunca num número só. */}
        <Kpi
          icon={TrendingUp}
          label="Rendimento realizado"
          value={moneyFromCents(totals.realized)}
          detail={cdi?.lastDate ? `CDI até ${longDate(cdi.lastDate)}` : undefined}
        />
        <Kpi
          icon={Sparkles}
          label="Projeção"
          value={moneyFromCents(totals.projected)}
          detail="repetindo o último fator conhecido"
        />
      </div>

      {cdi && cdi.staleDays != null && cdi.staleDays > 3 && (
        <p className="fin-warning">
          {/* `online: false` significa "a última tentativa falhou", não que o
              app esteja sem rede agora — dizer a segunda coisa seria alarmar
              sem base. */}
          CDI atualizado até {longDate(cdi.lastDate!)}
          {!cdi.online && " · a última tentativa de atualizar não completou"}. O rendimento
          realizado vai até essa data; o resto aparece como projeção.
        </p>
      )}

      {goals.length === 0 ? (
        <Empty icon={PiggyBank} text="Nenhuma caixinha ainda." />
      ) : (
        <div className="fin-goal-grid">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              cdiThrough={cdi?.lastDate ?? null}
              onOpen={() => void openStatement(goal)}
              onDeposit={() => setMoving(goal)}
              onEdit={() => setEditing(goal)}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <GoalDrawer
          goal={editing}
          personId={null}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await load();
          }}
        />
      )}

      {moving && (
        <GoalDepositDrawer
          goal={moving}
          onClose={() => setMoving(null)}
          onDone={async () => {
            setMoving(null);
            await load();
          }}
        />
      )}

      {statement && (
        <Modal title={`Extrato · ${statement.goal.name}`} onClose={() => setStatement(null)} width={900}>
          <div className="fin-goal-statement">
            <EntryTable
              rows={statement.rows.rows}
              onSelect={() => undefined}
              emptyText="Nenhum movimento nesta caixinha."
            />
          </div>
        </Modal>
      )}
    </>
  );
}
