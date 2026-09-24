import {
  Archive,
  ArchiveRestore,
  Pencil,
  Plus,
  Save,
  UserPlus,
  Users,
  Wallet
} from "lucide-react";
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
  const [showArchived, setShowArchived] = useState(false);

  // Arquivadas vêm sempre: o total da tela ignora as duas coisas do mesmo
  // jeito, e o interruptor só decide o que se mostra.
  const load = useCallback(async () => {
    const [nextBalances, nextPeople] = await Promise.all([
      api<BalancesResult>("/ledger/balances?includeArchived=true"),
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

  /**
   * Um cartão por pessoa, inclusive quem ainda não tem conta: a tela é de
   * contas *e* pessoas, e esconder quem está sem conta escondia justamente
   * quem falta configurar. Contas sem dona ficam num grupo no fim.
   */
  const groups = useMemo(() => {
    const accounts = (balances?.accounts ?? []).filter(
      (account) => showArchived || !account.archived
    );
    const visiblePeople = people.filter((person) => showArchived || person.active);
    const byPerson: { key: string; person: PersonRecord | null; accounts: AccountRecord[] }[] =
      visiblePeople.map((person) => ({
        key: String(person.id),
        person,
        accounts: accounts.filter((account) => account.personId === person.id)
      }));
    const known = new Set(visiblePeople.map((person) => person.id));
    const orphans = accounts.filter(
      (account) => account.personId == null || !known.has(account.personId)
    );
    if (orphans.length > 0) byPerson.push({ key: "sem-pessoa", person: null, accounts: orphans });
    return byPerson;
  }, [balances, people, showArchived]);

  const archivedCount =
    (balances?.accounts ?? []).filter((account) => account.archived).length +
    people.filter((person) => !person.active).length;

  async function restoreAccount(account: AccountRecord) {
    try {
      await api(`/ledger/accounts/${account.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...account, archived: false })
      });
      toast.notify("Conta desarquivada");
      await load();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao desarquivar", "error");
    }
  }

  async function restorePerson(person: PersonRecord) {
    try {
      await api(`/ledger/people/${person.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: person.name, kind: person.kind, color: person.color, active: true })
      });
      toast.notify("Pessoa reativada");
      await load();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao reativar", "error");
    }
  }

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
      <SectionHeading
        title="Contas e pessoas"
        subtitle="Quem usa o sistema, que contas tem e quanto há em cada uma"
      >
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

      {!hasPeople && !showArchived ? (
        <Panel>
          <div className="fin-onboarding">
            <Empty icon={Users} text="Ninguém cadastrado ainda. Comece criando quem usa o sistema." />
            <Button
              icon={UserPlus}
              onClick={() => setEditingPerson({ kind: "individual", color: "#4f9cf9" })}
            >
              Criar a primeira pessoa
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <div className="fin-owners-bar">
            <span className="fin-muted">
              {activePeople.length} pessoa{activePeople.length === 1 ? "" : "s"} ·{" "}
              {(balances?.accounts ?? []).filter((account) => !account.archived).length} contas ativas
            </span>
            {archivedCount > 0 && (
              <label className="fin-check">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                <span>Mostrar arquivadas ({archivedCount})</span>
              </label>
            )}
          </div>

          <div className="fin-owners">
            {groups.map((group) => (
              <OwnerCard
                key={group.key}
                person={group.person}
                accounts={group.accounts}
                onEditPerson={setEditingPerson}
                onRemovePerson={(person) => void removePerson(person)}
                onRestorePerson={(person) => void restorePerson(person)}
                onAddAccount={(personId) =>
                  setEditing({ color: "#4f8ff7", kind: "checking", personId })
                }
                onEditAccount={setEditing}
                onArchiveAccount={(account) => void archive(account)}
                onRestoreAccount={(account) => void restoreAccount(account)}
              />
            ))}
          </div>
        </>
      )}

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

/** O número que resume uma conta na lista: cartão mostra a dívida, não "saldo". */
function AccountFigure({ account }: { account: AccountRecord }) {
  if (account.kind === "credit_card") {
    const limit = account.creditLimitCents ?? null;
    const used = account.totalDueCents ?? 0;
    return (
      <span className="fin-account-figure">
        <strong className={(account.currentStatementCents ?? 0) > 0 ? "fin-negative" : ""}>
          {debtFromCents(account.currentStatementCents ?? 0)}
        </strong>
        <small>
          fatura atual · {debtFromCents(used)} devido
          {account.availableLimitCents != null &&
            ` · ${moneyFromCents(account.availableLimitCents)} livres`}
        </small>
        {limit != null && limit > 0 && (
          <span className="fin-limit-bar" aria-hidden>
            <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="fin-account-figure">
      <strong className={account.currentBalanceCents < 0 ? "fin-negative" : ""}>
        {moneyFromCents(account.currentBalanceCents)}
      </strong>
      <small>
        {account.kind === "investment"
          ? "caixa para investir"
          : account.includeInNetWorth
            ? "no patrimônio"
            : "fora do patrimônio"}
      </small>
    </span>
  );
}

function OwnerCard({
  person,
  accounts,
  onEditPerson,
  onRemovePerson,
  onRestorePerson,
  onAddAccount,
  onEditAccount,
  onArchiveAccount,
  onRestoreAccount
}: {
  person: PersonRecord | null;
  accounts: AccountRecord[];
  onEditPerson: (person: PersonRecord) => void;
  onRemovePerson: (person: PersonRecord) => void;
  onRestorePerson: (person: PersonRecord) => void;
  onAddAccount: (personId: number) => void;
  onEditAccount: (account: AccountRecord) => void;
  onArchiveAccount: (account: AccountRecord) => void;
  onRestoreAccount: (account: AccountRecord) => void;
}) {
  const archivedPerson = person != null && !person.active;
  // Soma de dinheiro, não de dívida: cartão e conta arquivada ficam de fora.
  const balance = accounts
    .filter((account) => !account.archived && account.kind !== "credit_card" && account.includeInNetWorth)
    .reduce((total, account) => total + account.currentBalanceCents, 0);

  return (
    <Panel className={`fin-owner ${archivedPerson ? "archived" : ""}`}>
      <header className="fin-owner-head">
        <span
          className="fin-owner-avatar"
          style={{ "--owner-color": person?.color ?? "#8b949e" } as React.CSSProperties}
          aria-hidden
        >
          {person ? person.name.charAt(0).toUpperCase() : "?"}
        </span>
        <div className="fin-owner-name">
          <strong>
            {person?.name ?? "Sem pessoa"}
            {person?.kind === "joint" && <Tag tone="info">Conjunta</Tag>}
            {archivedPerson && <Tag tone="warning">Arquivada</Tag>}
          </strong>
          <small>
            {accounts.length === 0
              ? "Nenhuma conta"
              : `${accounts.length} conta${accounts.length === 1 ? "" : "s"} · ${moneyFromCents(balance)} em saldo`}
          </small>
        </div>
        {person && (
          <div className="fin-owner-actions">
            {archivedPerson ? (
              <Button variant="ghost" icon={ArchiveRestore} onClick={() => onRestorePerson(person)}>
                Reativar
              </Button>
            ) : (
              <>
                <IconButton icon={Plus} label={`Nova conta de ${person.name}`} onClick={() => onAddAccount(person.id)} />
                <IconButton icon={Pencil} label={`Editar ${person.name}`} onClick={() => onEditPerson(person)} />
                <IconButton icon={Archive} label={`Remover ${person.name}`} onClick={() => onRemovePerson(person)} />
              </>
            )}
          </div>
        )}
      </header>

      {accounts.length === 0 ? (
        person && !archivedPerson ? (
          <button type="button" className="fin-owner-empty" onClick={() => onAddAccount(person.id)}>
            <Wallet size={16} aria-hidden />
            Adicionar a primeira conta de {person.name}
          </button>
        ) : null
      ) : (
        <ul className="fin-owner-accounts">
          {accounts.map((account) => (
            <li key={account.id} className={account.archived ? "archived" : ""}>
              <button type="button" className="fin-owner-account" onClick={() => onEditAccount(account)}>
                <ColorDot color={account.color} />
                <span className="fin-owner-account-name">
                  <strong>{account.name}</strong>
                  <small>
                    {ACCOUNT_KIND_LABEL[account.kind] ?? account.kind}
                    {account.institution && ` · ${account.institution}`}
                    {account.archived && " · arquivada"}
                  </small>
                </span>
                <AccountFigure account={account} />
              </button>
              {account.archived ? (
                <IconButton icon={ArchiveRestore} label="Desarquivar" onClick={() => onRestoreAccount(account)} />
              ) : (
                <IconButton icon={Archive} label="Arquivar" onClick={() => onArchiveAccount(account)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
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
