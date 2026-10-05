import { Pencil, Plus, Save } from "lucide-react";
import { useState } from "react";
import type { InvestmentAccount } from "@projeto41/contracts";
import { Modal } from "./dialog.js";
import { Dropdown } from "./forms.js";
import { Button, Field, IconButton } from "./ui.js";
import { api } from "../lib/api.js";
import { useToast } from "../lib/toast.js";

/**
 * Seletor da conta do módulo de investimentos, no menu lateral.
 *
 * Cada conta tem os próprios registros: operações, caixas e renda fixa,
 * aportes, metas de alocação, planejamento e histórico. Trocar de conta troca
 * tudo isso de uma vez.
 */
export function InvestmentAccountSwitch({
  accounts,
  value,
  onChange,
  onSaved
}: {
  accounts: InvestmentAccount[];
  value: number;
  onChange: (id: number) => void;
  /** Depois de criar (já com a conta nova escolhida) ou renomear. */
  onSaved: (account: InvestmentAccount, created: boolean) => void;
}) {
  const [editing, setEditing] = useState<InvestmentAccount | "new" | null>(null);
  const current = accounts.find((account) => account.id === value);

  return (
    <div className="account-switch">
      <span className="nav-group-label">Conta</span>
      <div className="account-switch-row">
        <Dropdown<number>
          value={value}
          onChange={(next) => next != null && onChange(next)}
          options={accounts.map((account) => ({ value: account.id, label: account.name }))}
          aria-label="Conta de investimento"
        />
        {current && (
          <IconButton icon={Pencil} label="Renomear conta" onClick={() => setEditing(current)} />
        )}
        <IconButton icon={Plus} label="Nova conta" onClick={() => setEditing("new")} />
      </div>
      {editing && (
        <AccountNameModal
          account={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(account) => {
            setEditing(null);
            onSaved(account, editing === "new");
          }}
        />
      )}
    </div>
  );
}

function AccountNameModal({
  account,
  onClose,
  onSaved
}: {
  account: InvestmentAccount | null;
  onClose: () => void;
  onSaved: (account: InvestmentAccount) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.notify("Dê um nome à conta", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await api<InvestmentAccount>(
        account ? `/investment-accounts/${account.id}` : "/investment-accounts",
        { method: account ? "PUT" : "POST", body: JSON.stringify({ name: name.trim() }) }
      );
      toast.notify(account ? "Conta renomeada" : "Conta criada");
      onSaved(saved);
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={account ? "Renomear conta" : "Nova conta de investimento"} onClose={onClose} width={420}>
      <form className="stack" onSubmit={submit}>
        <Field
          label="Nome"
          hint={
            account
              ? undefined
              : "Começa vazia, com as metas de alocação da Principal: operações, caixas e aportes são só dela."
          }
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Corretora XP, Bianca"
            maxLength={60}
            autoFocus
          />
        </Field>
        <div className="dialog-actions">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" disabled={saving}>
            {saving ? "Salvando…" : account ? "Salvar" : "Criar conta"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
