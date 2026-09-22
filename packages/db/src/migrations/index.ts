import { migration001Baseline } from "./001-baseline.js";
import { migration002LedgerCore } from "./002-ledger-core.js";
import type { Migration } from "./runner.js";

/**
 * Ordem é a da lista. `runMigrations` valida sequência e duplicatas, então uma
 * migração nova sempre entra no fim com a próxima versão livre.
 */
export const migrations: Migration[] = [migration001Baseline, migration002LedgerCore];

export * from "./runner.js";
