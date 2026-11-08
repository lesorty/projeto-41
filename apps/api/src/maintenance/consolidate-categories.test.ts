import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase, type AppDatabase } from "@projeto41/db";
import { consolidateCategories } from "./consolidate-categories.js";

let db: AppDatabase | undefined;

afterEach(() => db?.close());

function setup() {
  db = createTestDatabase();
  const raw = db.raw;
  // As categorias de fábrica não são as do usuário: parte de um cadastro limpo.
  raw.exec("DELETE FROM categories");
  const now = new Date().toISOString();
  const category = (name: string, budget: number | null = null) =>
    Number(
      raw
        .prepare(
          `INSERT INTO categories(name, kind, color, monthly_budget_cents, created_at)
           VALUES (?, 'expense', '#000', ?, ?)`
        )
        .run(name, budget, now).lastInsertRowid
    );
  const ids = Object.fromEntries(
    [
      ["Alimentação", 100_000],
      ["Mercado", null],
      ["Higiene", null],
      ["Rolê", 23_000],
      ["Alimentação - N.E.", null],
      ["Contas Fixas", null],
      ["Assinatura", null],
      ["Educação", null],
      ["Saúde", null],
      ["Estética", null],
      ["Outros", null],
      ["Investimento", null]
    ].map(([name, budget]) => [name, category(name as string, budget as number | null)])
  ) as Record<string, number>;

  raw
    .prepare(
      `INSERT INTO accounts(name, kind, person_id, color, created_at) VALUES ('Conta', 'checking', 1, '#000', ?)`
    )
    .run(now);
  const entry = (categoryId: number, date: string, cents: number) =>
    Number(
      raw
        .prepare(
          `INSERT INTO entries(account_id, date, amount_cents, kind, category_id, created_at, updated_at)
           VALUES (1, ?, ?, 'expense', ?, ?, ?)`
        )
        .run(date, cents, categoryId, now, now).lastInsertRowid
    );
  return { raw, ids, entry };
}

describe("consolidateCategories", () => {
  it("funde, renomeia e reaponta regras, mantendo o orçamento de quem sobrevive", () => {
    const { raw, ids, entry } = setup();
    entry(ids["Alimentação"]!, "2026-09-01", -5000);
    entry(ids["Higiene"]!, "2026-09-02", -2000);
    entry(ids["Alimentação - N.E."]!, "2026-09-03", -1500);
    entry(ids["Assinatura"]!, "2026-09-04", -3000);
    const ruleId = Number(
      raw
        .prepare("INSERT INTO rules(name, created_at) VALUES ('Pix', ?)")
        .run(new Date().toISOString()).lastInsertRowid
    );
    raw
      .prepare("INSERT INTO rule_actions(rule_id, action, value) VALUES (?, 'set_category', ?)")
      .run(ruleId, String(ids["Higiene"]));

    const report = consolidateCategories(raw, { apply: true });

    const names = (raw.prepare("SELECT name FROM categories ORDER BY name").all() as { name: string }[]).map(
      (row) => row.name
    );
    expect(names).toEqual(["Contas Fixas", "Educação", "Estética", "Lazer", "Mercado", "Outros", "Saúde"]);
    const mercado = raw
      .prepare("SELECT id, monthly_budget_cents AS budget FROM categories WHERE name = 'Mercado'")
      .get() as { id: number; budget: number };
    expect(mercado.id).toBe(ids["Alimentação"]);
    expect(mercado.budget).toBe(100_000);
    expect(
      raw.prepare("SELECT value FROM rule_actions WHERE rule_id = ?").get(ruleId)
    ).toEqual({ value: String(mercado.id) });
    expect(report.expenseTotalCents).toBe(-11_500);
    expect(report.droppedCategories).toEqual(["Investimento"]);
  });

  it("move os lançamentos que estavam na categoria errada", () => {
    const { raw, ids, entry } = setup();
    const oculos = entry(ids["Estética"]!, "2026-02-08", -57_998);
    const faculdade = entry(ids["Contas Fixas"]!, "2025-10-06", -42_077);

    const report = consolidateCategories(raw, { apply: true });

    const categoryOf = (id: number) =>
      (
        raw
          .prepare("SELECT c.name FROM entries e JOIN categories c ON c.id = e.category_id WHERE e.id = ?")
          .get(id) as { name: string }
      ).name;
    expect(categoryOf(oculos)).toBe("Saúde");
    expect(categoryOf(faculdade)).toBe("Educação");
    expect(report.moved).toBe(2);
  });

  it("no dry-run não grava nada, mas devolve o mesmo relatório", () => {
    const { raw, ids, entry } = setup();
    entry(ids["Higiene"]!, "2026-09-02", -2000);

    const report = consolidateCategories(raw, { apply: false });

    expect(report.merged).toContainEqual({ from: "Higiene", into: "Mercado", entries: 1 });
    expect(
      raw.prepare("SELECT COUNT(*) AS n FROM categories WHERE name = 'Higiene'").get()
    ).toEqual({ n: 1 });
  });

  it("não faz nada num banco que já foi enxugado", () => {
    const { raw, ids, entry } = setup();
    entry(ids["Higiene"]!, "2026-09-02", -2000);
    consolidateCategories(raw, { apply: true });

    const again = consolidateCategories(raw, { apply: true });

    expect(again.merged).toEqual([]);
    expect(again.droppedCategories).toEqual([]);
  });
});
