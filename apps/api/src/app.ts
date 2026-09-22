import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import Fastify from "fastify";
import type { AppDatabase } from "@projeto41/db";
import { z } from "zod";
import type { IconService } from "./icons/icon-service.js";
import type { AttachmentService } from "./attachments/attachment-service.js";
import {
  registerAttachmentsRoutes,
  registerCardsRoutes,
  registerInvestmentCashRoutes,
  registerIconsRoutes,
  registerImportExportRoutes,
  registerLedgerReportsRoutes,
  registerLedgerRoutes,
  registerOperationsRoutes,
  registerPortfolioRoutes,
  registerPositionsRoutes,
  registerPricesRoutes,
  type PriceService,
  type RouteDeps
} from "./routes/index.js";

export type { PriceService } from "./routes/index.js";

/**
 * Monta a aplicacao: infraestrutura aqui, rotas nos plugins por recurso.
 *
 * Nenhuma rota vive neste arquivo alem do health check — ele cuida de CORS,
 * parsers, upload, error handler, estaticos e registro dos plugins (D27).
 */
export function buildApp({
  db,
  priceService,
  iconService,
  attachmentService,
  webRoot,
  databaseFile
}: {
  db: AppDatabase;
  priceService: PriceService;
  iconService?: IconService;
  attachmentService?: AttachmentService;
  webRoot?: string;
  databaseFile?: string;
}) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: /^http:\/\/127\.0\.0\.1(?::\d+)?$/ });
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });
  // O limite padrao de 1 MiB corta foto de celular silenciosamente (R-06).
  app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
  if (webRoot) {
    app.register(staticPlugin, {
      root: webRoot,
      index: ["index.html"]
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Dados invalidos", details: error.flatten() });
    }
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "Erro interno" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  const deps: RouteDeps = { db, priceService, iconService, attachmentService, databaseFile };
  registerIconsRoutes(app, deps);
  registerPortfolioRoutes(app, deps);
  registerOperationsRoutes(app, deps);
  registerPositionsRoutes(app, deps);
  registerPricesRoutes(app, deps);
  registerLedgerRoutes(app, deps);
  registerLedgerReportsRoutes(app, deps);
  registerCardsRoutes(app, deps);
  registerInvestmentCashRoutes(app, deps);
  registerAttachmentsRoutes(app, deps);
  registerImportExportRoutes(app, deps);

  return app;
}
