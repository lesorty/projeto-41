import { describe, expect, it } from "vitest";
import { createTestDatabase } from "../index.js";

const insertRule = (db: ReturnType<typeof createTestDatabase>, extra = "") =>
  db.raw
    .prepare(
      `INSERT INTO rules (name, stage, priority, active, mode, stop_processing, created_at${extra ? ", auto_commit" : ""})
       VALUES ('Regra', 'default', 100, 1, 'auto', 1, 'agora'${extra ? `, ${extra}` : ""})`
    )
    .run();

describe("migração 023: regra que grava sozinha", () => {
  it("regra existente (ou criada sem dizer) continua 'categoria automática'", () => {
    const db = createTestDatabase();
    const id = Number(insertRule(db).lastInsertRowid);
    const row = db.raw.prepare("SELECT auto_commit AS autoCommit FROM rules WHERE id = ?").get(id);
    expect(row).toEqual({ autoCommit: 0 });
  });

  it("aceita 'sempre automático' e recusa valor fora de 0/1", () => {
    const db = createTestDatabase();
    const id = Number(insertRule(db, "1").lastInsertRowid);
    expect(db.raw.prepare("SELECT auto_commit AS autoCommit FROM rules WHERE id = ?").get(id)).toEqual({
      autoCommit: 1
    });
    expect(() => insertRule(db, "2")).toThrow(/CHECK/i);
  });
});
