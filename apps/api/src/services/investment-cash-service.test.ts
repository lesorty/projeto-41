import { createDatabase, type AppDatabase } from "@projeto41/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ReconciledLinkError,
  listOperationsWithLinks,
  readCashSettings,
  registerOperation,
  removeOperation,
  toLedgerCents,
  unlinkOperation,
  updateOperation
} from "./investment-cash-service.js";

let db: AppDatabase;
let checking: number;
let cryptoAccount: number;

const BUY = {
  portfolio: "crypto" as const,
  type: "buy" as const,
  asset: "BTC",
  date: "2026-05-10",
  quantity: 0.01,
  total: 5000,
  currency: "BRL" as const
};

function counts() {
  const one = (sql: string) => (db.raw.prepare(sql).get() as { n: number }).n;
  return {
    operations: one("SELECT COUNT(*) AS n FROM operations"),
    entries: one("SELECT COUNT(*) AS n FROM entries"),
    transfers: one("SELECT COUNT(*) AS n FROM transfers"),
    links: one("SELECT COUNT(*) AS n FROM operation_transfers")
  };
}

const balanceOf = (id: number) =>
  db.ledger.balances.forAccount(id, { asOf: "2026-06-01" })?.currentBalanceCents ?? 0;

beforeEach(() => {
  db = createDatabase(":memory:");
  checking = db.ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: db.ledger.people.list()[0]!.id,
    openingBalanceCents: 1_000_00
  });
  cryptoAccount = readCashSettings(db).cryptoAccountId!;
});

describe("compra e venda", () => {
  it("cria a operacao, a transferencia e debita o banco pelo valor exato", () => {
    const { id, transferId } = registerOperation(db, { ...BUY, accountId: checking });
    expect(transferId).not.toBeNull();
    expect(counts()).toEqual({ operations: 1, entries: 2, transfers: 1, links: 1 });

    expect(balanceOf(checking)).toBe(1_000_00 - 500_000);
    expect(balanceOf(cryptoAccount)).toBe(500_000);

    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    expect(entry.transferPurpose).toBe("investment");
    expect(entry.categoryId).toBeNull();
    expect(entry.description).toBe("Compra BTC 0,01");
    expect(db.operationLinks.get(id)?.transferId).toBe(transferId);
  });

  it("venda credita o banco de volta", () => {
    registerOperation(db, {
      ...BUY,
      type: "sell",
      total: 200,
      accountId: checking
    });
    expect(balanceOf(checking)).toBe(1_000_00 + 20_000);
  });

  it("converte USD pela cotacao e registra a cotacao na nota", () => {
    db.prices.upsert({
      symbol: "USDBRL",
      currency: "BRL",
      price: 5.4321,
      provider: "test",
      marketTime: null,
      fetchedAt: "2026-05-10T12:00:00.000Z",
      error: null
    });
    registerOperation(db, { ...BUY, currency: "USD", total: 1000, accountId: checking });

    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    // 1000 USD × 5,4321 = R$ 5.432,10
    expect(entry.amountCents).toBe(-543_210);
    expect(entry.notes).toBe("USDBRL 5,4321 em 2026-05-10");
  });

  it("recusa operacao em USD sem cotacao, sem gravar nada", () => {
    expect(() =>
      registerOperation(db, { ...BUY, currency: "USD", total: 1000, accountId: checking })
    ).toThrow(/cotacao/i);
    expect(counts()).toEqual({ operations: 0, entries: 0, transfers: 0, links: 0 });
  });

  it("com o auto-debito desligado, a operacao nasce sem nenhum lancamento", () => {
    db.settings.set("investment.auto_debit", "0");
    const { transferId } = registerOperation(db, { ...BUY, accountId: checking });
    expect(transferId).toBeNull();
    expect(counts()).toEqual({ operations: 1, entries: 0, transfers: 0, links: 0 });
  });

  it("sem conta escolhida, nao movimenta caixa", () => {
    registerOperation(db, BUY);
    expect(counts().entries).toBe(0);
  });
});

describe("edicao", () => {
  it("ajusta as duas pontas e o saldo ao mudar o total", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    updateOperation(db, id, { ...BUY, total: 3000, accountId: checking });

    expect(balanceOf(checking)).toBe(1_000_00 - 300_000);
    expect(balanceOf(cryptoAccount)).toBe(300_000);
    expect(counts().entries).toBe(2);
  });

  it("move so a ponta bancaria ao trocar de conta", () => {
    const other = db.ledger.accounts.create({
      name: "Itau",
      kind: "checking",
      color: "#f60",
      personId: db.ledger.people.list()[0]!.id,
      openingBalanceCents: 0
    });
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    updateOperation(db, id, { ...BUY, accountId: other });

    expect(balanceOf(checking)).toBe(1_000_00);
    expect(balanceOf(other)).toBe(-500_000);
    expect(balanceOf(cryptoAccount)).toBe(500_000);
  });

  it("vincula uma operacao que nasceu sem conta", () => {
    const { id } = registerOperation(db, BUY);
    expect(counts().links).toBe(0);
    updateOperation(db, id, { ...BUY, accountId: checking });
    expect(counts().links).toBe(1);
    expect(balanceOf(checking)).toBe(1_000_00 - 500_000);
  });

  it("desvincula ao tirar a conta", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    updateOperation(db, id, { ...BUY, accountId: null });
    expect(counts()).toEqual({ operations: 1, entries: 0, transfers: 0, links: 0 });
    expect(balanceOf(checking)).toBe(1_000_00);
  });
});

describe("exclusao", () => {
  it("remove operacao, vinculo, transferencia e as duas entries", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    removeOperation(db, id);
    expect(counts()).toEqual({ operations: 0, entries: 0, transfers: 0, links: 0 });
    expect(balanceOf(checking)).toBe(1_000_00);
  });

  it("recusa excluir com ponta conciliada, sem apagar NADA", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    db.ledger.entries.setStatus([entry.id], "reconciled");

    const before = counts();
    expect(() => removeOperation(db, id)).toThrow(ReconciledLinkError);
    expect(counts()).toEqual(before);
  });

  it("recusa desvincular com ponta conciliada", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    const entry = db.ledger.entries.listAll({ accountId: checking })[0]!;
    db.ledger.entries.setStatus([entry.id], "reconciled");
    expect(() => unlinkOperation(db, id)).toThrow(ReconciledLinkError);
  });

  it("desvincular mantem a operacao e devolve o saldo", () => {
    const { id } = registerOperation(db, { ...BUY, accountId: checking });
    unlinkOperation(db, id);
    expect(counts()).toEqual({ operations: 1, entries: 0, transfers: 0, links: 0 });
    expect(balanceOf(checking)).toBe(1_000_00);
    expect(db.operations.list()[0]?.accountId).toBeNull();
  });
});

describe("listagem com vinculo", () => {
  it("distingue operacao com e sem movimento de caixa", () => {
    registerOperation(db, { ...BUY, accountId: checking });
    registerOperation(db, { ...BUY, asset: "ETH", date: "2026-05-11" });

    const rows = listOperationsWithLinks(db, "crypto");
    const linked = rows.find((row) => row.asset === "BTC");
    const loose = rows.find((row) => row.asset === "ETH");
    expect(linked?.transferId).not.toBeNull();
    expect(linked?.accountName).toBe("Nubank");
    expect(loose?.transferId).toBeNull();
    expect(loose?.accountName).toBeNull();
  });
});

describe("toLedgerCents", () => {
  it("arredonda meio centavo para cima", () => {
    expect(toLedgerCents(db, { ...BUY, total: 10.005 }).cents).toBe(1001);
  });
});
