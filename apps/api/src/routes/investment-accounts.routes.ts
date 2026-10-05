import { investmentAccountSchema } from "@projeto41/contracts";
import { z } from "zod";
import type { RoutePlugin } from "./index.js";

/**
 * Contas do módulo de investimentos. A escolhida chega em cada requisição pelo
 * cabeçalho `x-investment-account` (ver `app.ts`); aqui só se lista, cria e
 * renomeia.
 */
export const registerInvestmentAccountsRoutes: RoutePlugin = (app, { db }) => {
  app.get("/api/investment-accounts", async () => db.investmentAccounts.list());

  app.post("/api/investment-accounts", async (request, reply) => {
    const { name } = investmentAccountSchema.parse(request.body);
    const id = db.investmentAccounts.create(name);
    return reply.status(201).send(db.investmentAccounts.get(id));
  });

  app.put("/api/investment-accounts/:id", async (request) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const { name } = investmentAccountSchema.parse(request.body);
    if (!db.investmentAccounts.rename(id, name)) {
      throw Object.assign(new Error("Conta nao encontrada"), { statusCode: 404 });
    }
    return db.investmentAccounts.get(id);
  });
};
