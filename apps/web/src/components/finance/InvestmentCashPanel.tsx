import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AccountRecord } from "@projeto41/contracts";
import { Button, Field, Panel } from "../ui.js";
import { api } from "../../lib/api.js";
import { useToast } from "../../lib/toast.js";

type CashSettings = {
  autoDebit: boolean;
  defaultAccountId: number | null;
  cryptoAccountId: number | null;
  b3AccountId: number | null;
};

/**
 * Configuração do débito automático de investimentos.
 *
 * Vive na tela de contas porque é configuração de finanças — não faz sentido
 * escondê-la numa página de ajustes separada de onde as contas são geridas.
 */
export function InvestmentCashPanel({ accounts }: { accounts: AccountRecord[] }) {
  const toast = useToast();
  const [settings, setSettings] = useState<CashSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setSettings(await api<CashSettings>("/investments/cash-settings"));
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  if (!settings) return null;

  const payable = accounts.filter(
    (account) => account.kind !== "credit_card" && account.kind !== "investment"
  );
  const brokerages = accounts.filter((account) => account.kind === "investment");

  async function save() {
    setSaving(true);
    try {
      await api("/investments/cash-settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      toast.notify("Configuração salva");
      await load();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  const patch = (next: Partial<CashSettings>) =>
    setSettings((current) => (current ? { ...current, ...next } : current));

  return (
    <Panel
      title="Débito automático de investimentos"
      subtitle="Comprar debita a conta escolhida; vender credita de volta"
      action={
        <Button icon={Save} variant="ghost" onClick={() => void save()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      }
    >
      <label className="fin-check">
        <input
          type="checkbox"
          checked={settings.autoDebit}
          onChange={(event) => patch({ autoDebit: event.target.checked })}
        />
        <span>Movimentar o caixa ao registrar uma operação</span>
      </label>

      <div className="field-row">
        <Field label="Conta padrão" hint="Vem pré-selecionada na operação.">
          <select
            value={settings.defaultAccountId ?? ""}
            onChange={(event) =>
              patch({ defaultAccountId: event.target.value ? Number(event.target.value) : null })
            }
          >
            <option value="">Escolher na hora</option>
            {payable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="field-row">
        <Field label="Destino das compras de cripto">
          <select
            value={settings.cryptoAccountId ?? ""}
            onChange={(event) =>
              patch({ cryptoAccountId: event.target.value ? Number(event.target.value) : null })
            }
          >
            {brokerages.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Destino das compras na B3">
          <select
            value={settings.b3AccountId ?? ""}
            onChange={(event) =>
              patch({ b3AccountId: event.target.value ? Number(event.target.value) : null })
            }
          >
            {brokerages.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <small className="fin-muted">
        As contas de corretora não entram no patrimônio: o mesmo dinheiro já
        aparece como valor de mercado da carteira.
      </small>
    </Panel>
  );
}
