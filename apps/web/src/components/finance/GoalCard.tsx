import { ChevronLeft, ChevronRight, PiggyBank, Wallet } from "lucide-react";
import type { GoalProgress } from "@projeto41/contracts";
import { AnimatedNumber, Button, IconButton, Tag } from "../ui.js";
import { longDate, monthLabel, moneyFromCents } from "../../lib/format.js";

/**
 * Um cartão por caixinha.
 *
 * Bruto e líquido lado a lado (D15), e o rendimento **projetado sempre
 * visualmente distinto do realizado** — número sem rótulo aqui vira decisão
 * errada de resgate.
 */
export function GoalCard({
  goal,
  cdiThrough,
  onOpen,
  onDeposit,
  onEdit,
  onMove
}: {
  goal: GoalProgress;
  /** Troca de lugar com a vizinha; ausente na ponta onde não dá para ir. */
  onMove?: { back?: () => void; forward?: () => void };
  /** Última data com taxa publicada, para rotular a projeção. */
  cdiThrough: string | null;
  onOpen: () => void;
  onDeposit: () => void;
  onEdit: () => void;
}) {
  const percent = goal.targetRatioPerMille != null ? goal.targetRatioPerMille / 10 : null;
  const yields = goal.cdiPercent != null;

  return (
    <article className="fin-goal-card" style={{ borderTopColor: goal.color }}>
      <header className="fin-goal-head">
        <span className="fin-inline">
          <span className="fin-dot" style={{ background: goal.color }} aria-hidden />
          <strong>{goal.name}</strong>
        </span>
        <span className="fin-goal-tags">
          <Tag tone={goal.mode === "account" ? "info" : "muted"}>
            {goal.mode === "account" ? "Conta" : "Marcação"}
          </Tag>
          {yields && <Tag tone="positive">{goal.cdiPercent}% do CDI</Tag>}
          {onMove && (
            <span className="fin-goal-order">
              <IconButton
                icon={ChevronLeft}
                label="Mover para antes"
                disabled={!onMove.back}
                onClick={onMove.back}
              />
              <IconButton
                icon={ChevronRight}
                label="Mover para depois"
                disabled={!onMove.forward}
                onClick={onMove.forward}
              />
            </span>
          )}
        </span>
      </header>

      <div className="fin-goal-value">
        <AnimatedNumber value={goal.balanceCents / 100} format={(v) => moneyFromCents(v * 100)} />
        {/* O saldo é calculado: o que entrou mais o que rendeu. */}
        <small className="fin-muted">
          você colocou {moneyFromCents(goal.contributedCents)}
          {yields && goal.yieldCents !== 0 && ` · rendeu ${moneyFromCents(goal.yieldCents)}`}
          {goal.correctionCents !== 0 && ` · correções ${moneyFromCents(goal.correctionCents)}`}
        </small>
        {yields && (
          <small className="fin-muted">
            líquido se sacar hoje {moneyFromCents(goal.netCents)}
            {(goal.iofCents > 0 || goal.irCents > 0) && (
              <span title={`IOF ${moneyFromCents(goal.iofCents)} · IR ${moneyFromCents(goal.irCents)}`}>
                {" "}
                (IOF {moneyFromCents(goal.iofCents)} · IR {moneyFromCents(goal.irCents)})
              </span>
            )}
          </small>
        )}
      </div>

      {goal.targetAmountCents != null && (
        <>
          <div
            className="fin-target-track"
            role="progressbar"
            aria-valuenow={Math.round(percent ?? 0)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Progresso de ${goal.name}`}
          >
            <span
              className="fin-target-fill"
              style={{
                width: `${Math.min(Math.max(percent ?? 0, 0), 100)}%`,
                background: goal.color
              }}
            />
          </div>
          <small className="fin-target-foot fin-muted">
            {percent?.toFixed(1).replace(".", ",")}% de {moneyFromCents(goal.targetAmountCents)}
            {goal.remainingCents != null && ` · faltam ${moneyFromCents(goal.remainingCents)}`}
          </small>
        </>
      )}

      {yields && (
        <dl className="fin-goal-yield">
          <div>
            <dt>Rendimento no saldo</dt>
            <dd className="fin-positive">{moneyFromCents(goal.realizedYieldCents)}</dd>
          </div>
          <div>
            <dt className="fin-muted">A entrar</dt>
            {/* Tom apagado e sufixo explícito: projeção nunca se confunde com
                realizado, e nunca é somada a ele. */}
            <dd className="fin-muted">
              {moneyFromCents(goal.projectedYieldCents)} (projeção)
            </dd>
          </div>
        </dl>
      )}

      {goal.iofFreeFrom && (
        <p className="fin-warning">
          Há IOF incidindo sobre o aporte mais novo. Ele zera em{" "}
          {longDate(goal.iofFreeFrom)}.
        </p>
      )}

      <footer className="fin-goal-foot">
        <small className="fin-muted">
          {goal.targetDate && `alvo em ${longDate(goal.targetDate)} · `}
          {goal.projection.estimatedDate
            ? `no ritmo atual, alvo em ${monthLabel(goal.projection.estimatedDate.slice(0, 7))}`
            : "sem ritmo de depósito para projetar"}
          {yields && cdiThrough && ` · CDI atualizado até ${longDate(cdiThrough)}`}
        </small>
        <span className="fin-goal-actions">
          <Button variant="ghost" icon={Wallet} onClick={onDeposit}>
            Movimentar
          </Button>
          <Button variant="ghost" icon={PiggyBank} onClick={onOpen}>
            Extrato
          </Button>
          <Button variant="ghost" onClick={onEdit}>
            Editar
          </Button>
        </span>
      </footer>
    </article>
  );
}
