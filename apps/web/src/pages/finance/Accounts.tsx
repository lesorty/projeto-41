import { Archive, Plus, Save, UserPlus, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AccountKind,
  AccountRecord,
  BalancesResult,
  PersonKind,
  PersonRecord
} from "@projeto41/contracts";
import { ColorDot, ColorPicker } from "../../components/ColorPicker.js";
import { DateField } from "../../components/datepicker.js";
import { InvestmentCashPanel } from "../../components/finance/InvestmentCashPanel.js";
import { Drawer, useConfirm } from "../../components/dialog.js";
import {
  AnimatedNumber,
  Button,
  Empty,
  Field,
  IconButton,
  Loading,
  Panel,
  SectionHeading,
  Segmented,
  Tag
} from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { centsToInput, debtFromCents, moneyFromCents } from "../../lib/format.js";
import { ACCOUNT_KIND_LABEL } from "../../lib/ledger.js";
import { parseCurrencyInput } from "@projeto41/finance";
import { useToast } from "../../lib/toast.js";

/**
 * Pessoas e contas.
 *
 * O modulo comeca sem ninguem: o usuario cria as pessoas que usam o sistema e
 * so entao as contas de cada uma. Uma pessoa do tipo "conjunta" e a dona da
 * conta conjunta — transferencia para ela e movimentacao interna e nao entra
 * em gastos nem em entradas.
 *
 * Contas agrupadas por pessoa, com o saldo vindo do servidor (D24 — a tela
 * nunca soma lancamento). Nao existe "saldo previsto": ele ignorava a fatura
 * que ia sair da conta e prometia um numero que nao ia acontecer.
 *
 * Cartao de credito aparece com os campos de ciclo (fechamento, vencimento,
 * limite e conta de pagamento) e, na lista, com os **dois numeros** — fatura
 * atual e total devido — em vez do "saldo" de conta comum (6.1).
 */

const KINDS: AccountKind[] = ["checking", "savings", "cash", "meal_voucher", "credit_card"];

type Draft = Partial<AccountRecord> & { openingBalanceText?: string };

