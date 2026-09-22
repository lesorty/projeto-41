import { operationSchema } from "@projeto41/contracts";
import { buildOperationsCsv, parseOperationsCsv } from "../export/operations-csv.js";
import { buildLedgerCsv } from "../export/ledger-csv.js";
import { buildPortfolios } from "../services/portfolio-service.js";
import type { RoutePlugin } from "./index.js";
import { entryFilterSchema } from "@projeto41/contracts";

export const registerImportExportRoutes: RoutePlugin = (app, { db, priceService, databaseFile }) => {
  app.get("/api/export/operations.csv", async (_request, reply) => {
    const operations = db.operations.list("crypto");
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="operacoes-cripto.csv"`);
    return buildOperationsCsv(operations);
  });

  app.post("/api/import/operations.csv", async (request, reply) => {
    const text = typeof request.body === "string" ? request.body : "";
    const operations = parseOperationsCsv(text).map((row) => operationSchema.parse(row));
    if (operations.length === 0) {
      return reply.status(400).send({ error: "Nenhuma operação encontrada no CSV" });
    }
    for (const operation of operations) db.operations.create(operation);
    if (priceService.ensureCryptoPrice) {
      const assets = [...new Set(operations.map((operation) => operation.asset))];
      for (const asset of assets) await priceService.ensureCryptoPrice(asset);
    }
    return reply.status(201).send({ imported: operations.length, portfolios: buildPortfolios(db) });
  });

  /** Exporta exatamente o que esta na tela: mesmos filtros da listagem. */
  app.get("/api/ledger/export.csv", async (request, reply) => {
    const filter = entryFilterSchema.parse(request.query);
    const rows = db.ledger.entries.listAll(filter);
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="lancamentos.csv"`);
    return buildLedgerCsv(rows);
  });

  app.get("/api/export", async (_request, reply) => {
    reply.header("Content-Disposition", `attachment; filename="projeto41-export.json"`);
    return {
      exportedAt: new Date().toISOString(),
      operations: db.operations.list(),
      positions: db.positions.list(),
      dividends: db.dividends.list(),
      contributions: db.contributions.list(),
      targets: db.targets.list(),
      prices: db.prices.list(),
      snapshots: db.snapshots.list(),
      ledger: {
        people: db.ledger.people.list(),
        accounts: db.ledger.accounts.list({ includeArchived: true }),
        categories: db.ledger.categories.list({ includeArchived: true }),
        tags: db.ledger.tags.list(),
        places: db.ledger.places.list(),
        entries: db.ledger.entries.listAll()
      }
    };
  });

  /**
   * Copia consistente do SQLite pela API `backup()` do better-sqlite3. Copiar o
   * arquivo com o processo rodando em WAL devolve um banco corrompido, entao
   * nunca use `fs.copyFile` aqui.
   */
  app.get("/api/backup", async (_request, reply) => {
    if (!databaseFile) {
      return reply.status(503).send({ error: "Backup indisponivel neste modo" });
    }
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { readFile, unlink } = await import("node:fs/promises");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = join(tmpdir(), `projeto41-backup-${stamp}.sqlite`);
    try {
      await db.raw.backup(target);
      const data = await readFile(target);
      reply.header("Content-Type", "application/x-sqlite3");
      reply.header("Content-Disposition", `attachment; filename="projeto41-${stamp}.sqlite"`);
      return reply.send(data);
    } finally {
      await unlink(target).catch(() => {});
    }
  });
};
