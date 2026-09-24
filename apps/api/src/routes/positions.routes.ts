import { manualPositionSchema } from "@projeto41/contracts";
import { z } from "zod";
import { removePosition } from "../services/investment-cash-service.js";
import type { RoutePlugin } from "./index.js";

/** Posicoes manuais, metas de alocacao e planejamento: tudo cadastro do usuario. */
export const registerPositionsRoutes: RoutePlugin = (app, { db }) => {
  app.get("/api/positions", async () => db.positions.list());
  app.post("/api/positions", async (request, reply) => {
    const id = db.positions.upsert(manualPositionSchema.parse(request.body));
    return reply.status(201).send({ id });
  });
  app.put("/api/positions/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    db.positions.upsert({ ...manualPositionSchema.parse(request.body), id });
    return { ok: true };
  });
  app.delete("/api/positions/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    removePosition(db, id);
    return { ok: true };
  });

  app.get("/api/allocation", async () => db.targets.list());
  app.put("/api/allocation/:category", async (request) => {
    const { category } = z.object({ category: z.string().min(1) }).parse(request.params);
    const { weight } = z.object({ weight: z.number().min(0).max(1) }).parse(request.body);
    db.targets.set(category, weight);
    return { ok: true };
  });

  app.get("/api/planning", async () => ({
    initialCapital: Number(db.settings.get("initialCapital") ?? 0),
    monthlyContribution: Number(db.settings.get("monthlyContribution") ?? 0),
    monthlyReturnPercent: Number(db.settings.get("monthlyReturnPercent") ?? 0),
    months: Number(db.settings.get("months") ?? 120),
    annualInflationPercent: Number(db.settings.get("annualInflationPercent") ?? 0),
    initialYear: Number(db.settings.get("initialYear") ?? new Date().getFullYear())
  }));
  app.put("/api/planning", async (request) => {
    const values = z
      .object({
        initialCapital: z.number().nonnegative(),
        monthlyContribution: z.number().nonnegative(),
        monthlyReturnPercent: z.number(),
        months: z.number().int().positive(),
        annualInflationPercent: z.number(),
        initialYear: z.number().int()
      })
      .parse(request.body);
    for (const [key, value] of Object.entries(values)) db.settings.set(key, String(value));
    return { ok: true };
  });

  app.get("/api/history", async () => db.snapshots.list());
};
