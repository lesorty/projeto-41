import { Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AttachmentRecord,
  EntryRecord,
  EntryStatus,
  PaymentMethod,
  PlaceRecord
} from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { DateField } from "../datepicker.js";
import { Drawer, useConfirm } from "../dialog.js";
import { Button, Field, Segmented } from "../ui.js";
import { ColorDot } from "../ColorPicker.js";
import { PhotoField } from "./PhotoField.js";
import { centsToInput } from "../../lib/format.js";
import { PAYMENT_METHOD_LABEL, STATUS_LABEL, ledgerApi } from "../../lib/ledger.js";
import type { LedgerReference } from "../../lib/ledger.js";
import { useToast } from "../../lib/toast.js";

/** Tipos oferecidos no formulário. `adjustment` é interno, não se cria à mão. */
type FormKind = "expense" | "income" | "transfer";

const today = () => new Date().toISOString().slice(0, 10);

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

  const [kind, setKind] = useState<FormKind>(
    entry ? (entry.kind === "adjustment" ? "expense" : (entry.kind as FormKind)) : defaultKind
  );
  const [amount, setAmount] = useState(entry ? centsToInput(entry.amountCents) : "");
  const [date, setDate] = useState(entry?.date ?? today());
  const [accountId, setAccountId] = useState<number | null>(
    entry?.accountId ?? reference.accounts[0]?.id ?? null
  );
  const [toAccountId, setToAccountId] = useState<number | null>(
    entry?.counterpartAccountId ?? reference.accounts[1]?.id ?? null
  );
  const [categoryId, setCategoryId] = useState<number | null>(entry?.categoryId ?? null);
  const [personId, setPersonId] = useState<number | null>(entry?.personId ?? null);
  const [description, setDescription] = useState(entry?.description ?? "");
  const [placeName, setPlaceName] = useState(entry?.placeName ?? "");
  const [placeId, setPlaceId] = useState<number | null>(entry?.placeId ?? null);
  const [status, setStatus] = useState<EntryStatus>(entry?.status ?? "cleared");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(
    entry?.paymentMethod ?? ""
  );
  const [tagIds, setTagIds] = useState<number[]>(entry?.tags.map((tag) => tag.id) ?? []);
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [attachments, setAttachments] = useState<AttachmentRecord[]>(entry?.attachments ?? []);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const categories = useMemo(
    () => reference.categories.filter((category) => category.kind === kind),
    [reference.categories, kind]
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
    const cents = parseCurrencyInput(amount);
    if (cents == null || cents === 0) {
      toast.notify("Informe um valor válido", "error");
      return;
    }
    if (accountId == null) {
      toast.notify("Escolha uma conta", "error");
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
            status,
            description: description || null,
            notes: notes || null,
            tagIds
          });
        } else {
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
      } else {
        const resolvedPlaceId = await resolvePlace();
        const signed = kind === "expense" ? -Math.abs(cents) : Math.abs(cents);
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
          paymentMethod: paymentMethod || null,
          tagIds
        };
        if (editing && entry) {
          await ledgerApi.updateEntry(entry.id, body);
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
    await ledgerApi.removeEntry(entry.id);
    toast.notify("Lançamento excluído");
    await onSaved();
  }

  return (
    <Drawer
      title={editing ? "Editar lançamento" : "Novo lançamento"}
      subtitle={account?.name}
      onClose={onClose}
      footer={
        <>
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
        <Segmented<FormKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: "expense", label: "Saída" },
            { value: "income", label: "Entrada" },
            { value: "transfer", label: "Transferência" }
          ]}
        />

        <div className="field-row">
          <Field label="Valor">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              autoFocus
              required
              placeholder="0,00"
            />
          </Field>
          <Field label="Data">
            <DateField value={date} onChange={setDate} />
          </Field>
        </div>

        <div className="field-row">
          <Field label={kind === "transfer" ? "Conta de origem" : "Conta"}>
            <select
              value={accountId ?? ""}
              onChange={(event) => setAccountId(Number(event.target.value))}
            >
              {reference.accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>

          {kind === "transfer" ? (
            <Field label="Conta de destino">
              <select
                value={toAccountId ?? ""}
                onChange={(event) => setToAccountId(Number(event.target.value))}
                disabled={editing}
              >
                {reference.accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            /* Transferência nunca tem categoria (D21). */
            <Field label="Categoria">
              <select
                value={categoryId ?? ""}
                onChange={(event) =>
                  setCategoryId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

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
          <Field label="Pessoa" hint="Herdada da conta">
            <select
              value={effectivePersonId ?? ""}
              onChange={(event) =>
                setPersonId(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">Sem pessoa</option>
              {reference.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as EntryStatus)}
            >
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {kind !== "transfer" && (
          <Field label="Forma de pagamento" hint="Opcional">
            <select
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod | "")}
            >
              <option value="">Não informada</option>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <TagPicker reference={reference} value={tagIds} onChange={setTagIds} />

        <Field label="Observações" hint="Opcional">
          <textarea
            value={notes}
            rows={2}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Detalhes que não cabem na descrição"
          />
        </Field>

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

function TagPicker({
  reference,
  value,
  onChange
}: {
  reference: LedgerReference;
  value: number[];
  onChange: (next: number[]) => void;
}) {
  if (reference.tags.length === 0) return null;
  return (
    <div className="field">
      <span className="field-label">Etiquetas</span>
      <div className="fin-tag-picker">
        {reference.tags.map((tag) => {
          const active = value.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              className={active ? "active" : ""}
              style={active ? { borderColor: tag.color } : undefined}
              onClick={() =>
                onChange(active ? value.filter((id) => id !== tag.id) : [...value, tag.id])
              }
            >
              <ColorDot color={tag.color} size={8} />
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
