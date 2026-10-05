import { createHash } from "node:crypto";
import type { MatchReason } from "@projeto41/contracts";
import { normalizeName } from "@projeto41/finance";

/**
 * Escada de deduplicacao da secao 6.7, como funcao pura sobre memoria.
 *
 * Nao confundir com a tabela `imports` (fingerprint de arquivo inteiro), que
 * serve ao importador da planilha e nao tem nada a ver com isto.
 */

/**
 * Hash de conteudo: so o que o arquivo traz e nunca muda.
 *
 * **Nunca** incluir id resolvido de local, categoria ou pessoa. E o bug #4124
 * do Firefly III: o hash carregava um id que ainda nao existia na primeira
 * importacao, e a mesma linha entrava duas vezes.
 */
export function contentHash(
  accountId: number,
  date: string,
  amountCents: number,
  rawDescription: string
): string {
  return createHash("sha256")
    .update(`${accountId}|${date}|${amountCents}|${normalizeName(rawDescription)}`)
    .digest("hex");
}

export type DedupeRow = {
  key: number;
  date: string;
  amountCents: number;
  externalId: string | null;
  contentHash: string;
};

export type DedupeCandidate = {
  id: number;
  date: string;
  amountCents: number;
  externalId: string | null;
  contentHash: string | null;
};

export type DedupeMatch = { entryId: number; reason: MatchReason };

/**
 * Janela do degrau aproximado: **o mesmo dia**. Mesmo valor dias depois e,
 * na pratica, outra compra (o almoco de R$ 20 se repete toda semana); pedir
 * para o usuario desmentir isso a cada importacao era ruido. Decisao do
 * usuario, contra os ±7 dias da secao 6.7 do plano.
 */
export const FUZZY_WINDOW_DAYS = 0;

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Para cada linha, o lancamento que ela repete e qual degrau decidiu.
 *
 * - Os degraus exatos (id do banco, depois hash) rodam para o lote inteiro
 *   antes da aproximacao: uma linha que tem par exato nao pode perder esse
 *   par para a aproximacao de outra linha.
 * - Contagem por multiconjunto: cada lancamento serve de par para uma linha so.
 *   Tres estacionamentos iguais contra um no livro dao uma duplicata e duas
 *   linhas novas.
 * - Dois lados com id do banco **diferentes** nunca casam por aproximacao: ids
 *   diferentes sao prova de transacoes diferentes.
 */
export function findDuplicates(
  rows: DedupeRow[],
  candidates: DedupeCandidate[]
): Map<number, DedupeMatch> {
  const result = new Map<number, DedupeMatch>();
  const used = new Set<number>();

  const take = (row: DedupeRow, pick: (candidate: DedupeCandidate) => boolean, reason: MatchReason) => {
    const hit = candidates.find((candidate) => !used.has(candidate.id) && pick(candidate));
    if (!hit) return false;
    used.add(hit.id);
    result.set(row.key, { entryId: hit.id, reason });
    return true;
  };

  for (const row of rows) {
    if (row.externalId && take(row, (c) => c.externalId === row.externalId, "external_id")) continue;
    take(row, (c) => c.contentHash === row.contentHash, "content_hash");
  }

  for (const row of rows) {
    if (result.has(row.key)) continue;
    const near = candidates
      .filter(
        (c) =>
          !used.has(c.id) &&
          c.amountCents === row.amountCents &&
          dayDistance(c.date, row.date) <= FUZZY_WINDOW_DAYS &&
          !(row.externalId && c.externalId && row.externalId !== c.externalId)
      )
      // O mais perto na data primeiro: e o par mais provavel.
      .sort((a, b) => dayDistance(a.date, row.date) - dayDistance(b.date, row.date) || a.id - b.id);
    const hit = near[0];
    if (hit) {
      used.add(hit.id);
      result.set(row.key, { entryId: hit.id, reason: "fuzzy_amount_date" });
    }
  }

  return result;
}
