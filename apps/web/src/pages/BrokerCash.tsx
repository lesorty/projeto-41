import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Landmark,
  Save,
  ShoppingCart,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Dashboard, EntryRecord } from "@projeto41/contracts";
import { CashTransferDrawer } from "../components/CashTransferDrawer.js";
import { EntryTable } from "../components/finance/EntryTable.js";
import { Button, Field, Loading, Panel, SectionHeading, Segmented, Tag } from "../components/ui.js";
import { api } from "../lib/api.js";
import { isFundingAccount, useBrokerCash, type CashSettings, type Portfolio } from "../lib/cash.js";
import { money, moneyFromCents } from "../lib/format.js";
import { ledgerApi } from "../lib/ledger.js";
import { useToast } from "../lib/toast.js";

/**
 * Em caixa: o dinheiro que já saiu do banco e ainda não virou ativo.
 *
 * É a ponte entre os dois módulos. Das finanças o dinheiro chega por aporte;
 * daqui ele é alocado numa compra; a venda devolve para cá, e o resgate leva
 * de volta ao banco. A configuração de como as operações pagam mora aqui
 * também, perto de quem ela afeta.
 */

type PayMode = "broker" | "bank" | "none";

const PORTFOLIO_LABEL: Record<Portfolio, string> = { crypto: "Cripto", b3: "Bolsa B3" };

