import { Archive, Plus, Save, Tags } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CategoryKind, CategoryRecord, TagRecord } from "@projeto41/contracts";
import { parseCurrencyInput } from "@projeto41/finance";
import { ColorDot, ColorPicker } from "../../components/ColorPicker.js";
import { Drawer, useConfirm } from "../../components/dialog.js";
import {
  Button,
  Empty,
  Field,
  IconButton,
  Loading,
  Panel,
  SectionHeading
} from "../../components/ui.js";
import { api } from "../../lib/api.js";
import { centsToInput, moneyFromCents } from "../../lib/format.js";
import { useToast } from "../../lib/toast.js";

/**
 * Categorias planas, saidas e entradas lado a lado (D05).
 *
 * Nao existe subcategoria: os cortes transversais sao cobertos pelas etiquetas,
 * que ficam na terceira coluna. Categoria em uso e arquivada, nunca excluida,
 * para nao quebrar relatorio antigo.
 */

type Draft = Partial<CategoryRecord>;

export function CategoriesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [editingTag, setEditingTag] = useState<Partial<TagRecord> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [nextCategories, nextTags] = await Promise.all([
      api<CategoryRecord[]>("/ledger/categories"),
      api<TagRecord[]>("/ledger/tags")
    ]);
    setCategories(nextCategories);
    setTags(nextTags);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load().catch((error: Error) => {
      toast.notify(error.message, "error");
      setLoading(false);
    });
  }, [load, toast]);

  async function archive(category: CategoryRecord) {
    const ok = await confirm({
      title: "Arquivar categoria",
      message: `"${category.name}" some das listas. Os lançamentos já classificados continuam nela.`,
      confirmLabel: "Arquivar"
    });
    if (!ok) return;
    await api(`/ledger/categories/${category.id}`, { method: "DELETE" });
    toast.notify("Categoria arquivada");
    await load();
  }

  async function removeTag(tag: TagRecord) {
    const ok = await confirm({
      title: "Excluir etiqueta",
      message: `"${tag.name}" sai dos lançamentos que a usam. Os lançamentos continuam intactos.`,
      confirmLabel: "Excluir",
      tone: "danger"
    });
    if (!ok) return;
    await api(`/ledger/tags/${tag.id}`, { method: "DELETE" });
    toast.notify("Etiqueta excluída");
    await load();
  }

  if (loading) return <Loading />;

  const columns: { kind: CategoryKind; title: string; subtitle: string }[] = [
    { kind: "expense", title: "Saídas", subtitle: "Para onde o dinheiro vai" },
    { kind: "income", title: "Entradas", subtitle: "De onde o dinheiro vem" }
  ];

  return (
    <>
      <SectionHeading title="Categorias" subtitle="Categorias planas e etiquetas livres">
        <Button icon={Plus} onClick={() => setEditing({ kind: "expense", color: "#4f8ff7" })}>
          Nova categoria
        </Button>
      </SectionHeading>

      <div className="fin-columns">
        {columns.map((column) => {
          const items = categories.filter((category) => category.kind === column.kind);
          return (
            <Panel key={column.kind} title={column.title} subtitle={column.subtitle}>
              {items.length === 0 && <Empty icon={Tags} text="Nenhuma categoria." />}
              <ul className="fin-list">
                {items.map((category) => (
                  <li key={category.id}>
                    <button className="fin-link" onClick={() => setEditing(category)}>
                      <ColorDot color={category.color} />
                      {category.name}
                    </button>
                    <span className="fin-list-meta">
                      {/* Sem orçamento não mostra placeholder nenhum (6.5). */}
                      {category.monthlyBudgetCents != null && (
                        <small className="fin-budget">
                          {moneyFromCents(category.monthlyBudgetCents)}/mês
                        </small>
                      )}
                      <IconButton
                        icon={Archive}
                        label="Arquivar"
                        onClick={() => void archive(category)}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          );
        })}

        <Panel
          title="Etiquetas"
          subtitle="Cortes transversais, múltiplos por lançamento"
          action={
            <Button variant="ghost" icon={Plus} onClick={() => setEditingTag({ color: "#8b949e" })}>
              Nova
            </Button>
          }
        >
          {tags.length === 0 && <Empty icon={Tags} text="Nenhuma etiqueta." />}
          <ul className="fin-list">
            {tags.map((tag) => (
              <li key={tag.id}>
                <button className="fin-link" onClick={() => setEditingTag(tag)}>
                  <ColorDot color={tag.color} />
                  {tag.name}
                </button>
                <IconButton icon={Archive} label="Excluir" onClick={() => void removeTag(tag)} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {editing && (
        <CategoryDrawer
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      {editingTag && (
        <TagDrawer
          initial={editingTag}
          onClose={() => setEditingTag(null)}
          onSaved={async () => {
            setEditingTag(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function CategoryDrawer({
  initial,
  onClose,
  onSaved
}: {
  initial: Draft;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(initial.kind ?? "expense");
  const [color, setColor] = useState(initial.color ?? "#4f8ff7");
  const [budget, setBudget] = useState(
    initial.monthlyBudgetCents != null ? centsToInput(initial.monthlyBudgetCents) : ""
  );
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    // Campo vazio significa "sem orçamento", não zero.
    const budgetCents = budget.trim() === "" ? null : parseCurrencyInput(budget);
    if (budget.trim() !== "" && budgetCents == null) {
      toast.notify("Orçamento inválido", "error");
      return;
    }
    setSaving(true);
    try {
      const body = { name, kind, color, monthlyBudgetCents: budgetCents };
      if (initial.id) {
        await api(`/ledger/categories/${initial.id}`, {
          method: "PUT",
          body: JSON.stringify(body)
        });
      } else {
        await api("/ledger/categories", { method: "POST", body: JSON.stringify(body) });
      }
      toast.notify("Categoria salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={initial.id ? "Editar categoria" : "Nova categoria"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="category-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="category-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            placeholder="Ex.: Mercado"
          />
        </Field>
        <Field label="Tipo">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as CategoryKind)}
            disabled={Boolean(initial.id)}
          >
            <option value="expense">Saída</option>
            <option value="income">Entrada</option>
          </select>
        </Field>
        <Field label="Orçamento mensal" hint="Opcional. Vazio significa sem orçamento.">
          <input
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
            inputMode="decimal"
            placeholder="Sem orçamento"
          />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}

function TagDrawer({
  initial,
  onClose,
  onSaved
}: {
  initial: Partial<TagRecord>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial.name ?? "");
  const [color, setColor] = useState(initial.color ?? "#8b949e");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const body = { name, color };
      if (initial.id) {
        await api(`/ledger/tags/${initial.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await api("/ledger/tags", { method: "POST", body: JSON.stringify(body) });
      }
      toast.notify("Etiqueta salva");
      await onSaved();
    } catch (error) {
      toast.notify(error instanceof Error ? error.message : "Falha ao salvar", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={initial.id ? "Editar etiqueta" : "Nova etiqueta"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} type="submit" form="tag-form" disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </>
      }
    >
      <form id="tag-form" className="stack" onSubmit={submit}>
        <Field label="Nome">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            required
            placeholder="Ex.: viagem"
          />
        </Field>
        <ColorPicker value={color} onChange={setColor} />
      </form>
    </Drawer>
  );
}
