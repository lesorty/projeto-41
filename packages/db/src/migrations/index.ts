import { migration001Baseline } from "./001-baseline.js";
import { migration002LedgerCore } from "./002-ledger-core.js";
import { migration003BudgetTargets } from "./003-budget-targets.js";
import { migration004CreditCard } from "./004-credit-card.js";
import { migration005InvestmentLink } from "./005-investment-link.js";
import { migration006GoalsCdi } from "./006-goals-cdi.js";
import { migration007ImportRules } from "./007-import-rules.js";
import { migration008BudgetShareDiscounts } from "./008-budget-share-discounts.js";
import type { Migration } from "./runner.js";

/**
 * Ordem é a da lista. `runMigrations` valida sequência e duplicatas, então uma
 * migração nova sempre entra no fim com a próxima versão livre.
 */
export const migrations: Migration[] = [
  migration001Baseline,
  migration002LedgerCore,
  migration003BudgetTargets,
  migration004CreditCard,
  migration005InvestmentLink,
  migration006GoalsCdi,
  migration007ImportRules,
  migration008BudgetShareDiscounts
];

export * from "./runner.js";
