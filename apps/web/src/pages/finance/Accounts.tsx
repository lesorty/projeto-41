import { Archive, Plus, Save, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountKind, AccountRecord, BalancesResult, PersonRecord } from "@projeto41/contracts";
import { ColorDot, ColorPicker } from "../../components/ColorPicker.js";
import { DateField } from "../../components/datepicker.js";
import { Drawer, useConfirm } from "../../components/dialog.js";
import {
  AnimatedNumber,
  Button,
  Empty,
  Field,
  IconButton,
  Loading,
  Panel,
  SectionHeading
} from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { centsToInput, debtFromCents, moneyFromCents } from "../../lib/format.js";
import { ACCOUNT_KIND_LABEL } from "../../lib/ledger.js";
import { parseCurrencyInput } from "@projeto41/finance";
import { useToast } from "../../lib/toast.js";

/**
 * Contas agrupadas por pessoa, cada uma com saldo atual e previsto vindos do
 * servidor (D24 — a tela nunca soma lancamento).
 *
 * Cartao de credito nao e criavel aqui: a fase 3 e quem traz fechamento,
 * vencimento e limite. O `CHECK` do banco ja aceita o tipo, mas a interface so
 * oferece os quatro tipos da fase 1.
 */

const KINDS: AccountKind[] = ["checking", "savings", "cash", "meal_voucher"];

type Draft = Partial<AccountRecord> & { openingBalanceText?: string };

