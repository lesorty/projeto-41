import type { AppDatabase } from "@projeto41/db";

type Raw = AppDatabase["raw"];

/**
 * Enxugamento das categorias de despesa (30 -> 15).
 *
 * `keep` sobrevive (com o orçamento, a cor e a ordem que já tinha), as de
 * `absorb` entregam lançamentos, parcelamentos, lugares, sugestões de
 * importação e regras para ela e são apagadas, e `rename` dá o nome final.
 */
export const MERGES: { keep: string; rename?: string; absorb: string[] }[] = [
  { keep: "Alimentação", rename: "Mercado", absorb: ["Mercado", "Higiene", "Limpeza", "Meire"] },
  { keep: "Rolê", rename: "Lazer", absorb: ["Alimentação - N.E.", "Jogos"] },
  { keep: "Transporte", absorb: ["Gasolina", "Custos Blablacar"] },
  { keep: "Carro", rename: "Carro e Moto", absorb: ["Moto"] },
  { keep: "Contas Fixas", absorb: ["Assinatura"] },
  { keep: "Doação", rename: "Presentes e doações", absorb: ["Presente"] },
  { keep: "Educação", absorb: ["Pessoal"] },
  { keep: "Eletrônico", rename: "Compras", absorb: ["Roupas"] }
];

/** Categorias sem uso que só atrapalham a lista. */
const DROP_IF_UNUSED = ["Investimento"];

/**
 * Lançamentos que estavam na categoria errada e só aparecem quando as
 * categorias são enxugadas. Rodam ANTES das fusões, por isso usam os nomes
 * antigos (a de destino é a que sobrevive a cada fusão). Casam por categoria,
 * data e valor — três campos que, juntos, identificam um único lançamento.
 */
type Move = { from: string; date: string; cents: number; to: string };
export const MOVES: Move[] = [
  // Contas Fixas -> Educação (faculdade), Saúde e Mercado
  { from: "Contas Fixas", date: "2025-10-06", cents: -42077, to: "Educação" },
  { from: "Contas Fixas", date: "2025-11-07", cents: -42077, to: "Educação" },
  { from: "Contas Fixas", date: "2025-12-09", cents: -42077, to: "Educação" },
  { from: "Contas Fixas", date: "2026-03-03", cents: -44391, to: "Educação" },
  { from: "Contas Fixas", date: "2026-05-11", cents: -44391, to: "Educação" },
  { from: "Contas Fixas", date: "2026-01-05", cents: -9628, to: "Saúde" },
  { from: "Contas Fixas", date: "2026-02-03", cents: -9628, to: "Saúde" },
  { from: "Contas Fixas", date: "2026-09-12", cents: -12631, to: "Alimentação" },
  // Estética -> Saúde (óculos e lentes)
  { from: "Estética", date: "2026-02-08", cents: -57998, to: "Saúde" },
  { from: "Estética", date: "2026-02-09", cents: -45000, to: "Saúde" },
  // Outros -> onde cada um pertence
  { from: "Outros", date: "2026-09-09", cents: -4000, to: "Eletrônico" },
  { from: "Outros", date: "2025-11-07", cents: -1000, to: "Saúde" },
  { from: "Outros", date: "2026-05-07", cents: -3671, to: "Alimentação" },
  { from: "Outros", date: "2025-12-23", cents: -2200, to: "Casa" },
  { from: "Outros", date: "2026-04-07", cents: -1550, to: "Contas Fixas" },
  { from: "Outros", date: "2026-10-01", cents: -1800, to: "Transporte" },
  { from: "Outros", date: "2025-09-25", cents: -1500, to: "Rolê" },
  { from: "Outros", date: "2026-02-09", cents: -2250, to: "Rolê" },
  { from: "Outros", date: "2026-02-12", cents: -1120, to: "Rolê" },
  { from: "Outros", date: "2026-06-22", cents: -1760, to: "Rolê" },
  { from: "Outros", date: "2025-09-28", cents: -2100, to: "Doação" }
];

/** A regra manda todo "Pix por aproximação" para Outros; sem ela vai para revisão. */
const RULES_TO_DROP = ["Transferência enviada pelo Pix por aproximação (saida)"];

export type ConsolidationReport = {
  moved: number;
  skippedMoves: string[];
  merged: { from: string; into: string; entries: number }[];
  droppedCategories: string[];
  droppedRules: string[];
  expenseTotalCents: number;
  categories: { name: string; entries: number; totalCents: number }[];
};

class DryRun extends Error {}

