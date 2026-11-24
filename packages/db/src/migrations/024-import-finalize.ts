import type { Migration } from "./runner.js";

/**
 * "Finalizar importacao": o lote fecha do jeito que esta.
 *
 * O que ja foi importado fica no livro; o que ainda estava pendente (a revisar
 * ou pronto) fica de fora e nao entra mais por este lote. As linhas pendentes
 * nao mudam de status: "ignored" e so o que o usuario decidiu pular, e e isso
 * que a proxima importacao pula sozinha. Deixar de fora ao finalizar nao e
 * decidir sobre cada linha — um extrato novo com elas as oferece de novo.
 *
 * So `ADD COLUMN`: um status novo no `CHECK` de `import_batches` exigiria
 * reconstruir a tabela, referenciada por `import_rows`. O lote finalizado fica
 * `committed` com `finalized_at` preenchido.
 */
export const migration024ImportFinalize: Migration = {
  version: 24,
  name: "import-finalize",
  up: (db) => {
    db.exec(`ALTER TABLE import_batches ADD COLUMN finalized_at TEXT;`);
  }
};
