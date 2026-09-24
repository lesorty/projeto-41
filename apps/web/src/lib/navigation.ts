/**
 * Navegacao entre telas do modulo de financas.
 *
 * O app nao tem roteador: a tela ativa e um estado em `App`. Quando um card do
 * Painel leva para outra tela, ele leva junto o recorte que o usuario estava
 * olhando — o mesmo periodo e, na barra de alvo, a mesma pessoa. Chegar em
 * Gastos mostrando outro mes seria obrigar a refazer o filtro.
 */
export type LedgerPreset = {
  from?: string;
  to?: string;
  personId?: number;
  /** Na carteira: chegar com a compra aberta (o "Alocar" do caixa). */
  openTrade?: boolean;
  /** E, nessa compra, pagar com este caixa. */
  payWithPositionId?: number;
};

export type FinanceDestination = "expenses" | "income" | "transactions" | "reports";

export type FinanceNavigate = (page: FinanceDestination, preset?: LedgerPreset) => void;
