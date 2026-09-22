import type Database from "better-sqlite3";

export type Db = Database.Database;

/** SQLite nao tem booleano: grava 0/1 e o contrato usa `boolean`. */
export const toBit = (value: boolean | undefined, fallback: boolean): number =>
  (value ?? fallback) ? 1 : 0;

export const fromBit = (value: number): boolean => value === 1;

export const nowIso = () => new Date().toISOString();

/** Hoje em `YYYY-MM-DD`, no fuso local — o livro nao tem hora. */
export function today(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Erro de dominio que o error handler do Fastify traduz em resposta 4xx.
 * Mensagens em portugues sem acento, como no resto de `apps/api`.
 */
export class LedgerError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "LedgerError";
    this.statusCode = statusCode;
  }
}

export const notFound = (what: string) => new LedgerError(`${what} nao encontrado`, 404);

/**
 * Conta quantos lancamentos referenciam uma linha de cadastro. Cadastro em uso
 * so pode ser arquivado; excluir apagaria historico (Task 3 da fase 1).
 */
export function countReferencing(db: Db, sql: string, id: number): number {
  return (db.prepare(sql).get(id) as { n: number }).n;
}
