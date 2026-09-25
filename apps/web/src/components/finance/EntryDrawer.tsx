import { CreditCard, Save, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AttachmentRecord,
  SeriesScope,
  EntryRecord,
  EntryStatus,
  PlaceRecord
} from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { DateField } from "../datepicker.js";
import { Drawer, useConfirm } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { Dropdown, MoneyInput, type DropdownOption } from "../forms.js";
import { InstallmentFields, purchaseTotal, type AmountBasis } from "./InstallmentFields.js";
import { PhotoField } from "./PhotoField.js";
import { RefundDrawer } from "./RefundDrawer.js";
import { SeriesScopeDialog } from "./SeriesScopeDialog.js";
import { centsToInput, todayIso } from "../../lib/format.js";
import {
  ACCOUNT_KIND_LABEL,
  STATUS_LABEL,
  isCard as isCardAccount,
  isMoneyAccount,
  ledgerApi
} from "../../lib/ledger.js";
import type { LedgerReference } from "../../lib/ledger.js";
import { api } from "../../lib/api.js";
import { useToast } from "../../lib/toast.js";

/** Tipos oferecidos no formulário. `adjustment` é interno, não se cria à mão. */
type FormKind = "expense" | "income" | "transfer";

/** À vista sai de uma conta; crédito vai para a fatura de um cartão. */
type PayWith = "money" | "credit";

/** Caixinha e investimento têm fluxo próprio: não são a conta padrão de um gasto. */
const everydayAccount = (reference: LedgerReference) =>
  reference.accounts.find(isMoneyAccount) ?? reference.accounts[0];

