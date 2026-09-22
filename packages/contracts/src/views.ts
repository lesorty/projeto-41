import type { Contribution, ManualPosition, Operation } from "./index.js";

/**
 * Formatos de resposta que o servidor monta e o frontend so le.
 *
 * Nao sao schemas Zod porque nada os valida na entrada: eles existem para que
 * `apps/web` pare de manter uma copia manual dos tipos (D28). O frontend importa
 * daqui apenas com `import type`, para o Zod continuar fora do bundle.
 */

export type Price = {
  symbol: string;
  price: number;
  currency: string;
  provider: string;
  fetchedAt: string;
  error: string | null;
};

export type Asset = {
  asset: string;
  quantity: number;
  invested: number;
  averagePrice: number;
  soldValue: number;
  marketValue: number;
  marketValueBrl: number;
  currentReturn: number;
  totalReturn: number;
  dividends: number;
  price: number;
  priceCurrency: string;
  priceStatus: string;
  priceFetchedAt: string | null;
  dayChange: number | null;
};

export type Snapshot = {
  date: string;
  totalBrl: number;
  payload: Record<string, number>;
};

export type Dashboard = {
  totalBrl: number;
  totalUsd: number;
  usdBrl: number;
  categories: Record<string, number>;
  annualContributions: number;
  annualReturn: number;
  history: Snapshot[];
  prices: Price[];
  portfolios: { crypto: Asset[]; b3: Asset[] };
  reserveBrl: number;
  updatedAt: string;
};

/**
 * Linhas ja gravadas trazem `id`. Os schemas de entrada deixam `id` opcional
 * porque na criacao ele ainda nao existe; estes apelidos evitam espalhar
 * `id!` pelo frontend.
 */
export type OperationRecord = Operation & { id: number };
export type ManualPositionRecord = ManualPosition & { id: number };
export type ContributionRecord = Contribution & { id: number };

export type CryptoSearchResult = {
  id: string;
  symbol: string;
  name: string;
  rank: number | null;
};

export type B3SearchResult = {
  symbol: string;
  name: string;
  price: number;
  currency: string;
};

export type AllocationTarget = { category: string; weight: number };

export type PlanningForm = {
  initialCapital: number;
  monthlyContribution: number;
  monthlyReturnPercent: number;
  months: number;
  annualInflationPercent: number;
  initialYear: number;
};
