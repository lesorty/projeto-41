import type { Migration } from "./runner.js";

/**
 * Um degrau a mais de automacao nas regras de destinatario.
 *
 * Ate aqui "sempre automatico" so deixava a linha pronta: categoria e local
 * vinham preenchidos, mas o lancamento so entrava no livro depois do usuario
 * confirmar em "Importar prontos". Agora sao dois niveis:
 *
 * - `auto_commit = 0` (o que toda regra existente tem): "categoria automatica",
 *   a linha nasce pronta e espera a confirmacao do lote;
 * - `auto_commit = 1`: "sempre automatico", a linha nasce ja gravada no livro,
 *   confirmada, sem passar por popup nem por "Importar prontos".
 *
 * So `ADD COLUMN`: ampliar o `CHECK(mode IN ('auto','ask'))` exigiria
 * `rebuildTable` da `rules`, referenciada por condicoes e acoes. O nivel novo so
 * faz sentido com `mode = 'auto'`; quem grava a regra garante isso.
 */
export const migration023RuleAutoCommit: Migration = {
  version: 23,
  name: "rule-auto-commit",
  up: (db) => {
    db.exec(`
      ALTER TABLE rules ADD COLUMN auto_commit INTEGER NOT NULL DEFAULT 0
        CHECK (auto_commit IN (0, 1));
    `);
  }
};
