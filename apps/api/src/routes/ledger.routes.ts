import {
  accountSchema,
  categorySchema,
  entryFilterSchema,
  entrySchema,
  entryTargetFlagSchema,
  seriesScopeSchema,
  personSchema,
  placeSchema,
  tagSchema,
  transferSchema
} from "@projeto41/contracts";
import { z } from "zod";
import type { RoutePlugin } from "./index.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Rotas do livro-caixa.
 *
 * Convencao do app: toda mutacao devolve o agregado recalculado
 * (`{ ok: true, balances }`) para o frontend atualizar numa ida so. Mensagens de
 * erro em portugues sem acento; `LedgerError` carrega `statusCode` e o error
 * handler global de `app.ts` ja o traduz.
 */
export const registerLedgerRoutes: RoutePlugin = (app, { db }) => {
  const ledger = db.ledger;
  const balances = () => ledger.balances.consolidated();

  // Pessoas -----------------------------------------------------------------
  app.get("/api/ledger/people", async () => ledger.people.list());
  app.post("/api/ledger/people", async (request, reply) => {
    const id = ledger.people.create(personSchema.parse(request.body));
    return reply.status(201).send({ id, people: ledger.people.list() });
  });
  app.put("/api/ledger/people/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.people.update(id, personSchema.parse(request.body));
    return { ok: true, people: ledger.people.list() };
  });
  app.delete("/api/ledger/people/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const removed = ledger.people.remove(id);
    return { ok: true, archived: removed === 0, people: ledger.people.list() };
  });

  // Contas ------------------------------------------------------------------
  app.get("/api/ledger/accounts", async (request) => {
    const query = z
      .object({ includeArchived: z.coerce.boolean().optional() })
      .parse(request.query);
    return ledger.accounts.list({ includeArchived: query.includeArchived });
  });
  app.post("/api/ledger/accounts", async (request, reply) => {
    const id = ledger.accounts.create(accountSchema.parse(request.body));
    return reply.status(201).send({ id, balances: balances() });
  });
  app.put("/api/ledger/accounts/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.accounts.update(id, accountSchema.parse(request.body));
    return { ok: true, balances: balances() };
  });
  app.delete("/api/ledger/accounts/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const removed = ledger.accounts.remove(id);
    return { ok: true, archived: removed === 0, balances: balances() };
  });

  // Categorias --------------------------------------------------------------
  app.get("/api/ledger/categories", async (request) => {
    const query = z
      .object({
        kind: z.enum(["income", "expense"]).optional(),
        includeArchived: z.coerce.boolean().optional()
      })
      .parse(request.query);
    return ledger.categories.list(query);
  });
  app.post("/api/ledger/categories", async (request, reply) => {
    const id = ledger.categories.create(categorySchema.parse(request.body));
    return reply.status(201).send({ id, categories: ledger.categories.list() });
  });
  app.put("/api/ledger/categories/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.categories.update(id, categorySchema.parse(request.body));
    return { ok: true, categories: ledger.categories.list() };
  });
  app.delete("/api/ledger/categories/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const removed = ledger.categories.remove(id);
    return {
      ok: true,
      archived: removed === 0,
      categories: ledger.categories.list({ includeArchived: true })
    };
  });

  // Etiquetas ---------------------------------------------------------------
  app.get("/api/ledger/tags", async () => ledger.tags.list());
  app.post("/api/ledger/tags", async (request, reply) => {
    const id = ledger.tags.create(tagSchema.parse(request.body));
    return reply.status(201).send({ id, tags: ledger.tags.list() });
  });
  app.put("/api/ledger/tags/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.tags.update(id, tagSchema.parse(request.body));
    return { ok: true, tags: ledger.tags.list() };
  });
  app.delete("/api/ledger/tags/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.tags.remove(id);
    return { ok: true, tags: ledger.tags.list() };
  });

  // Locais ------------------------------------------------------------------
  app.get("/api/ledger/places", async (request) => {
    const { search } = z.object({ search: z.string().trim().max(120).optional() }).parse(
      request.query
    );
    return ledger.places.list(search);
  });
  app.post("/api/ledger/places", async (request, reply) => {
    const id = ledger.places.create(placeSchema.parse(request.body));
    return reply.status(201).send({ id, place: ledger.places.get(id) });
  });
  app.put("/api/ledger/places/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    ledger.places.update(id, placeSchema.parse(request.body));
    return { ok: true, place: ledger.places.get(id) };
  });
  app.delete("/api/ledger/places/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const removed = ledger.places.remove(id);
    return { ok: true, kept: removed === 0 };
  });

  // Lancamentos -------------------------------------------------------------
  app.get("/api/ledger/entries", async (request) =>
    ledger.entries.list(entryFilterSchema.parse(request.query))
  );

  app.get("/api/ledger/entries/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const entry = ledger.entries.get(id);
    if (!entry) return reply.status(404).send({ error: "Lancamento nao encontrado" });
    return entry;
  });

  app.post("/api/ledger/entries", async (request, reply) => {
    const id = ledger.entries.create(entrySchema.parse(request.body));
    return reply.status(201).send({ id, entry: ledger.entries.get(id), balances: balances() });
  });

  /**
   * `scope` so tem efeito quando o lancamento pertence a um plano de parcelas.
   *
   * Ele vale para campos **nao monetarios** (descricao, categoria, local,
   * pessoa, etiquetas). **Valor e sempre `one`**: alterar o valor da serie
   * inteira quebraria a invariante de soma da secao 4.2, entao a combinacao e
   * recusada em vez de aceita pela metade.
   */
  app.put("/api/ledger/entries/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { scope } = z
      .object({ scope: seriesScopeSchema.default("one") })
      .parse(request.query);
    const existing = ledger.entries.get(id);
    if (!existing) return reply.status(404).send({ error: "Lancamento nao encontrado" });

    const input = entrySchema.parse(request.body);
    if (scope !== "one" && input.amountCents !== existing.amountCents) {
      return reply.status(400).send({
        error: "Alterar valor so vale para esta parcela: use scope=one"
      });
    }

    ledger.entries.update(id, input);

    if (scope !== "one" && existing.installmentPlanId != null) {
      const siblings = ledger.entries
        .listAll({ installmentPlanId: existing.installmentPlanId, pageSize: 500 })
        .filter((row) => row.id !== id)
        .filter((row) =>
          scope === "all" ? true : (row.installmentNumber ?? 0) > (existing.installmentNumber ?? 0)
        );
      for (const sibling of siblings) {
        ledger.entries.update(sibling.id, {
          ...input,
          // Cada irmao mantem o proprio valor, data e numero: so os campos
          // descritivos viajam pela serie.
          amountCents: sibling.amountCents,
          date: sibling.date,
          accountId: sibling.accountId,
          statementMonth: sibling.statementMonth
        });
      }
    }

    return { ok: true, entry: ledger.entries.get(id), balances: balances() };
  });

  app.delete("/api/ledger/entries/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.entries.get(id)) {
      return reply.status(404).send({ error: "Lancamento nao encontrado" });
    }
    ledger.entries.remove(id);
    return { ok: true, balances: balances() };
  });

  /** Excecao manual de 6.4: a unica porta para sobrescrever o flag derivado. */
  app.patch("/api/ledger/entries/:id/target", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.entries.get(id)) {
      return reply.status(404).send({ error: "Lancamento nao encontrado" });
    }
    const { countsTowardTarget } = entryTargetFlagSchema.parse(request.body);
    ledger.entries.setCountsTowardTarget(id, countsTowardTarget);
    return { ok: true, entry: ledger.entries.get(id) };
  });

  app.post("/api/ledger/entries/status", async (request) => {
    const body = z
      .object({
        ids: z.array(z.number().int().positive()).min(1),
        status: z.enum(["pending", "cleared", "reconciled"])
      })
      .parse(request.body);
    const changed = ledger.entries.setStatus(body.ids, body.status);
    return { ok: true, changed, balances: balances() };
  });

  // Transferencias ----------------------------------------------------------
  app.post("/api/ledger/transfers", async (request, reply) => {
    const result = ledger.entries.createTransfer(transferSchema.parse(request.body));
    return reply.status(201).send({ ...result, balances: balances() });
  });

  // Saldos ------------------------------------------------------------------
  app.get("/api/ledger/balances", async (request) => {
    const query = z
      .object({
        asOf: z.string().date().optional(),
        until: z.string().date().optional(),
        includeArchived: z.coerce.boolean().optional()
      })
      .parse(request.query);
    return ledger.balances.consolidated(query);
  });
};
