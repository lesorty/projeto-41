import {
  entryFilterSchema,
  goalAccrueSchema,
  goalAllocationSchema,
  goalCreateSchema,
  goalDepositSchema,
  goalMarkSchema,
  goalUpdateSchema,
  goalWithdrawalSchema
} from "@projeto41/contracts";
import { z } from "zod";
import { purgeGoal } from "../services/purge-service.js";
import type { RoutePlugin } from "./index.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Caixinhas.
 *
 * Toda resposta com rendimento traz **quatro números distintos e rotulados** —
 * realizado, até quando, projetado e até quando. Não existe campo único de
 * "rendimento": se existisse, alguém somaria projeção com realizado na primeira
 * refatoração.
 */
export const registerGoalsRoutes: RoutePlugin = (app, { db, cdiService }) => {
  const ledger = db.ledger;
  const balances = () => ledger.balances.consolidated();

  /**
   * Mantém a série quente sem transformar a rota em refém da rede: o serviço
   * nunca lança e tem limite de 15 minutos.
   */
  async function warmCdi() {
    if (!cdiService) return;
    await cdiService.ensureRange("2018-01-01", today()).catch(() => undefined);
  }

  app.get("/api/ledger/goals", async (request) => {
    const { includeArchived } = z
      .object({ includeArchived: z.coerce.boolean().optional() })
      .parse(request.query);
    await warmCdi();
    return ledger.goals
      .list(includeArchived)
      .map((goal) => ledger.goals.progress(goal.id, today()));
  });

  app.get("/api/ledger/goals/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    await warmCdi();
    return {
      goal: ledger.goals.progress(id, today()),
      cdi: cdiService ? await cdiService.status() : null
    };
  });

  /** Mesmo formato de `GET /api/ledger/entries`, para reaproveitar a tabela. */
  app.get("/api/ledger/goals/:id/entries", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const filter = entryFilterSchema.parse(request.query);
    return ledger.entries.list({ ...filter, goalId: id, accountId: goal.accountId ?? undefined });
  });

  app.post("/api/ledger/goals", async (request, reply) => {
    const id = ledger.goals.create(goalCreateSchema.parse(request.body));
    return reply
      .status(201)
      .send({ id, goal: ledger.goals.progress(id, today()), balances: balances() });
  });

  app.put("/api/ledger/goals/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    // O contrato não tem `mode`, e o repositório o ignora mesmo que chegue.
    ledger.goals.update(id, goalUpdateSchema.parse(request.body));
    return { ok: true, goal: ledger.goals.progress(id, today()) };
  });

  app.delete("/api/ledger/goals/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    // `?purge=1`: exclui de vez, com a conta e os lançamentos da caixinha.
    const { purge } = z.object({ purge: z.enum(["1", "true"]).optional() }).parse(request.query);
    if (purge) {
      purgeGoal(db, id);
      return { ok: true, archived: false, balances: balances() };
    }
    const result = ledger.goals.remove(id);
    return { ok: true, archived: !result.removed, balances: balances() };
  });

  app.post("/api/ledger/goals/:id/deposit", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    ledger.goals.deposit(id, goalDepositSchema.parse(request.body));
    return reply
      .status(201)
      .send({ ok: true, goal: ledger.goals.progress(id, today()), balances: balances() });
  });

  app.post("/api/ledger/goals/:id/withdraw", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    ledger.goals.withdraw(id, goalWithdrawalSchema.parse(request.body));
    return reply
      .status(201)
      .send({ ok: true, goal: ledger.goals.progress(id, today()), balances: balances() });
  });

  app.post("/api/ledger/goals/:id/allocate", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    if (goal.mode !== "earmark") {
      return reply
        .status(400)
        .send({ error: "Alocacao so existe em caixinha de marcacao" });
    }
    const body = goalAllocationSchema.parse(request.body);
    const result = ledger.goals.allocate(id, body.entryId, body.amountCents);
    return { ...result, goal: ledger.goals.progress(id, today()) };
  });

  /** Marcação por valor, sem escolher lançamento: o "Movimentar" da marcação. */
  app.post("/api/ledger/goals/:id/mark", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const { amountCents } = goalMarkSchema.parse(request.body);
    const result = ledger.goals.mark(id, amountCents);
    return { ...result, goal: ledger.goals.progress(id, today()), balances: balances() };
  });

  app.post("/api/ledger/goals/:id/deallocate", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const goal = ledger.goals.get(id);
    if (!goal) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    if (goal.mode !== "earmark") {
      return reply.status(400).send({ error: "Alocacao so existe em caixinha de marcacao" });
    }
    const { entryId } = z.object({ entryId: z.number().int().positive() }).parse(request.body);
    ledger.goals.deallocate(id, entryId);
    return { ok: true, goal: ledger.goals.progress(id, today()) };
  });

  app.post("/api/ledger/goals/:id/accrue", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!ledger.goals.get(id)) return reply.status(404).send({ error: "Caixinha nao encontrada" });
    const { through } = goalAccrueSchema.parse(request.body ?? {});
    await warmCdi();
    const result = ledger.goals.accrue(id, through ?? today());
    return { ok: true, ...result, goal: ledger.goals.progress(id, today()) };
  });
};