export function EntryDrawer({
  entry,
  reference,
  defaultKind = "expense",
  onClose,
  onSaved,
  onReloadReference
}: {
  entry: EntryRecord | null;
  reference: LedgerReference;
  defaultKind?: FormKind;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onReloadReference: () => Promise<void>;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const editing = entry != null;
  const isTransfer = entry?.kind === "transfer";
  // Estorno é um lançamento de sinal oposto ligado ao original (6.6): o tipo e
  // o sinal são do original, não do formulário.
  const isRefund = entry?.refundOfEntryId != null;
  // Na ponta de entrada de uma transferência, a conta do lançamento é o destino.
  const incomingLeg = isTransfer && (entry?.amountCents ?? 0) > 0;

  const [kind, setKind] = useState<FormKind>(
    entry ? (entry.kind === "adjustment" ? "expense" : (entry.kind as FormKind)) : defaultKind
  );
  const [amount, setAmount] = useState(entry ? centsToInput(entry.amountCents) : "");
  const [date, setDate] = useState(entry?.date ?? todayIso());
  const entryAccount = reference.accounts.find((item) => item.id === entry?.accountId);
  const [payWith, setPayWith] = useState<PayWith>(
    entryAccount && isCardAccount(entryAccount) ? "credit" : "money"
  );
  // Conta e cartão guardados à parte: trocar de Dinheiro para Crédito e voltar
  // não perde nenhuma das duas escolhas.
  const [moneyAccountId, setMoneyAccountId] = useState<number | null>(
    entryAccount && isCardAccount(entryAccount)
      ? (entryAccount.paymentAccountId ?? everydayAccount(reference)?.id ?? null)
      : (entry?.accountId ?? everydayAccount(reference)?.id ?? null)
  );
  const [cardId, setCardId] = useState<number | null>(
    entryAccount && isCardAccount(entryAccount)
      ? entryAccount.id
      : (reference.accounts.find(isCardAccount)?.id ?? null)
  );
  const [toAccountId, setToAccountId] = useState<number | null>(
    entry?.counterpartAccountId ?? reference.accounts.filter(isMoneyAccount)[1]?.id ?? null
  );
  const [categoryId, setCategoryId] = useState<number | null>(entry?.categoryId ?? null);
  const [personId, setPersonId] = useState<number | null>(entry?.personId ?? null);
  const [description, setDescription] = useState(entry?.description ?? "");
  const [placeName, setPlaceName] = useState(entry?.placeName ?? "");
  const [placeId, setPlaceId] = useState<number | null>(entry?.placeId ?? null);
  const [status, setStatus] = useState<EntryStatus>(entry?.status ?? "cleared");
  const [tagIds, setTagIds] = useState<number[]>(entry?.tags.map((tag) => tag.id) ?? []);
  // Observações saíram do formulário; as que já existem continuam gravadas.
  const notes = entry?.notes ?? "";
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(entry?.attachments ?? []);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installmentMode, setInstallmentMode] = useState<"single" | "installments">("single");
  const [installmentCount, setInstallmentCount] = useState(2);
  const [amountBasis, setAmountBasis] = useState<AmountBasis>("total");
  const [refunding, setRefunding] = useState(false);
  const [scopeAsk, setScopeAsk] = useState(false);

  // Cadastros arquivados saem das listas, mas o lançamento antigo continua
  // apontando para eles. Sem a opção atual, o select mostraria outra coisa — e
  // salvar trocaria a categoria (ou a conta) sem ninguém pedir.
  const categories = useMemo(() => {
    const options: { id: number; name: string; color?: string }[] = reference.categories.filter(
      (category) => category.kind === kind
    );
    if (
      entry?.categoryId != null &&
      entry.kind === kind &&
      !options.some((category) => category.id === entry.categoryId)
    ) {
      options.push({ id: entry.categoryId, name: `${entry.categoryName ?? "Categoria"} (arquivada)` });
    }
    return options;
  }, [reference.categories, kind, entry]);

  /** Contas de dinheiro (e, na transferência, caixinhas): nunca cartão. */
  const accountOptions = useMemo(() => {
    const options: DropdownOption<number>[] = reference.accounts
      .filter((account) => isMoneyAccount(account) || (kind === "transfer" && account.kind === "goal"))
      .map((account) => ({
        value: account.id,
        label: account.name,
        color: account.color,
        hint: [account.personName, ACCOUNT_KIND_LABEL[account.kind]].filter(Boolean).join(" · ")
      }));
    const current = payWith === "money" || kind !== "expense" ? entry?.accountId : undefined;
    if (current != null && !options.some((option) => option.value === current)) {
      options.push({ value: current, label: `${entry?.accountName ?? "Conta"} (arquivada)` });
    }
    return options;
  }, [reference.accounts, entry, kind, payWith]);

  const cardOptions = useMemo(() => {
    const options: DropdownOption<number>[] = reference.accounts.filter(isCardAccount).map((card) => {
      const bank = reference.accounts.find((account) => account.id === card.paymentAccountId);
      return {
        value: card.id,
        label: card.name,
        color: card.color,
        icon: <CreditCard size={14} aria-hidden />,
        hint: [bank?.name ?? card.personName, `fecha dia ${card.closingDay} · vence dia ${card.dueDay}`]
          .filter(Boolean)
          .join(" · ")
      };
    });
    if (payWith === "credit" && entry && !options.some((option) => option.value === entry.accountId)) {
      options.push({ value: entry.accountId, label: `${entry.accountName ?? "Cartão"} (arquivado)` });
    }
    return options;
  }, [reference.accounts, entry, payWith]);

  // O drawer pode abrir antes dos cadastros chegarem: quando chegam, conta e
  // cartão ainda vazios ganham o padrão.
  useEffect(() => {
    if (moneyAccountId == null) {
      const fallback = everydayAccount(reference);
      if (fallback) setMoneyAccountId(fallback.id);
    }
    if (cardId == null) {
      const firstCard = reference.accounts.find(isCardAccount);
      if (firstCard) setCardId(firstCard.id);
    }
  }, [reference, moneyAccountId, cardId]);

  // O que o lançamento usa de fato: a conta, ou o cartão quando é no crédito.
  const accountId = kind === "expense" && payWith === "credit" ? cardId : moneyAccountId;

  const peopleOptions = useMemo(
    () => reference.people.filter((person) => person.active || person.id === entry?.personId),
    [reference.people, entry]
  );

  // Trocar entrada/saída invalida a categoria escolhida do outro lado.
  useEffect(() => {
    if (categoryId != null && !categories.some((category) => category.id === categoryId)) {
      setCategoryId(null);
    }
  }, [categories, categoryId]);

  // A pessoa é herdada da conta (D01), mas continua sobrescrevível.
  const account = reference.accounts.find((item) => item.id === accountId);
  const effectivePersonId = personId ?? account?.personId ?? null;
  const isCard = account?.kind === "credit_card";
  const typedCents = Math.abs(parseCurrencyInput(amount) ?? 0);
  const totalCents =
    installmentMode === "installments"
      ? purchaseTotal(typedCents, amountBasis, installmentCount)
      : typedCents;
  const inSeries = entry?.installmentPlanId != null;
  const seriesCount = entry?.installmentCount ?? 0;
  const seriesNumber = entry?.installmentNumber ?? 0;
  // O valor muda só nesta parcela, então nem vale perguntar o escopo.
  const amountChanged =
    entry != null && Math.abs(parseCurrencyInput(amount) ?? 0) !== Math.abs(entry.amountCents);

  async function persistPhoto(entryId: number) {
    if (!pendingPhoto) return;
    setUploading(true);
    try {
      await ledgerApi.uploadPhoto(entryId, pendingPhoto);
      setPendingPhoto(null);
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Editar uma parcela pede o escopo antes de gravar — menos quando o que
    // mudou foi o valor, que é sempre só desta parcela.
    if (inSeries && editing && !amountChanged && !scopeAsk) {
      setScopeAsk(true);
      return;
    }
    await persist("one");
  }

  async function persist(scope: SeriesScope) {
    setScopeAsk(false);
    const cents = parseCurrencyInput(amount);
    if (cents == null || cents === 0) {
      toast.notify("Informe um valor válido", "error");
      return;
    }
    if (accountId == null) {
      toast.notify(
        kind === "expense" && payWith === "credit" ? "Escolha o cartão" : "Escolha uma conta",
        "error"
      );
      return;
    }

    setSaving(true);
    try {
      if (kind === "transfer") {
        if (toAccountId == null || toAccountId === accountId) {
          toast.notify("Escolha contas de origem e destino diferentes", "error");
          return;
        }
        // Editar uma transferência existente é fora do escopo do drawer: as
        // duas pontas precisam mudar juntas, e o repositório já faz isso pelo
        // PUT de qualquer uma delas.
        if (editing && entry) {
          await ledgerApi.updateEntry(entry.id, {
            accountId,
            date,
            amountCents: entry.amountCents < 0 ? -Math.abs(cents) : Math.abs(cents),
            kind: "transfer",
            personId: effectivePersonId,
            status,
            description: description || null,
            notes: notes || null,
            tagIds
          });
        } else {
          if (reference.accounts.find((item) => item.id === toAccountId)?.kind === "credit_card") {
            toast.notify("Para pagar o cartão, use Pagar fatura na tela Fatura", "error");
            return;
          }
          const created = await ledgerApi.createTransfer({
            fromAccountId: accountId,
            toAccountId,
            date,
            amountCents: Math.abs(cents),
            status,
            description: description || null,
            notes: notes || null,
            personId: effectivePersonId
          });
          await persistPhoto(created.fromEntryId);
        }
      } else if (!editing && isCard && installmentMode === "installments") {
        // Compra parcelada nasce como plano: N lançamentos reais, nunca uma
        // linha só com "12x" escrito na descrição (D23).
        await api("/ledger/installment-plans", {
          method: "POST",
          body: JSON.stringify({
            accountId,
            purchaseDate: date,
            totalCents,
            installmentCount,
            categoryId,
            placeId: await resolvePlace(),
            personId: effectivePersonId,
            description: description || null
          })
        });
      } else {
        const resolvedPlaceId = await resolvePlace();
        const signed =
          isRefund && entry
            ? Math.sign(entry.amountCents) * Math.abs(cents)
            : kind === "expense"
              ? -Math.abs(cents)
              : Math.abs(cents);
        const body = {
          accountId,
          personId: effectivePersonId,
          date,
          amountCents: signed,
          kind,
          status,
          categoryId,
          placeId: resolvedPlaceId,
          description: description || null,
          notes: notes || null,
          paymentMethod:
            kind !== "expense"
              ? (entry?.paymentMethod ?? null)
              : isCard
                ? "credit"
                : account?.kind === "meal_voucher"
                  ? "voucher"
                  : "cash",
          tagIds
        };
        if (editing && entry) {
          await ledgerApi.updateEntry(entry.id, body, scope);
          await persistPhoto(entry.id);
        } else {
          const created = await ledgerApi.createEntry(body);
          await persistPhoto(created.id);
        }
      }
      toast.notify("Lançamento salvo");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  /** Local digitado vira registro reutilizável, resolvido pelo nome (D06). */
  async function resolvePlace(): Promise<number | null> {
    const name = placeName.trim();
    if (!name) return null;
    if (placeId != null) return placeId;
    const created = await ledgerApi.createPlace(name, categoryId);
    await onReloadReference();
    return created.id;
  }

  async function remove() {
    if (!entry) return;
    const ok = await confirm({
      title: "Excluir lançamento",
      message: isTransfer
        ? "As duas pontas da transferência serão removidas."
        : "O lançamento e as fotos anexadas serão removidos.",
      confirmLabel: "Excluir",
      tone: "danger"
    });
    if (!ok) return;
    try {
      await ledgerApi.removeEntry(entry.id);
      toast.notify("Lançamento excluído");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao excluir", "error");
    }
  }

  return (
    <Drawer
      title={editing ? "Editar lançamento" : "Novo lançamento"}
      subtitle={account?.name}
      onClose={onClose}
      footer={
        <>
          {editing && entry && entry.kind !== "transfer" && entry.refundOfEntryId == null && (
            <Button variant="ghost" icon={Undo2} onClick={() => setRefunding(true)}>
              Estornar
            </Button>
          )}
          {editing && (
            <Button variant="danger" icon={Trash2} onClick={() => void remove()}>
              Excluir
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="entry-form" disabled={saving || uploading}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="entry-form" className="stack" onSubmit={submit}>
        {isRefund ? (
          <p className="fin-muted">
            Estorno de um lançamento: o valor abate o original, e o tipo não muda.
          </p>
        ) : isTransfer ? (
          <p className="fin-muted">
            Transferência: as duas pontas mudam juntas. Para trocar as contas, exclua e crie de novo.
          </p>
        ) : (
          <Segmented<FormKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: "expense", label: "Saída" },
              { value: "income", label: "Entrada" },
              { value: "transfer", label: "Transferência" }
            ]}
          />
        )}

        <div className="field-row entry-amount-row">
          <Field label={kind === "expense" && installmentMode === "installments" && amountBasis === "installment" ? "Valor da parcela" : "Valor"}>
            <MoneyInput value={amount} onChange={setAmount} autoFocus required />
          </Field>
          <Field label={isCard && installmentMode === "installments" ? "Data da compra" : "Data"}>
            <DateField value={date} onChange={setDate} />
          </Field>
        </div>

        {kind === "expense" && !isRefund && (
          <Field label="Forma de pagamento">
            <Segmented<PayWith>
              value={payWith}
              onChange={(next) => {
                if (inSeries) return;
                setPayWith(next);
                if (next === "money") setInstallmentMode("single");
              }}
              options={[
                { value: "money", label: "Dinheiro" },
                { value: "credit", label: "Crédito" }
              ]}
            />
          </Field>
        )}

        {kind === "expense" && payWith === "credit" && !isRefund ? (
          cardOptions.length === 0 ? (
            <p className="fin-callout">
              Nenhum cartão cadastrado. Crie o cartão dentro da conta do banco, em Contas e pessoas.
            </p>
          ) : (
            <>
              <Field label="Cartão">
                <Dropdown<number>
                  value={cardId}
                  onChange={setCardId}
                  options={cardOptions}
                  placeholder="Escolher cartão"
                  disabled={inSeries}
                  aria-label="Cartão"
                />
              </Field>
              {/* Parcelar é na criação; na edição só se vê o plano que já existe. */}
              {(!editing || inSeries) && (
              <InstallmentFields
                mode={inSeries ? "installments" : installmentMode}
                onModeChange={setInstallmentMode}
                installmentCount={inSeries ? seriesCount : installmentCount}
                onCountChange={setInstallmentCount}
                basis={amountBasis}
                onBasisChange={editing ? undefined : setAmountBasis}
                totalCents={inSeries ? (entry?.amountCents ?? 0) * -seriesCount : totalCents}
                purchaseDate={date}
                closingDay={account?.closingDay ?? 1}
                dueDay={account?.dueDay ?? 10}
                readOnly={inSeries}
              />
              )}
            </>
          )
        ) : (
          <div className={kind === "transfer" ? "field-row" : ""}>
            <Field
              label={
                kind !== "transfer" ? "Conta" : incomingLeg ? "Conta de destino" : "Conta de origem"
              }
            >
              <Dropdown<number>
                value={moneyAccountId}
                onChange={setMoneyAccountId}
                options={accountOptions}
                placeholder="Escolher conta"
                disabled={isTransfer}
                aria-label="Conta"
              />
            </Field>
            {kind === "transfer" && (
              <Field label={incomingLeg ? "Conta de origem" : "Conta de destino"}>
                <Dropdown<number>
                  value={toAccountId}
                  onChange={setToAccountId}
                  // Origem e destino iguais não é transferência.
                  options={
                    editing
                      ? accountOptions
                      : accountOptions.filter((option) => option.value !== moneyAccountId)
                  }
                  placeholder="Escolher conta"
                  disabled={editing}
                  aria-label="Conta de destino"
                />
              </Field>
            )}
          </div>
        )}

        {/* Transferência nunca tem categoria (D21). */}
        {kind !== "transfer" && (
          <Field label="Categoria">
            <Dropdown<number>
              value={categoryId}
              onChange={setCategoryId}
              emptyLabel="Sem categoria"
              options={categories.map((category) => ({
                value: category.id,
                label: category.name,
                color: category.color ?? null
              }))}
              aria-label="Categoria"
            />
          </Field>
        )}

        <Field label="Descrição" hint="Opcional">
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: Compra da semana"
          />
        </Field>

        {kind !== "transfer" && (
          <PlaceAutocomplete
            value={placeName}
            onChange={(name, place) => {
              setPlaceName(name);
              setPlaceId(place?.id ?? null);
              // Categoria padrão do local só preenche o que ainda está vazio:
              // nunca sobrescreve a escolha do usuário.
              if (place?.defaultCategoryId != null && categoryId == null) {
                setCategoryId(place.defaultCategoryId);
              }
            }}
          />
        )}

        <div className="field-row">
          <Field label="Quem pagou" hint="Herdado da conta">
            <Dropdown<number>
              value={effectivePersonId}
              onChange={setPersonId}
              emptyLabel="Sem pessoa"
              options={peopleOptions.map((person) => ({
                value: person.id,
                label: person.name,
                color: person.color
              }))}
              aria-label="Quem pagou"
            />
          </Field>
          <Field label="Status">
            <Dropdown<EntryStatus>
              value={status}
              onChange={(next) => setStatus(next ?? "cleared")}
              options={Object.entries(STATUS_LABEL).map(([value, label]) => ({
                value: value as EntryStatus,
                label
              }))}
              aria-label="Status"
            />
          </Field>
        </div>

        {reference.tags.length > 0 && (
          <Field label="Etiquetas" hint="Opcional">
            <Dropdown<number>
              multiple
              value={tagIds}
              onChange={setTagIds}
              placeholder="Nenhuma etiqueta"
              options={reference.tags.map((tag) => ({
                value: tag.id,
                label: tag.name,
                color: tag.color
              }))}
              aria-label="Etiquetas"
            />
          </Field>
        )}

        <PhotoField
          attachments={attachments}
          pending={pendingPhoto}
          uploading={uploading}
          onPick={setPendingPhoto}
          onRemovePending={() => setPendingPhoto(null)}
          onRemoveSaved={async (id) => {
            await ledgerApi.removePhoto(id);
            setAttachments((current) => current.filter((item) => item.id !== id));
          }}
        />
      </form>

      <SeriesScopeDialog
        open={scopeAsk}
        title="Alterar parcelas"
        description={`Esta é a parcela ${seriesNumber} de ${seriesCount}.`}
        counts={{
          one: 1,
          forward: Math.max(seriesCount - seriesNumber + 1, 1),
          all: seriesCount
        }}
        onPick={(scope) => void persist(scope)}
        onCancel={() => setScopeAsk(false)}
      />

      {refunding && entry && (
        <RefundDrawer
          entry={entry}
          onClose={() => setRefunding(false)}
          onDone={async () => {
            setRefunding(false);
            await onSaved();
          }}
        />
      )}
    </Drawer>
  );
}

/** Autocomplete de local: resolve pelo nome normalizado no servidor. */
function PlaceAutocomplete({
  value,
  onChange
}: {
  value: string;
  onChange: (name: string, place: PlaceRecord | null) => void;
}) {
  const [options, setOptions] = useState<PlaceRecord[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(next: string) {
    onChange(next, null);
    clearTimeout(timer.current);
    if (next.trim().length < 2) {
      setOptions([]);
      return;
    }
    timer.current = setTimeout(() => {
      void ledgerApi
        .searchPlaces(next)
        .then(setOptions)
        .catch(() => setOptions([]));
    }, 200);
  }

  return (
    <Field label="Local" hint="Opcional. Reaproveitado entre lançamentos.">
      <input
        value={value}
        onChange={(event) => search(event.target.value)}
        list="fin-places"
        placeholder="Ex.: Assaí"
        onBlur={(event) => {
          const match = options.find(
            (place) => place.name.toLowerCase() === event.target.value.trim().toLowerCase()
          );
          if (match) onChange(match.name, match);
        }}
      />
      <datalist id="fin-places">
        {options.map((place) => (
          <option key={place.id} value={place.name} />
        ))}
      </datalist>
    </Field>
  );
}
