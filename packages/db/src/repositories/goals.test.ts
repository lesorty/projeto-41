import { beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "../index.js";
import type { LedgerRepositories } from "./index.js";

const TODAY = "2026-09-18";

let ledger: LedgerRepositories;
let steylor: number;
let checking: number;

beforeEach(() => {
  ledger = createDatabase(":memory:").ledger;
  steylor = ledger.people.list()[0]!.id;
  checking = ledger.accounts.create({
    name: "Nubank",
    kind: "checking",
    color: "#8a2be2",
    personId: steylor,
    openingBalanceCents: 1_000_000
  });
});

const createGoal = (overrides: Record<string, unknown> = {}) =>
  ledger.goals.create({
    name: "Viagem",
    mode: "account",
    color: "#00a86b",
    personId: steylor,
    ...overrides
  } as Parameters<typeof ledger.goals.create>[0]);

describe("criacao", () => {
  it("modo conta cria a conta 'goal' junto, na mesma transacao", () => {
    const id = createGoal();
    const goal = ledger.goals.get(id)!;
    expect(goal.accountId).not.toBeNull();
    expect(
      ledger.accounts.get(goal.accountId!, { includeArchived: true })?.kind
    ).toBe("goal");
  });

  it("recusa rendimento em caixinha de marcacao", () => {
    expect(() =>
      createGoal({ mode: "earmark", accountId: checking, cdiPercent: 110 })
    ).toThrow(/conta propria/i);
  });

  it("modo marcacao nao cria conta nenhuma", () => {
    const before = ledger.accounts.list({ includeArchived: true }).length;
    createGoal({ mode: "earmark", accountId: checking });
    expect(ledger.accounts.list({ includeArchived: true })).toHaveLength(before);
  });
});

describe("modo e imutavel", () => {
  it("update ignora mode e account_id mesmo que cheguem", () => {
    const id = createGoal();
    const before = ledger.goals.get(id)!;
    ledger.goals.update(id, {
      name: "Viagem 2027",
      color: "#00a86b",
      mode: "earmark",
      accountId: checking
    } as Parameters<typeof ledger.goals.update>[1]);

    const after = ledger.goals.get(id)!;
    expect(after.mode).toBe("account");
    expect(after.accountId).toBe(before.accountId);
    expect(after.name).toBe("Viagem 2027");
  });
});

describe("deposito e saque", () => {
  it("deposito cria transferencia goal_deposit e move as duas contas", () => {
    const id = createGoal();
    const goal = ledger.goals.get(id)!;
    ledger.goals.deposit(id, {
      amountCents: 200_000,
      date: "2026-09-01",
      fromAccountId: checking
    });

    expect(ledger.balances.forAccount(checking, { asOf: TODAY })?.currentBalanceCents).toBe(
      800_000
    );
    expect(ledger.balances.forAccount(goal.accountId!, { asOf: TODAY })?.currentBalanceCents).toBe(
      200_000
    );

    const entry = ledger.entries.listAll({ accountId: goal.accountId! })[0]!;
    expect(entry.transferPurpose).toBe("goal_deposit");
    expect(entry.categoryId).toBeNull();
  });

  it("guardar em caixinha conta no alvo; investir nao (6.4)", () => {
    const id = createGoal();
    ledger.goals.deposit(id, {
      amountCents: 200_000,
      date: "2026-09-01",
      fromAccountId: checking
    });
    ledger.entries.createTransfer({
      fromAccountId: checking,
      toAccountId: ledger.goals.get(id)!.accountId!,
      date: "2026-09-02",
      amountCents: 500_000,
      purpose: "investment"
    });

    // Só o depósito conta, e uma vez só: a ponta que sai da conta pagadora.
    const realized = ledger.reports.realizedByPerson({ from: "2026-09-01", to: "2026-09-30" });
    expect(realized[steylor]).toBe(200_000);
  });

  /**
   * Conflito entre documentos de fase, resolvido pelo plano mestre.
   *
   * O documento da fase 5 diz que depositar e sacar no mesmo período deveria
   * dar realizado líquido zero. O plano mestre 6.4 enumera o que conta e fecha
   * com "não conta: nenhuma outra transferência" — e o documento da fase 3
   * explicita que sacar da caixinha **não devolve folga ao alvo do mês**.
   *
   * O plano mestre vence por regra própria ("em caso de conflito entre um
   * documento de fase e este arquivo, este arquivo vence"), então o saque não
   * abate o realizado.
   */
  it("sacar da caixinha nao devolve folga ao alvo do mes (6.4)", () => {
    const id = createGoal();
    ledger.goals.deposit(id, {
      amountCents: 200_000,
      date: "2026-09-01",
      fromAccountId: checking
    });
    ledger.goals.withdraw(id, {
      amountCents: 200_000,
      date: "2026-09-10",
      toAccountId: checking
    });
    const realized = ledger.reports.realizedByPerson({ from: "2026-09-01", to: "2026-09-30" });
    expect(realized[steylor]).toBe(200_000);
  });

  it("recusa deposito em caixinha de marcacao", () => {
    const id = createGoal({ mode: "earmark", accountId: checking });
    expect(() =>
      ledger.goals.deposit(id, { amountCents: 100, date: "2026-09-01", fromAccountId: checking })
    ).toThrow(/conta propria/i);
  });
});

describe("marcacao", () => {
  it("recusa alocar acima do saldo da conta, sem deixar residuo", () => {
    const id = createGoal({ mode: "earmark", accountId: checking });
    const entryId = ledger.entries.create({
      accountId: checking,
      date: "2026-09-01",
      amountCents: -50_000,
      kind: "expense"
    });

    expect(() => ledger.goals.allocate(id, entryId, 2_000_000)).toThrow(/passam do saldo/i);
    // A transação inteira foi desfeita: o saldo livre é o da conta inteira,
    // sem nenhuma marcação residual.
    expect(ledger.goals.freeBalance(checking, TODAY)).toBe(950_000);
  });

  it("duas caixinhas na mesma conta respeitam o limite somadas", () => {
    const a = createGoal({ name: "A", mode: "earmark", accountId: checking });
    const b = createGoal({ name: "B", mode: "earmark", accountId: checking });
    const entryId = ledger.entries.create({
      accountId: checking,
      date: "2026-09-01",
      amountCents: -10_000,
      kind: "expense"
    });

    ledger.goals.allocate(a, entryId, 600_000);
    // Isolada caberia; somada com a outra, não.
    expect(() => ledger.goals.allocate(b, entryId, 600_000)).toThrow(/passam do saldo/i);
    expect(ledger.goals.freeBalance(checking, TODAY)).toBe(390_000);
  });

  it("saldo livre cai ao alocar e volta ao desalocar", () => {
    const id = createGoal({ mode: "earmark", accountId: checking });
    const entryId = ledger.entries.create({
      accountId: checking,
      date: "2026-09-01",
      amountCents: -10_000,
      kind: "expense"
    });
    expect(ledger.goals.freeBalance(checking, TODAY)).toBe(990_000);

    ledger.goals.allocate(id, entryId, 300_000);
    expect(ledger.goals.freeBalance(checking, TODAY)).toBe(690_000);

    ledger.goals.deallocate(id, entryId);
    expect(ledger.goals.freeBalance(checking, TODAY)).toBe(990_000);
  });
});

describe("rendimento", () => {
  /** Deposita em 16/09, que é dia útil com taxa na série semeada. */
  function goalWithDeposit(cdiPercent = 110) {
    const id = createGoal({ cdiPercent });
    ledger.goals.deposit(id, {
      amountCents: 1_000_000,
      date: "2026-09-16",
      fromAccountId: checking
    });
    return id;
  }

  it("apura o realizado e nao lanca dia projetado", () => {
    const id = goalWithDeposit();
    // 18/09 é o último dia com taxa na semente.
    const first = ledger.goals.accrue(id, "2026-09-18");
    expect(first.cents).toBeGreaterThan(0);
    expect(ledger.entries.get(first.entryId!)?.kind).toBe("income");
    expect(ledger.entries.get(first.entryId!)?.date).toBe("2026-09-18");
    expect(ledger.entries.get(first.entryId!)?.countsTowardTarget).toBe(false);
  });

  it("apurar duas vezes seguidas nao duplica rendimento", () => {
    const id = goalWithDeposit();
    const first = ledger.goals.accrue(id, "2026-09-18");
    const second = ledger.goals.accrue(id, "2026-09-18");
    expect(second.entryId).toBeNull();
    expect(second.cents).toBe(0);
    expect(
      ledger.entries.listAll({ accountId: ledger.goals.get(id)!.accountId!, kind: "income" })
    ).toHaveLength(1);
    expect(first.cents).toBeGreaterThan(0);
  });

  it("nao cria lancamento quando so ha dias projetados", () => {
    const id = goalWithDeposit();
    // 2030 está muito além da série semeada: tudo seria projeção.
    const result = ledger.goals.accrue(id, "2030-01-10");
    // O realizado até 18/09/2026 existe, mas nada além disso é lançado.
    expect(ledger.entries.get(result.entryId!)?.date).toBe("2026-09-18");

    const again = ledger.goals.accrue(id, "2030-01-11");
    expect(again.entryId).toBeNull();
  });

  it("caixinha sem cdi_percent nao rende nada", () => {
    const id = createGoal();
    ledger.goals.deposit(id, {
      amountCents: 1_000_000,
      date: "2026-09-16",
      fromAccountId: checking
    });
    expect(ledger.goals.accrue(id, "2026-09-18")).toEqual({ entryId: null, cents: 0 });
  });
});

describe("progresso", () => {
  it("separa realizado de projetado e estima o resgate", () => {
    const id = createGoal({ cdiPercent: 110, targetAmountCents: 5_000_000 });
    ledger.goals.deposit(id, {
      amountCents: 1_000_000,
      date: "2026-09-16",
      fromAccountId: checking
    });

    const progress = ledger.goals.progress(id, "2026-09-18");
    expect(progress.balanceCents).toBe(1_000_000);
    expect(progress.targetRatioPerMille).toBe(200);
    expect(progress.remainingCents).toBe(4_000_000);
    expect(progress.realizedYieldCents).toBeGreaterThan(0);
    // Aporte novo: o IOF ainda incide, e a data em que ele zera é informada.
    expect(progress.iofCents).toBeGreaterThan(0);
    expect(progress.iofFreeFrom).toBe("2026-10-16");
    expect(progress.netCents).toBeLessThan(progress.grossCents);
  });

  it("ritmo zero nao inventa data de conclusao", () => {
    const id = createGoal({ targetAmountCents: 5_000_000 });
    const progress = ledger.goals.progress(id, "2026-09-18");
    expect(progress.projection.estimatedDate).toBeNull();
    expect(progress.projection.basis).toBe("none");
  });
});

describe("exclusao", () => {
  it("arquiva quando ha movimento e apaga quando nao ha", () => {
    const empty = createGoal({ name: "Vazia" });
    expect(ledger.goals.remove(empty)).toEqual({ removed: true });
    expect(ledger.goals.get(empty)).toBeUndefined();

    const used = createGoal({ name: "Usada" });
    ledger.goals.deposit(used, {
      amountCents: 1000,
      date: "2026-09-01",
      fromAccountId: checking
    });
    expect(ledger.goals.remove(used)).toEqual({ removed: false });
    expect(ledger.goals.get(used)?.archived).toBe(true);
  });
});
