import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@projeto41/db";
import { buildDashboard } from "./portfolio-service.js";

let db: AppDatabase | undefined;
afterEach(() => db?.close());

describe("buildDashboard", () => {
  it("consolidates crypto, B3 and manual positions in BRL", () => {
    db = createDatabase(":memory:");
    db.operations.create({
      portfolio: "crypto",
      type: "buy",
      asset: "BTC",
      date: "2026-01-01",
      quantity: 1,
      total: 50_000,
      currency: "USD"
    });
    db.prices.upsert({
      symbol: "BTC",
      price: 60_000,
      currency: "USD",
      provider: "test",
      marketTime: null,
      fetchedAt: "2026-06-09T00:00:00Z",
      error: null
    });
    db.prices.upsert({
      symbol: "USDBRL",
      price: 5,
      currency: "BRL",
      provider: "test",
      marketTime: null,
      fetchedAt: "2026-06-09T00:00:00Z",
      error: null
    });
    db.positions.upsert({
      category: "cash",
      name: "Conta",
      invested: 1000,
      currentValue: 1000,
      currency: "BRL"
    });

    const dashboard = buildDashboard(db);
    expect(dashboard.totalBrl).toBe(301_000);
    expect(dashboard.categories.crypto).toBe(300_000);
    expect(dashboard.categories.cash).toBe(1000);
  });

  it("calculates annual return from the first snapshot of the year", () => {
    db = createDatabase(":memory:");
    db.positions.upsert({
      category: "cash",
      name: "Conta",
      invested: 110,
      currentValue: 110,
      currency: "BRL"
    });
    // Base do ano gravada em v2: a comparação é entre grandezas iguais.
    db.snapshots.upsert({
      date: "2026-01-01",
      totalBrl: 100,
      payload: { version: 2, classes: { cash: 100 }, totals: { investments: 100, bank: 0, liabilities: 0 } }
    });
    db.snapshots.upsert({
      date: "2026-03-01",
      totalBrl: 108,
      payload: { version: 2, classes: { cash: 108 }, totals: { investments: 108, bank: 0, liabilities: 0 } }
    });
    db.contributions.create({
      date: "2026-02-01",
      amount: 20
    });

    const dashboard = buildDashboard(db, new Date("2026-06-14T12:00:00-03:00"));

    expect(dashboard.annualReturn).toBeCloseTo(-0.1);
  });

  it("returns null when the year's base snapshot predates cash control", () => {
    const db = createDatabase(":memory:");
    db.positions.upsert({
      category: "cash",
      name: "Conta",
      invested: 110,
      currentValue: 110,
      currency: "BRL"
    });
    // Payload plano = v1: só investimentos, sem caixa. Comparar o total de hoje
    // (v2) contra ele seria comparar grandezas diferentes.
    db.snapshots.upsert({ date: "2026-01-01", totalBrl: 100, payload: { cash: 100 } });

    const dashboard = buildDashboard(db, new Date("2026-06-14T12:00:00-03:00"));
    expect(dashboard.annualReturn).toBeNull();
  });
});
