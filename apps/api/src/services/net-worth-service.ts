import type { AppDatabase } from "@projeto41/db";
import { fromCents } from "@projeto41/finance";
import { buildPortfolios } from "./portfolio-service.js";

/**
 * Patrimônio unificado: contas, caixinhas, vale-refeição e investimentos, menos
 * a dívida de cartão.
 *
 * **Namespace das classes novas.** O app já tem dois vocabulários rivais: as
 * chaves inglesas do dashboard (`crypto`, `b3`, `dollar`, `cash`, `reserve`,
 * `fixed_income`, `global`) e os apelidos portugueses das metas de alocação
 * (`bitcoin`, `caixa_br`, `renda_fixa`…). As classes desta fase levam o prefixo
 * `ledger:`, com dois-pontos: nenhuma chave existente contém `:`, o que torna a
 * colisão impossível por construção. Categorias de despesa nunca aparecem como
 * chave de classe — elas são identificadas por id numérico e vivem em outro
 * agregado.
 *
 * **Esta é a fronteira entre centavos e `REAL`.** O livro devolve centavos por
 * `SUM` (D24) e é aqui, ao montar cada classe, que se aplica `fromCents`. Do
 * serviço para fora — dashboard, snapshot, gráfico, tela — tudo é `REAL` em BRL,
 * como sempre foi.
 */

export const LEDGER_CLASSES = [
  "ledger:bank",
  "ledger:cash",
  "ledger:voucher",
  "ledger:goals",
  "ledger:credit_card"
] as const;

export type NetWorth = {
  schemaVersion: 2;
  classes: Record<string, number>;
  investmentsBrl: number;
  bankBrl: number;
  liabilitiesBrl: number;
  totalBrl: number;
  bankOnlyBrl: number;
  /** Só o módulo de investimentos, líquido da reserva: base dos pesos da carteira. */
  investableBrl: number;
  cashControlStartedOn: string | null;
  doubleCounting: {
    active: boolean;
    manualPositions: { id: number; name: string; category: string; currentValue: number }[];
    ledgerBalanceBrl: number;
  };
};

export function buildNetWorth(db: AppDatabase, now = new Date()): NetWorth {
  void now;
  const portfolios = buildPortfolios(db);
  const usdBrl = db.prices.get("USDBRL")?.price ?? 0;

  // As sete classes antigas, calculadas exatamente como sempre foram.
  const classes: Record<string, number> = {
    crypto: portfolios.crypto.reduce((sum, asset) => sum + asset.marketValueBrl, 0),
    b3: portfolios.b3.reduce((sum, asset) => sum + asset.marketValueBrl, 0),
    dollar: 0,
    cash: 0,
    reserve: 0,
    fixed_income: 0,
    global: 0
  };
  const manualPositions = db.positions.list();
  for (const position of manualPositions) {
    classes[position.category] =
      (classes[position.category] ?? 0) +
      position.currentValue * (position.currency === "USD" ? usdBrl : 1);
  }
  const investmentsBrl = Object.values(classes).reduce((sum, value) => sum + value, 0);

  // As classes do livro. `kind='investment'` é descartada incondicionalmente,
  // mesmo com `include_in_net_worth = 1`: o mesmo dinheiro já aparece como
  // valor de mercado das carteiras, e somar as duas pontas contaria duas vezes.
  const byKind = db.ledger.balances.byKind();
  const debt = db.ledger.balances.creditCardDebt();

  classes["ledger:bank"] = fromCents((byKind.checking ?? 0) + (byKind.savings ?? 0));
  classes["ledger:cash"] = fromCents(byKind.cash ?? 0);
  classes["ledger:voucher"] = fromCents(byKind.meal_voucher ?? 0);
  // A classe das caixinhas nasce aqui valendo zero; a fase 5 a preenche.
  classes["ledger:goals"] = fromCents(byKind.goal ?? 0);
  // A dívida reduz o patrimônio. A alternativa é pior: sem passivo, o
  // patrimônio ficaria inflado o mês inteiro e desabaria no dia do pagamento,
  // sem nenhum evento econômico correspondente — o dinheiro já saiu na compra.
  // Usa o TOTAL DEVIDO (6.1), não só a fatura corrente.
  classes["ledger:credit_card"] = -fromCents(debt.totalOwedCents);

  const bankOnlyBrl = LEDGER_CLASSES.reduce((sum, key) => sum + (classes[key] ?? 0), 0);
  const bankBrl = LEDGER_CLASSES.reduce(
    (sum, key) => sum + Math.max(classes[key] ?? 0, 0),
    0
  );
  const liabilitiesBrl = Math.abs(classes["ledger:credit_card"] ?? 0);
  const totalBrl = Object.values(classes).reduce((sum, value) => sum + value, 0);

  // R-07: posições manuais de caixa/reserva convivendo com contas do livro
  // podem estar contando o mesmo dinheiro duas vezes (D17).
  const suspicious = manualPositions.filter(
    (position) =>
      (position.category === "cash" || position.category === "reserve") &&
      position.currentValue > 0
  );
  const ledgerBalanceBrl = fromCents(
    (byKind.checking ?? 0) + (byKind.savings ?? 0) + (byKind.cash ?? 0)
  );

  return {
    schemaVersion: 2,
    classes,
    investmentsBrl,
    bankBrl,
    liabilitiesBrl,
    totalBrl,
    bankOnlyBrl,
    investableBrl: investmentsBrl - (classes.reserve ?? 0),
    cashControlStartedOn: db.settings.get("networth.cash_started_on") ?? null,
    doubleCounting: {
      active: suspicious.length > 0 && ledgerBalanceBrl !== 0,
      manualPositions: suspicious.map((position) => ({
        id: position.id!,
        name: position.name,
        category: position.category,
        currentValue: position.currentValue
      })),
      ledgerBalanceBrl
    }
  };
}

/**
 * Marca o dia em que o controle de caixa começou, uma única vez (D14).
 *
 * É esta data que vira o degrau no gráfico de histórico. Nada é recalculado
 * retroativamente: o passado não tinha caixa e continuará não tendo.
 */
export function markCashControlStart(db: AppDatabase, date: string, netWorth: NetWorth) {
  if (db.settings.get("networth.cash_started_on")) return;
  const hasCash = LEDGER_CLASSES.some((key) => (netWorth.classes[key] ?? 0) !== 0);
  if (hasCash) db.settings.set("networth.cash_started_on", date);
}