export function BrokerCashPage({
  dashboard,
  onChanged,
  onAllocate
}: {
  dashboard: Dashboard | null;
  onChanged: () => Promise<void> | void;
  /** Abre a carteira com a compra pronta, pagando com o caixa. */
  onAllocate: (portfolio: Portfolio) => void;
}) {
  const toast = useToast();
  const { settings, accounts, brokers, loading, reload } = useBrokerCash();
  const [moves, setMoves] = useState<EntryRecord[]>([]);
  const [transfer, setTransfer] = useState<{
    direction: "deposit" | "withdraw";
    portfolio: Portfolio;
  } | null>(null);

  const brokerIds = brokers.map((broker) => broker.account?.id).filter((id): id is number => id != null);
  const brokerKey = brokerIds.join(",");

  const loadMoves = useCallback(async () => {
    const ids = brokerKey ? brokerKey.split(",").map(Number) : [];
    const pages = await Promise.all(
      ids.map((accountId) => ledgerApi.entries({ accountId, page: 1, pageSize: 30 }))
    );
    setMoves(
      pages
        .flatMap((page) => page.rows)
        .sort((a, b) => (a.date === b.date ? b.id - a.id : b.date.localeCompare(a.date)))
        .slice(0, 30)
    );
  }, [brokerKey]);

  useEffect(() => {
    void loadMoves().catch(() => setMoves([]));
  }, [loadMoves]);

  const refresh = async () => {
    await Promise.all([reload(), loadMoves(), onChanged()]);
  };

  if (loading || !settings) return <Loading />;

  const banks = accounts.filter(isFundingAccount);
  const bankCents = banks
    .filter((account) => account.includeInNetWorth)
    .reduce((sum, account) => sum + account.currentBalanceCents, 0);
  const cashCents = brokers.reduce((sum, broker) => sum + (broker.account?.currentBalanceCents ?? 0), 0);
  const portfolioBrl = (dashboard?.investmentsBrl ?? 0) - (dashboard?.brokerCashBrl ?? 0);
  const active = transfer ? brokers.find((broker) => broker.portfolio === transfer.portfolio)?.account : null;

  return (
    <>
      <SectionHeading
        title="Em caixa"
        subtitle="Dinheiro que já saiu do banco e espera ser alocado"
      />

      {/* O caminho do dinheiro, com os três saldos: é a explicação da tela. */}
      <Panel>
        <div className="cash-flow" aria-label="Caminho do dinheiro">
          <div className="cash-flow-node">
            <Landmark size={18} aria-hidden />
            <span>Contas bancárias</span>
            <strong>{moneyFromCents(bankCents)}</strong>
          </div>
          <div className="cash-flow-arrow">
            <small>aporte</small>
            <ArrowRight size={18} aria-hidden />
            <small>resgate</small>
          </div>
          <div className="cash-flow-node highlight">
            <Wallet size={18} aria-hidden />
            <span>Em caixa</span>
            <strong>{moneyFromCents(cashCents)}</strong>
          </div>
          <div className="cash-flow-arrow">
            <small>compra</small>
            <ArrowRight size={18} aria-hidden />
            <small>venda</small>
          </div>
          <div className="cash-flow-node">
            <ShoppingCart size={18} aria-hidden />
            <span>Carteira</span>
            <strong>{money(portfolioBrl)}</strong>
          </div>
        </div>
      </Panel>

      <div className="cash-brokers">
        {brokers.map(({ portfolio, account }) => (
          <Panel
            key={portfolio}
            title={
              <span className="fin-inline">
                {account?.name ?? "Sem corretora"}
                <Tag tone="info">{PORTFOLIO_LABEL[portfolio]}</Tag>
              </span>
            }
            subtitle="Disponível para comprar"
          >
            {account ? (
              <>
                <strong className={`cash-broker-value ${account.currentBalanceCents < 0 ? "fin-negative" : ""}`}>
                  {moneyFromCents(account.currentBalanceCents)}
                </strong>
                {account.currentBalanceCents < 0 && (
                  <p className="fin-negative">
                    Caixa negativo: houve compra sem aporte. Aporte a diferença para zerar.
                  </p>
                )}
                <div className="cash-broker-actions">
                  <Button
                    icon={ArrowDownToLine}
                    onClick={() => setTransfer({ direction: "deposit", portfolio })}
                    disabled={banks.length === 0}
                  >
                    Aportar
                  </Button>
                  <Button
                    variant="ghost"
                    icon={ArrowUpFromLine}
                    onClick={() => setTransfer({ direction: "withdraw", portfolio })}
                    disabled={banks.length === 0}
                  >
                    Resgatar
                  </Button>
                  <Button variant="soft" icon={ShoppingCart} onClick={() => onAllocate(portfolio)}>
                    Alocar
                  </Button>
                </div>
              </>
            ) : (
              <p className="fin-muted">Escolha a conta de corretora desta carteira abaixo.</p>
            )}
          </Panel>
        ))}
      </div>

      <Panel title="Movimentações do caixa" subtitle="Aportes, compras, vendas e resgates">
        <EntryTable
          rows={moves}
          emptyText="Nada entrou nem saiu do caixa ainda. Comece por um aporte."
          onSelect={(entry) =>
            toast.notify(
              entry.kind === "adjustment"
                ? "Compra e venda se editam pela operação, na carteira"
                : "Aporte e resgate se editam em Finanças › Transações"
            )
          }
        />
      </Panel>

      <PaymentSettings
        settings={settings}
        banks={banks}
        brokerAccounts={accounts.filter((account) => account.kind === "investment")}
        onSaved={refresh}
      />

      {transfer && active && (
        <CashTransferDrawer
          direction={transfer.direction}
          broker={active}
          banks={banks}
          onClose={() => setTransfer(null)}
          onDone={async () => {
            setTransfer(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

/**
 * Como uma compra paga por padrão. Antes eram uma caixa de seleção e uma conta
 * soltas ("movimentar o caixa", "conta padrão"); agora é uma escolha só, com
 * a consequência escrita embaixo.
 */
function PaymentSettings({
  settings,
  banks,
  brokerAccounts,
  onSaved
}: {
  settings: CashSettings;
  banks: { id: number; name: string }[];
  brokerAccounts: { id: number; name: string }[];
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(settings), [settings]);

  const mode: PayMode = !draft.autoDebit ? "none" : draft.defaultAccountId == null ? "broker" : "bank";
  const setMode = (next: PayMode) =>
    setDraft((current) => ({
      ...current,
      autoDebit: next !== "none",
      defaultAccountId: next === "bank" ? (current.defaultAccountId ?? banks[0]?.id ?? null) : null
    }));

  const explanation: Record<PayMode, string> = {
    broker:
      "Compras saem do caixa da corretora e vendas voltam para ele. Você aporta quando quiser e aloca aos poucos.",
    bank:
      "Cada compra faz um aporte automático da conta escolhida, e cada venda um resgate: o caixa não acumula nada.",
    none: "Operações ficam só registradas na carteira, sem mexer em nenhuma conta. Bom para lançar histórico."
  };

  async function save() {
    setSaving(true);
    try {
      await api("/investments/cash-settings", { method: "PUT", body: JSON.stringify(draft) });
      toast.notify("Configuração salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Como as operações pagam"
      subtitle="Vale como padrão; cada compra ou venda ainda pode escolher outra coisa"
      action={
        <Button icon={Save} variant="ghost" onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      }
    >
      <div className="stack">
        <Segmented<PayMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "broker", label: "Caixa da corretora" },
            { value: "bank", label: "Aporte automático" },
            { value: "none", label: "Só registrar" }
          ]}
        />
        <p className="fin-muted">{explanation[mode]}</p>

        {mode === "bank" && (
          <Field label="Conta do aporte automático">
            <select
              value={draft.defaultAccountId ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, defaultAccountId: Number(event.target.value) }))
              }
            >
              {banks.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="field-row">
          <Field label="Corretora da carteira cripto">
            <select
              value={draft.cryptoAccountId ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, cryptoAccountId: Number(event.target.value) }))
              }
            >
              {brokerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Corretora da Bolsa B3">
            <select
              value={draft.b3AccountId ?? ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, b3AccountId: Number(event.target.value) }))
              }
            >
              {brokerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    </Panel>
  );
}
