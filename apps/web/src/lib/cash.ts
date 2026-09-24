import { useCallback, useEffect, useState } from "react";
import type { AccountRecord } from "@projeto41/contracts";
import { api } from "./api.js";

/**
 * O caixa da corretora: dinheiro que saiu do banco e espera virar ativo.
 *
 *     banco ──aporte──▶ em caixa ──compra──▶ carteira
 *     banco ◀─resgate── em caixa ◀──venda─── carteira
 *
 * Cada carteira (cripto, B3) tem a sua conta de corretora no livro, e o saldo
 * dela é o caixa. O servidor faz a contabilidade; aqui só se lê e se escolhe.
 */

export type CashSettings = {
  /** Registrar operação movimenta dinheiro. Desligado, a operação é só registro. */
  autoDebit: boolean;
  /** Nulo: pagar com o caixa da corretora. Uma conta: aporte automático dela. */
  defaultAccountId: number | null;
  cryptoAccountId: number | null;
  b3AccountId: number | null;
};

export type Portfolio = "crypto" | "b3";

export const brokerIdOf = (settings: CashSettings, portfolio: Portfolio) =>
  portfolio === "crypto" ? settings.cryptoAccountId : settings.b3AccountId;

/** Contas de onde um aporte pode sair: dinheiro de verdade, sem cartão. */
export const isFundingAccount = (account: AccountRecord) =>
  account.kind !== "credit_card" && account.kind !== "investment" && !account.archived;

export function useBrokerCash() {
  const [settings, setSettings] = useState<CashSettings | null>(null);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [nextSettings, nextAccounts] = await Promise.all([
      api<CashSettings>("/investments/cash-settings"),
      api<AccountRecord[]>("/ledger/accounts")
    ]);
    setSettings(nextSettings);
    setAccounts(nextAccounts);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload().catch(() => setLoading(false));
  }, [reload]);

  const brokers = settings
    ? (["crypto", "b3"] as const).map((portfolio) => ({
        portfolio,
        account: accounts.find((account) => account.id === brokerIdOf(settings, portfolio)) ?? null
      }))
    : [];

  return { settings, accounts, brokers, loading, reload };
}

export type AllocationGap = { category: string; targetBrl: number; actualBrl: number };

/**
 * Onde pôr o dinheiro em caixa para chegar mais perto da meta.
 *
 * Só as classes abaixo da meta recebem, e cada uma na proporção do que falta
 * para ela: se o caixa cobre todas as faltas, cada uma recebe a sua falta
 * inteira e o resto fica em caixa. O próprio caixa nunca é destino — alocar
 * caixa em caixa não move nada.
 */
export function suggestCashAllocation(
  gaps: AllocationGap[],
  cashBrl: number,
  cashCategory = "caixa_br"
): { category: string; amountBrl: number }[] {
  if (!(cashBrl > 0)) return [];
  const short = gaps
    .filter((gap) => gap.category !== cashCategory)
    .map((gap) => ({ category: gap.category, missing: gap.targetBrl - gap.actualBrl }))
    .filter((gap) => gap.missing > 0.005);
  const totalMissing = short.reduce((sum, gap) => sum + gap.missing, 0);
  if (totalMissing <= 0) return [];
  const scale = Math.min(1, cashBrl / totalMissing);
  return short
    .map((gap) => ({ category: gap.category, amountBrl: Math.round(gap.missing * scale * 100) / 100 }))
    .filter((gap) => gap.amountBrl > 0)
    .sort((a, b) => b.amountBrl - a.amountBrl);
}

/** Para qual tela vai cada classe da meta quando o usuário decide alocar. */
export function destinationOf(category: string): "crypto" | "b3" | "positions" {
  if (category === "bitcoin" || category === "shitcoins") return "crypto";
  if (category === "bolsa_brasil") return "b3";
  return "positions";
}
