import { useCallback, useEffect, useMemo, useState } from "react";
import { AllocationBoard, type AllocationRow } from "../components/AllocationBoard.js";
import { MiniStat, Panel, SectionHeading } from "../components/ui.js";
import { api } from "../lib/api.js";
import { categoryLabel, money, percent } from "../lib/format.js";
import { useToast } from "../lib/toast.js";
import type { AllocationTarget, Dashboard } from "@projeto41/contracts";

const aliasToCategory: Record<string, string> = {
  dolar: "dollar",
  caixa_br: "cash",
  bolsa_brasil: "b3",
  renda_fixa: "fixed_income",
  acoes_globais: "global"
};

function actualValue(category: string, dashboard: Dashboard) {
  // As classes do livro (prefixo `ledger:`) medem caixa, não carteira: elas
  // nunca entram nos pesos da alocação.
  if (category.startsWith("ledger:")) return 0;
  if (category === "bitcoin") {
    return dashboard.portfolios.crypto.find((asset) => asset.asset === "BTC")?.marketValueBrl ?? 0;
  }
  if (category === "shitcoins") {
    return dashboard.portfolios.crypto
      .filter((asset) => asset.asset !== "BTC")
      .reduce((sum, asset) => sum + asset.marketValueBrl, 0);
  }
  return dashboard.categories[aliasToCategory[category] ?? category] ?? 0;
}

const oneDecimal = (weight: number) => `${(weight * 100).toFixed(1).replace(".", ",")}%`;

export function AllocationPage({ dashboard }: { dashboard: Dashboard }) {
  const toast = useToast();
  const [targets, setTargets] = useState<AllocationTarget[]>([]);
  const load = useCallback(() => api<AllocationTarget[]>("/allocation").then(setTargets), []);
  useEffect(() => void load(), [load]);

  // `investableBrl` mede só o módulo de investimentos, líquido da reserva. Usar
  // `totalBrl` aqui passaria a incluir conta corrente nos pesos da carteira e
  // distorceria todas as metas.
  const investable = dashboard.investableBrl;

  // Ordenado pelo valor atual (estável durante o arraste do slider).
  const rows = useMemo(
    () =>
      targets
        .map((target) => {
          const actual = actualValue(target.category, dashboard);
          return {
            ...target,
            actual,
            actualWeight: investable > 0 ? actual / investable : 0
          };
        })
        .sort((a, b) => b.actual - a.actual),
    [targets, dashboard, investable]
  );

  const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0);
  const weightOff = Math.abs(totalWeight - 1) > 0.0005;

  const boardRows = useMemo<AllocationRow[]>(
    () =>
      rows.map((row) => ({
        key: row.category,
        label: categoryLabel(row.category),
        detail: `${money(row.actual)} · ${percent(row.actualWeight)} atual`,
        actualWeight: row.actualWeight,
        weight: row.weight
      })),
    [rows]
  );

  function setWeight(category: string, weight: number) {
    setTargets((current) =>
      current.map((target) => (target.category === category ? { ...target, weight } : target))
    );
  }

  async function commit(category: string, weight: number) {
    await api(`/allocation/${category}`, { method: "PUT", body: JSON.stringify({ weight }) });
    toast.notify("Meta atualizada");
  }

  return (
    <div className="allocation">
      <SectionHeading
        title="Alocação ideal"
        subtitle="Compara a estratégia com a carteira atual (reserva excluída)"
      />

      <div className="summary-row">
        <MiniStat label="Total investível" value={money(investable)} />
        <MiniStat label="Reserva (fora da meta)" value={money(dashboard.reserveBrl)} />
        <MiniStat
          label={weightOff ? "Soma das metas · ajuste p/ 100%" : "Soma das metas"}
          value={oneDecimal(totalWeight)}
          tone={weightOff ? "negative-text" : "positive-text"}
        />
      </div>

      <Panel title="Real x ideal" subtitle="Arraste o marcador para definir a meta de cada classe">
        <AllocationBoard
          rows={boardRows}
          onChange={setWeight}
          onCommit={commit}
          emptyText="Nenhuma meta de alocação definida."
        />
      </Panel>
    </div>
  );
}