function snapshot(raw: Raw) {
  const row = raw
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents END), 0) AS expense
       FROM entries`
    )
    .get() as { n: number; total: number; expense: number };
  return row;
}

/**
 * Aplica o enxugamento numa transação. Com `apply: false` roda tudo, confere e
 * desfaz — o relatório é o mesmo que o real teria. Lança se o total de
 * lançamentos ou de despesas mudar: fundir categoria nunca mexe em valor.
 */
export function consolidateCategories(raw: Raw, options: { apply: boolean }): ConsolidationReport {
  const report: ConsolidationReport = {
    moved: 0,
    skippedMoves: [],
    merged: [],
    droppedCategories: [],
    droppedRules: [],
    expenseTotalCents: 0,
    categories: []
  };

  const idOf = (name: string): number | undefined =>
    (
      raw.prepare("SELECT id FROM categories WHERE name = ? AND kind = 'expense'").get(name) as
        | { id: number }
        | undefined
    )?.id;

  const run = () => {
    const before = snapshot(raw);

    for (const move of MOVES) {
      const from = idOf(move.from);
      const to = idOf(move.to);
      if (from == null || to == null) {
        report.skippedMoves.push(`${move.date} ${move.from} -> ${move.to}: categoria não existe`);
        continue;
      }
      const matches = raw
        .prepare(
          `SELECT id FROM entries
           WHERE category_id = ? AND date = ? AND amount_cents = ? AND kind = 'expense'`
        )
        .all(from, move.date, move.cents) as { id: number }[];
      if (matches.length !== 1) {
        report.skippedMoves.push(
          `${move.date} ${move.cents / 100} ${move.from} -> ${move.to}: ${matches.length} lançamentos casam`
        );
        continue;
      }
      raw.prepare("UPDATE entries SET category_id = ? WHERE id = ?").run(to, matches[0]!.id);
      report.moved += 1;
    }

    for (const merge of MERGES) {
      const keepId = idOf(merge.keep);
      if (keepId == null) continue;
      for (const name of merge.absorb) {
        const fromId = idOf(name);
        if (fromId == null) continue;
        const entries = (
          raw.prepare("SELECT COUNT(*) AS n FROM entries WHERE category_id = ?").get(fromId) as {
            n: number;
          }
        ).n;
        raw.prepare("UPDATE entries SET category_id = ? WHERE category_id = ?").run(keepId, fromId);
        raw
          .prepare("UPDATE installment_plans SET category_id = ? WHERE category_id = ?")
          .run(keepId, fromId);
        raw
          .prepare("UPDATE import_rows SET suggested_category_id = ? WHERE suggested_category_id = ?")
          .run(keepId, fromId);
        raw
          .prepare("UPDATE places SET default_category_id = ? WHERE default_category_id = ?")
          .run(keepId, fromId);
        raw
          .prepare(
            "UPDATE rule_actions SET value = ? WHERE action = 'set_category' AND value = ?"
          )
          .run(String(keepId), String(fromId));
        raw.prepare("DELETE FROM categories WHERE id = ?").run(fromId);
        report.merged.push({ from: name, into: merge.rename ?? merge.keep, entries });
      }
      if (merge.rename && merge.rename !== merge.keep) {
        if (idOf(merge.rename) != null) {
          throw new Error(`Já existe uma categoria "${merge.rename}"; renomeie ou funda à mão antes`);
        }
        raw.prepare("UPDATE categories SET name = ? WHERE id = ?").run(merge.rename, keepId);
      }
    }

    for (const name of DROP_IF_UNUSED) {
      const id = idOf(name);
      if (id == null) continue;
      const used = (
        raw.prepare("SELECT COUNT(*) AS n FROM entries WHERE category_id = ?").get(id) as { n: number }
      ).n;
      if (used === 0) {
        raw.prepare("DELETE FROM categories WHERE id = ?").run(id);
        report.droppedCategories.push(name);
      }
    }

    for (const name of RULES_TO_DROP) {
      const dropped = raw.prepare("DELETE FROM rules WHERE name = ?").run(name).changes;
      if (dropped > 0) report.droppedRules.push(name);
    }

    const after = snapshot(raw);
    if (after.n !== before.n || after.total !== before.total || after.expense !== before.expense) {
      throw new Error(
        `Totais mudaram (lançamentos ${before.n}->${after.n}, despesas ${before.expense}->${after.expense}); nada foi gravado`
      );
    }
    report.expenseTotalCents = after.expense;
    report.categories = raw
      .prepare(
        `SELECT c.name, COUNT(e.id) AS entries, COALESCE(SUM(e.amount_cents), 0) AS totalCents
         FROM categories c LEFT JOIN entries e ON e.category_id = c.id
         WHERE c.kind = 'expense' AND c.archived = 0
         GROUP BY c.id ORDER BY entries DESC`
      )
      .all() as ConsolidationReport["categories"];
  };

  raw.exec("BEGIN");
  try {
    run();
    if (options.apply) {
      raw.exec("COMMIT");
    } else {
      throw new DryRun();
    }
  } catch (error) {
    raw.exec("ROLLBACK");
    if (!(error instanceof DryRun)) throw error;
  }
  return report;
}
