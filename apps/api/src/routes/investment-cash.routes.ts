import { z } from "zod";
import { readCashSettings, writeCashSettings } from "../services/investment-cash-service.js";
import type { RoutePlugin } from "./index.js";

const settingsSchema = z.object({
  autoDebit: z.boolean(),
  defaultAccountId: z.number().int().positive().nullable(),
  cryptoAccountId: z.number().int().positive().nullable(),
  b3AccountId: z.number().int().positive().nullable()
});

export const registerInvestmentCashRoutes: RoutePlugin = (app, { db }) => {
  app.get("/api/investments/cash-settings", async () => readCashSettings(db));

  app.put("/api/investments/cash-settings", async (request, reply) => {
    const settings = settingsSchema.parse(request.body);

    const kindOf = (id: number | null) =>
      id == null
        ? null
        : ((db.raw.prepare("SELECT kind FROM accounts WHERE id = ?").get(id) as
            | { kind: string }
            | undefined)?.kind ?? null);

    // As contas de destino precisam ser de investimento; sem isso o dinheiro
    // sairia do banco e entraria numa conta que conta duas vezes no patrimonio.
    for (const [label, id] of [
      ["cripto", settings.cryptoAccountId],
      ["B3", settings.b3AccountId]
    ] as const) {
      if (id != null && kindOf(id) !== "investment") {
        return reply
          .status(400)
          .send({ error: `A conta de destino de ${label} precisa ser do tipo investimento` });
      }
    }
    // Comprar acao no cartao nao e um caso que este app modela.
    if (kindOf(settings.defaultAccountId) === "credit_card") {
      return reply.status(400).send({ error: "A conta padrao nao pode ser um cartao de credito" });
    }

    writeCashSettings(db, settings);
    return { ok: true, settings: readCashSettings(db) };
  });
};
