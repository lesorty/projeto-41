import { Filter, X } from "lucide-react";
import type { EntryFilter } from "@projeto41/contracts";
import { DateField } from "../datepicker.js";
import { Field, SearchInput } from "../ui.js";
import type { LedgerReference } from "../../lib/ledger.js";
import { STATUS_LABEL } from "../../lib/ledger.js";
import { monthNames } from "../../lib/format.js";

export type LedgerFilter = Partial<EntryFilter>;

/** Atalhos de período: cobre 95% dos cliques sem abrir o seletor de data. */
function periodShortcuts(today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

  return [
    {
      id: "current",
      label: monthNames[month] ?? "Mês atual",
      from: iso(new Date(year, month, 1)),
      to: iso(new Date(year, month + 1, 0))
    },
    {
      id: "previous",
      label: monthNames[(month + 11) % 12] ?? "Mês passado",
      from: iso(new Date(year, month - 1, 1)),
      to: iso(new Date(year, month, 0))
    },
    { id: "year", label: String(year), from: `${year}-01-01`, to: `${year}-12-31` },
    { id: "all", label: "Tudo", from: undefined, to: undefined }
  ];
}

export function EntryFilters({
  filter,
  onChange,
  reference,
  lockedKind = false
}: {
  filter: LedgerFilter;
  onChange: (next: LedgerFilter) => void;
  reference: LedgerReference;
  /** Gastos e Entradas fixam o tipo; Transações deixa escolher. */
  lockedKind?: boolean;
}) {
  // Qualquer mudança volta para a página 1: manter a página com outro filtro
  // aplicado mostra "nenhum resultado" numa busca que tem resultados.
  const patch = (next: LedgerFilter) => onChange({ ...filter, ...next, page: 1 });

  const shortcuts = periodShortcuts();
  const chips = buildChips(filter, reference);

  return (
    <div className="fin-filters">
      <div className="fin-filter-row">
        <div className="fin-shortcuts" role="group" aria-label="Período">
          {shortcuts.map((shortcut) => (
            <button
              key={shortcut.id}
              type="button"
              className={
                filter.from === shortcut.from && filter.to === shortcut.to ? "active" : ""
              }
              onClick={() => patch({ from: shortcut.from, to: shortcut.to })}
            >
              {shortcut.label}
            </button>
          ))}
        </div>
        <SearchInput
          value={filter.search ?? ""}
          onChange={(value) => patch({ search: value || undefined })}
          placeholder="Buscar descrição ou local"
        />
      </div>

      <div className="fin-filter-grid">
        <Field label="De">
          <DateField value={filter.from ?? ""} onChange={(value) => patch({ from: value || undefined })} />
        </Field>
        <Field label="Até">
          <DateField value={filter.to ?? ""} onChange={(value) => patch({ to: value || undefined })} />
        </Field>
        <Field label="Conta">
          <select
            value={filter.accountId ?? ""}
            onChange={(event) =>
              patch({ accountId: event.target.value ? Number(event.target.value) : undefined })
            }
          >
            <option value="">Todas</option>
            {reference.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pessoa">
          <select
            value={filter.personId ?? ""}
            onChange={(event) =>
              patch({ personId: event.target.value ? Number(event.target.value) : undefined })
            }
          >
            <option value="">Todas</option>
            {reference.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoria">
          <select
            value={filter.categoryId?.[0] ?? ""}
            onChange={(event) =>
              patch({ categoryId: event.target.value ? [Number(event.target.value)] : undefined })
            }
          >
            <option value="">Todas</option>
            {reference.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Etiqueta">
          <select
            value={filter.tagId?.[0] ?? ""}
            onChange={(event) =>
              patch({ tagId: event.target.value ? [Number(event.target.value)] : undefined })
            }
          >
            <option value="">Todas</option>
            {reference.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Caixinha">
          <select
            value={filter.goalId ?? ""}
            onChange={(event) =>
              patch({ goalId: event.target.value ? Number(event.target.value) : undefined })
            }
          >
            <option value="">Todas</option>
            {reference.goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            value={filter.status ?? ""}
            onChange={(event) =>
              patch({ status: (event.target.value || undefined) as EntryFilter["status"] })
            }
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {!lockedKind && (
          <Field label="Tipo">
            <select
              value={filter.kind ?? ""}
              onChange={(event) =>
                patch({ kind: (event.target.value || undefined) as EntryFilter["kind"] })
              }
            >
              <option value="">Todos</option>
              <option value="expense">Saídas</option>
              <option value="income">Entradas</option>
              <option value="transfer">Transferências</option>
            </select>
          </Field>
        )}
      </div>

      {chips.length > 0 && (
        <div className="fin-chips">
          <Filter size={13} aria-hidden />
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => patch(chip.clear)}>
              {chip.label}
              <X size={12} />
            </button>
          ))}
          <button
            type="button"
            className="fin-chip-clear"
            onClick={() => onChange({ page: 1, pageSize: filter.pageSize })}
          >
            Limpar tudo
          </button>
        </div>
      )}
    </div>
  );
}

/** O filtro aplicado precisa ser visível e removível item a item. */
function buildChips(filter: LedgerFilter, reference: LedgerReference) {
  const chips: { key: string; label: string; clear: LedgerFilter }[] = [];
  const name = <T extends { id: number; name: string }>(list: T[], id?: number) =>
    list.find((item) => item.id === id)?.name;

  if (filter.accountId) {
    chips.push({
      key: "account",
      label: `Conta: ${name(reference.accounts, filter.accountId) ?? filter.accountId}`,
      clear: { accountId: undefined }
    });
  }
  if (filter.personId) {
    chips.push({
      key: "person",
      label: `Pessoa: ${name(reference.people, filter.personId) ?? filter.personId}`,
      clear: { personId: undefined }
    });
  }
  if (filter.categoryId?.length) {
    chips.push({
      key: "category",
      label: `Categoria: ${name(reference.categories, filter.categoryId[0]) ?? ""}`,
      clear: { categoryId: undefined }
    });
  }
  if (filter.tagId?.length) {
    chips.push({
      key: "tag",
      label: `Etiqueta: ${name(reference.tags, filter.tagId[0]) ?? ""}`,
      clear: { tagId: undefined }
    });
  }
  if (filter.status) {
    chips.push({
      key: "status",
      label: `Status: ${STATUS_LABEL[filter.status]}`,
      clear: { status: undefined }
    });
  }
  if (filter.goalId) {
    chips.push({
      key: "goal",
      label: `Caixinha: ${name(reference.goals, filter.goalId) ?? ""}`,
      clear: { goalId: undefined }
    });
  }
  if (filter.search) {
    chips.push({ key: "search", label: `Busca: ${filter.search}`, clear: { search: undefined } });
  }
  return chips;
}
