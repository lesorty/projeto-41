import { Field } from "./ui.js";
import { money, moneyFromCents } from "../lib/format.js";
import { brokerIdOf, isFundingAccount, type Portfolio, useBrokerCash } from "../lib/cash.js";

/**
 * De onde sai o dinheiro de uma compra (ou para onde vai o de uma venda).
 *
 * Três respostas, na ordem em que costumam ser usadas:
 *
 * 1. **Caixa da corretora** — o dinheiro que já foi aportado e espera ser
 *    alocado. É o caminho natural: aporta uma vez, compra várias.
 * 2. **Uma conta bancária** — aporte (ou resgate) automático: o valor passa
 *    pelo caixa na mesma hora, sem sobrar nada nele.
 * 3. **Não movimentar** — a operação vira só registro, sem tocar em conta.
 *
 * A linha de baixo diz, em reais, o que vai acontecer antes de salvar.
 */
export function CashSourceSelect({
  portfolio,
  type,
  value,
  onChange,
  amountBrl,
  conversion
}: {
  portfolio: Portfolio;
  type: "buy" | "sell";
  value: number | null;
  onChange: (value: number | null) => void;
  /** Valor da operação em BRL, para dizer se o caixa cobre. */
  amountBrl: number;
  /** Detalhe da conversão de moeda, quando há. */
  conversion?: string;
}) {
  const { settings, accounts } = useBrokerCash();
  const brokerId = settings ? brokerIdOf(settings, portfolio) : null;
  const broker = accounts.find((account) => account.id === brokerId) ?? null;
  const banks = accounts.filter(isFundingAccount);
  const chosen = accounts.find((account) => account.id === value) ?? null;
  const buying = type === "buy";

  const brokerCash = (broker?.currentBalanceCents ?? 0) / 100;
  const after = buying ? brokerCash - amountBrl : brokerCash + amountBrl;

  let hint: string;
  let tone = "";
  if (value == null) {
    hint = "Só registra a operação: nenhuma conta é movimentada.";
  } else if (broker && value === broker.id) {
    if (buying && after < -0.005) {
      tone = "fin-negative";
      hint = `O caixa tem ${money(brokerCash)}: faltam ${money(-after)}. Aporte antes ou pague por uma conta.`;
    } else {
      hint = buying
        ? `Sai do caixa da corretora. Ficam ${money(after)} em caixa.`
        : `O valor fica em caixa para realocar: ${money(after)} depois da venda.`;
    }
  } else {
    hint = buying
      ? `Aporte automático: ${money(amountBrl)} sai de ${chosen?.name ?? "da conta"}, passa pelo caixa e vira ativo.`
      : `Resgate automático: ${money(amountBrl)} volta para ${chosen?.name ?? "a conta"}.`;
  }

  return (
    <Field
      label={buying ? "Pagar com" : "Receber em"}
      hint={
        <span className={tone}>
          {hint}
          {conversion && value != null ? ` · ${conversion}` : ""}
        </span>
      }
    >
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      >
        {broker && (
          <optgroup label="Investimentos">
            <option value={broker.id}>
              Caixa da corretora ({broker.name}) · {moneyFromCents(broker.currentBalanceCents)}
            </option>
          </optgroup>
        )}
        {banks.length > 0 && (
          <optgroup label={buying ? "Aporte automático de" : "Resgate automático para"}>
            {banks.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {moneyFromCents(account.currentBalanceCents)}
              </option>
            ))}
          </optgroup>
        )}
        <option value="">Não movimentar dinheiro</option>
      </select>
    </Field>
  );
}