export function AccountsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [balances, setBalances] = useState<BalancesResult | null>(null);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [nextBalances, nextPeople] = await Promise.all([
      api<BalancesResult>("/ledger/balances"),
      api<PersonRecord[]>("/ledger/people")
    ]);
    setBalances(nextBalances);
    setPeople(nextPeople);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch((error: Error) => {
      toast.notify(error.message, "error");
      setLoading(false);
    });
  }, [load, toast]);

  const groups = useMemo(() => {
    if (!balances) return [];
    const byPerson = new Map<number | null, AccountRecord[]>();
    for (const account of balances.accounts) {
      const key = account.personId ?? null;
      byPerson.set(key, [...(byPerson.get(key) ?? []), account]);
    }
    return [...byPerson.entries()].map(([personId, accounts]) => ({
      personId,
      person: people.find((entry) => entry.id === personId) ?? null,
      accounts
    }));
  }, [balances, people]);

  async function archive(account: AccountRecord) {
    const ok = await confirm({
      title: "Arquivar conta",
      message: `"${account.name}" some das listas, mas o histórico e os lançamentos continuam.`,
      confirmLabel: "Arquivar"
    });
    if (!ok) return;
    await api(`/ledger/accounts/${account.id}`, { method: "DELETE" });
    toast.notify("Conta arquivada");
    await load();
  }

  if (loading) return <Loading />;

  return (
    <>
      <SectionHeading title="Contas" subtitle="Onde o dinheiro está, por pessoa">
        <Button icon={Plus} onClick={() => setEditing({ color: "#4f8ff7", kind: "checking" })}>
          Nova conta
        </Button>
      </SectionHeading>

      <div className="fin-summary">
        <Panel title="Saldo consolidado" subtitle="Contas no patrimônio, sem cartão">
          <AnimatedNumber value={(balances?.consolidatedCents ?? 0) / 100} format={(v) => moneyFromCents(v * 100)} />
        </Panel>
        <Panel title="Saldo previsto" subtitle="Incluindo o que está pendente no mês">
          <AnimatedNumber
            value={(balances?.projectedConsolidatedCents ?? 0) / 100}
            format={(v) => moneyFromCents(v * 100)}
          />
        </Panel>
        {(balances?.creditCardDueCents ?? 0) !== 0 && (
          <Panel title="Cartões" subtitle="Total devido">
            <strong className="fin-negative">{debtFromCents(balances?.creditCardDueCents ?? 0)}</strong>
          </Panel>
        )}
      </div>

      {groups.length === 0 && <Empty icon={Wallet} text="Nenhuma conta cadastrada ainda." />}

      {groups.map((group) => (
        <Panel
          key={group.personId ?? "sem-pessoa"}
          title={
            <span className="fin-inline">
              {group.person && <ColorDot color={group.person.color} />}
              {group.person?.name ?? "Sem pessoa"}
            </span>
          }
        >
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Conta</th>
                  <th>Tipo</th>
                  <th className="num">Saldo atual</th>
                  <th className="num">Previsto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.accounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <button className="fin-link" onClick={() => setEditing(account)}>
                        <ColorDot color={account.color} />
                        {account.name}
                      </button>
                      {account.institution && <small className="fin-sub">{account.institution}</small>}
                    </td>
                    <td>{ACCOUNT_KIND_LABEL[account.kind] ?? account.kind}</td>
                    <td className={`num ${account.currentBalanceCents < 0 ? "fin-negative" : ""}`}>
                      {moneyFromCents(account.currentBalanceCents)}
                    </td>
                    <td className="num fin-muted">
                      {moneyFromCents(account.projectedBalanceCents)}
                    </td>
                    <td className="num">
                      <IconButton
                        icon={Archive}
                        label="Arquivar"
                        onClick={() => void archive(account)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}

      {editing && (
        <AccountDrawer
          initial={editing}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function AccountDrawer({
  initial,
  people,
  onClose,
  onSaved
}: {
  initial: Draft;
  people: PersonRecord[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? "");
  const [kind, setKind] = useState<AccountKind>(initial.kind ?? "checking");
  const [personId, setPersonId] = useState<number | null>(initial.personId ?? people[0]?.id ?? null);
  const [institution, setInstitution] = useState(initial.institution ?? "");
  const [color, setColor] = useState(initial.color ?? "#4f8ff7");
  const [openingBalance, setOpeningBalance] = useState(
    centsToInput(initial.openingBalanceCents ?? 0)
  );
  const [openingDate, setOpeningDate] = useState(initial.openingDate ?? "");
  const [includeInNetWorth, setIncludeInNetWorth] = useState(initial.includeInNetWorth ?? true);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseCurrencyInput(openingBalance || "0");
    if (cents == null) {
      toast.notify("Saldo inicial inválido", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name,
        kind,
        personId,
        institution: institution || null,
        color,
        openingBalanceCents: cents,
        openingDate: openingDate || null,
        includeInNetWorth
      };
      if (initial.id) {
        await api(`/ledger/accounts/${initial.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/ledger/accounts", { method: "POST", body: JSON.stringify(body) });
      }
      toast.notify("Conta salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={initial.id ? "Editar conta" : "Nova conta"}
      subtitle="Vale-refeição fica fora do saldo bancário (D11)"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="account-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="account-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            placeholder="Ex.: Nubank"
          />
        </Field>
        <div className="field-row">
          <Field label="Pessoa">
            <select
              value={personId ?? ""}
              onChange={(event) => setPersonId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Sem pessoa</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <select value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>
              {KINDS.map((option) => (
                <option key={option} value={option}>
                  {ACCOUNT_KIND_LABEL[option]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Instituição" hint="Opcional">
          <input
            value={institution}
            onChange={(event) => setInstitution(event.target.value)}
            placeholder="Ex.: Nu Pagamentos"
          />
        </Field>
        <div className="field-row">
          <Field label="Saldo inicial" hint="O ponto de partida do histórico (D18)">
            <input
              value={openingBalance}
              onChange={(event) => setOpeningBalance(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </Field>
          <Field label="Data inicial">
            <DateField value={openingDate} onChange={setOpeningDate} />
          </Field>
        </div>
        <ColorPicker value={color} onChange={setColor} />
        <label className="fin-check">
          <input
            type="checkbox"
            checked={includeInNetWorth}
            onChange={(event) => setIncludeInNetWorth(event.target.checked)}
          />
          <span>Somar ao patrimônio</span>
        </label>
      </form>
    </Drawer>
  );
}