export function AccountsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [balances, setBalances] = useState<BalancesResult | null>(null);
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editingPerson, setEditingPerson] = useState<Partial<PersonRecord> | null>(null);
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
    try {
      // Conta sem uso nenhum é apagada de vez; o servidor diz qual dos dois fez.
      const result = await api<{ archived: boolean }>(`/ledger/accounts/${account.id}`, {
        method: "DELETE"
      });
      toast.notify(result.archived ? "Conta arquivada" : "Conta removida");
      await load();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao arquivar", "error");
    }
  }

  async function removePerson(person: PersonRecord) {
    const ok = await confirm({
      title: "Remover pessoa",
      message: `Se "${person.name}" já tiver conta ou lançamento, ela é arquivada e o histórico fica intacto; senão, é apagada.`,
      confirmLabel: "Remover"
    });
    if (!ok) return;
    try {
      const result = await api<{ archived: boolean }>(`/ledger/people/${person.id}`, {
        method: "DELETE"
      });
      toast.notify(result.archived ? "Pessoa arquivada" : "Pessoa removida");
      await load();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao remover", "error");
    }
  }

  if (loading) return <Loading />;

  const activePeople = people.filter((person) => person.active);
  const hasPeople = activePeople.length > 0;

  return (
    <>
      <SectionHeading title="Contas" subtitle="Quem usa o sistema e onde o dinheiro está">
        <Button
          variant="ghost"
          icon={UserPlus}
          onClick={() => setEditingPerson({ kind: "individual", color: "#4f9cf9" })}
        >
          Nova pessoa
        </Button>
        <Button
          icon={Plus}
          disabled={!hasPeople}
          title={hasPeople ? undefined : "Crie uma pessoa antes da primeira conta"}
          onClick={() => setEditing({ color: "#4f8ff7", kind: "checking" })}
        >
          Nova conta
        </Button>
      </SectionHeading>

      <Panel
        title={
          <span className="fin-inline">
            <Users size={15} aria-hidden />
            Pessoas
          </span>
        }
        subtitle="Donas das contas. Use o tipo conjunta para a conta do casal"
      >
        {!hasPeople ? (
          <div className="fin-onboarding">
            <Empty icon={Users} text="Ninguém cadastrado ainda. Comece criando quem usa o sistema." />
            <Button
              icon={UserPlus}
              onClick={() => setEditingPerson({ kind: "individual", color: "#4f9cf9" })}
            >
              Criar a primeira pessoa
            </Button>
          </div>
        ) : (
          <ul className="fin-people">
            {activePeople.map((person) => (
              <li key={person.id}>
                <button className="fin-link" onClick={() => setEditingPerson(person)}>
                  <ColorDot color={person.color} />
                  {person.name}
                </button>
                {person.kind === "joint" && <Tag tone="info">Conjunta</Tag>}
                <IconButton
                  icon={Archive}
                  label={`Remover ${person.name}`}
                  onClick={() => void removePerson(person)}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="fin-summary">
        <Panel title="Saldo" subtitle="Contas no patrimônio, sem cartão">
          <strong>
            <AnimatedNumber
              value={(balances?.consolidatedCents ?? 0) / 100}
              format={(v) => moneyFromCents(v * 100)}
            />
          </strong>
        </Panel>
        <Panel title="Fatura" subtitle="Faturas correntes dos cartões">
          <strong className={(balances?.creditCardStatementCents ?? 0) > 0 ? "fin-negative" : ""}>
            {debtFromCents(balances?.creditCardStatementCents ?? 0)}
          </strong>
        </Panel>
        {(balances?.creditCardDueCents ?? 0) !== 0 && (
          <Panel title="Cartões" subtitle="Total devido, com parcelas futuras">
            <strong className="fin-negative">{debtFromCents(balances?.creditCardDueCents ?? 0)}</strong>
          </Panel>
        )}
      </div>

      {groups.length === 0 && hasPeople && (
        <Empty icon={Wallet} text="Nenhuma conta cadastrada ainda." />
      )}

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
                  <th className="num">Saldo</th>
                  <th className="num">Detalhe</th>
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
                    {account.kind === "credit_card" ? (
                      <>
                        {/* Cartão nunca mostra "saldo": mostra os dois números
                            da regra 6.1, que são coisas diferentes. */}
                        <td className="num">
                          {debtFromCents(account.currentStatementCents ?? 0)}
                          <small className="fin-sub">fatura atual</small>
                        </td>
                        <td className="num fin-muted">
                          {debtFromCents(account.totalDueCents ?? 0)}
                          <small className="fin-sub">
                            {account.availableLimitCents == null
                              ? "total devido"
                              : `${moneyFromCents(account.availableLimitCents)} livres`}
                          </small>
                        </td>
                      </>
                    ) : (
                      <>
                        <td
                          className={`num ${account.currentBalanceCents < 0 ? "fin-negative" : ""}`}
                        >
                          {moneyFromCents(account.currentBalanceCents)}
                        </td>
                        <td className="num fin-muted">
                          {account.includeInNetWorth ? "no patrimônio" : "fora do patrimônio"}
                        </td>
                      </>
                    )}
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

      <InvestmentCashPanel accounts={balances?.accounts ?? []} />

      {editingPerson && (
        <PersonDrawer
          initial={editingPerson}
          onClose={() => setEditingPerson(null)}
          onSaved={async () => {
            setEditingPerson(null);
            await load();
          }}
        />
      )}

      {editing && (
        <AccountDrawer
          initial={editing}
          people={people.filter((person) => person.active || person.id === editing.personId)}
          payableAccounts={(balances?.accounts ?? []).filter(
            (account) => account.kind !== "credit_card"
          )}
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

const PERSON_KIND_OPTIONS: { value: PersonKind; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "joint", label: "Conjunta" }
];

function PersonDrawer({
  initial,
  onClose,
  onSaved
}: {
  initial: Partial<PersonRecord>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? "");
  const [kind, setKind] = useState<PersonKind>(initial.kind ?? "individual");
  const [color, setColor] = useState(initial.color ?? "#4f9cf9");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      // Editar o nome não reativa quem foi arquivado.
      const body = { name, kind, color, active: initial.active ?? true };
      if (initial.id) {
        await api(`/ledger/people/${initial.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/ledger/people", { method: "POST", body: JSON.stringify(body) });
      }
      toast.notify("Pessoa salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={initial.id ? "Editar pessoa" : "Nova pessoa"}
      subtitle="Quem é dono das contas e dos gastos"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="person-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="person-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            maxLength={60}
            placeholder="Ex.: Ana"
          />
        </Field>
        <Field
          label="Tipo"
          hint={
            kind === "joint"
              ? "Dona da conta conjunta: transferir para ela é movimentação interna, não gasto."
              : "Uma pessoa que tem as próprias contas e gastos."
          }
        >
          <Segmented<PersonKind> value={kind} onChange={setKind} options={PERSON_KIND_OPTIONS} />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}

function AccountDrawer({
  initial,
  people,
  payableAccounts,
  onClose,
  onSaved
}: {
  initial: Draft;
  people: PersonRecord[];
  /** Contas que podem pagar uma fatura: tudo menos outro cartão. */
  payableAccounts: AccountRecord[];
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
  const [closingDay, setClosingDay] = useState(String(initial.closingDay ?? ""));
  const [dueDay, setDueDay] = useState(String(initial.dueDay ?? ""));
  const [creditLimit, setCreditLimit] = useState(centsToInput(initial.creditLimitCents));
  const [paymentAccountId, setPaymentAccountId] = useState<number | null>(
    initial.paymentAccountId ?? null
  );
  const [saving, setSaving] = useState(false);
  const isCard = kind === "credit_card";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cents = parseCurrencyInput(openingBalance || "0");
    if (cents == null) {
      toast.notify("Saldo inicial inválido", "error");
      return;
    }
    setSaving(true);
    try {
      const limitCents = creditLimit.trim() === "" ? null : parseCurrencyInput(creditLimit);
      if (isCard && creditLimit.trim() !== "" && limitCents == null) {
        toast.notify("Limite inválido", "error");
        return;
      }
      const body = {
        name,
        kind,
        personId,
        institution: institution || null,
        color,
        openingBalanceCents: cents,
        openingDate: openingDate || null,
        includeInNetWorth,
        // Sem ciclo não existe fatura, então o contrato exige os dois dias em
        // cartão; o resto das contas manda nulo.
        closingDay: isCard ? Number(closingDay) || null : null,
        dueDay: isCard ? Number(dueDay) || null : null,
        creditLimitCents: isCard ? limitCents : null,
        paymentAccountId: isCard ? paymentAccountId : null,
        // O que o formulário não mostra vai como estava: o contrato completa
        // o ausente com o padrão, e o padrão apagaria ordem, ícone e arquivo.
        icon: initial.icon ?? null,
        sortOrder: initial.sortOrder ?? 0,
        archived: initial.archived ?? false
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
        {isCard && (
          <>
            <div className="field-row">
              <Field label="Dia do fechamento" hint="1 a 31">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={closingDay}
                  onChange={(event) => setClosingDay(event.target.value)}
                  required
                />
              </Field>
              <Field label="Dia do vencimento" hint="1 a 31">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dueDay}
                  onChange={(event) => setDueDay(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="field-row">
              <Field label="Limite" hint="Opcional">
                <input
                  value={creditLimit}
                  onChange={(event) => setCreditLimit(event.target.value)}
                  inputMode="decimal"
                  placeholder="Sem limite"
                />
              </Field>
              <Field label="Conta de pagamento" hint="Pré-selecionada ao pagar a fatura">
                <select
                  value={paymentAccountId ?? ""}
                  onChange={(event) =>
                    setPaymentAccountId(event.target.value ? Number(event.target.value) : null)
                  }
                >
                  <option value="">Escolher na hora</option>
                  {payableAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        )}

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
