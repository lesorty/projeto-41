import type { Category, CategoryKind, CategoryRecord } from "@projeto41/contracts";
import { countReferencing, fromBit, notFound, nowIso, toBit, type Db } from "./shared.js";

type CategoryRow = {
  id: number;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string | null;
  monthlyBudgetCents: number | null;
  archived: number;
  sortOrder: number;
};

const SELECT = `
  SELECT id, name, kind, color, icon,
         monthly_budget_cents AS monthlyBudgetCents,
         archived, sort_order AS sortOrder
  FROM categories
`;

const map = (row: CategoryRow): CategoryRecord => ({
  ...row,
  archived: fromBit(row.archived)
});

export function createCategoriesRepository(db: Db) {
  return {
    list: (options: { kind?: CategoryKind; includeArchived?: boolean } = {}): CategoryRecord[] => {
      const where: string[] = [];
      const params: Record<string, unknown> = {};
      if (options.kind) {
        where.push("kind = @kind");
        params.kind = options.kind;
      }
      if (!options.includeArchived) where.push("archived = 0");
      const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      return (
        db.prepare(`${SELECT} ${clause} ORDER BY kind, sort_order, name`).all(params) as
          CategoryRow[]
      ).map(map);
    },

    get: (id: number): CategoryRecord | undefined => {
      const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as CategoryRow | undefined;
      return row ? map(row) : undefined;
    },

    create: (category: Category): number =>
      Number(
        db
          .prepare(
            `INSERT INTO categories
             (name, kind, color, icon, monthly_budget_cents, archived, sort_order, created_at)
             VALUES (@name, @kind, @color, @icon, @monthlyBudgetCents, @archived,
                     @sortOrder, @createdAt)`
          )
          .run({
            name: category.name,
            kind: category.kind,
            color: category.color,
            icon: category.icon ?? null,
            monthlyBudgetCents: category.monthlyBudgetCents ?? null,
            archived: toBit(category.archived, false),
            sortOrder: category.sortOrder ?? 0,
            createdAt: nowIso()
          }).lastInsertRowid
      ),

    update: (id: number, category: Category): number => {
      const changes = db
        .prepare(
          `UPDATE categories SET name=@name, kind=@kind, color=@color, icon=@icon,
           monthly_budget_cents=@monthlyBudgetCents, archived=@archived, sort_order=@sortOrder
           WHERE id=@id`
        )
        .run({
          id,
          name: category.name,
          kind: category.kind,
          color: category.color,
          icon: category.icon ?? null,
          monthlyBudgetCents: category.monthlyBudgetCents ?? null,
          archived: toBit(category.archived, false),
          sortOrder: category.sortOrder ?? 0
        }).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    },

    /** Orcamento e editado direto da tabela de totais da fase 2. */
    setBudget: (id: number, monthlyBudgetCents: number | null): number => {
      const changes = db
        .prepare("UPDATE categories SET monthly_budget_cents = ? WHERE id = ?")
        .run(monthlyBudgetCents, id).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    },

    archive: (id: number): number => {
      const changes = db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    },

    /**
     * Categoria usada em lancamento ou como padrao de local nao some: vira
     * arquivada, para nao quebrar relatorio antigo. Devolve 0 nesse caso.
     */
    remove: (id: number): number => {
      const used =
        countReferencing(db, "SELECT COUNT(*) AS n FROM entries WHERE category_id = ?", id) +
        countReferencing(
          db,
          "SELECT COUNT(*) AS n FROM places WHERE default_category_id = ?",
          id
        );
      if (used > 0) {
        db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(id);
        return 0;
      }
      const changes = db.prepare("DELETE FROM categories WHERE id = ?").run(id).changes;
      if (changes === 0) throw notFound("Categoria");
      return changes;
    }
  };
}
