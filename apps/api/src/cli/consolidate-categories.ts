import "dotenv/config";
import { resolve } from "node:path";
import { createDatabase } from "@projeto41/db";
import { backupDatabase, ensureDatabaseDirectory } from "../backup/backup-service.js";
import { consolidateCategories } from "../maintenance/consolidate-categories.js";

const root = resolve(import.meta.dirname, "../../../..");
const databasePath = resolve(root, process.env.DATABASE_URL ?? "./data/projeto41.sqlite");
const apply = process.argv.includes("--confirm");

ensureDatabaseDirectory(databasePath);
const db = createDatabase(databasePath);
try {
  if (apply) {
    // O WAL fica de fora de uma cópia do arquivo principal: junta tudo antes.
    db.raw.pragma("wal_checkpoint(TRUNCATE)");
    const backup = backupDatabase(databasePath, resolve(root, "backups"));
    console.log(`Backup: ${backup}`);
  }
  const report = consolidateCategories(db.raw, { apply });
  console.log(JSON.stringify({ mode: apply ? "aplicado" : "dry-run", ...report }, null, 2));
  if (!apply) console.log("\nNada foi gravado. Rode de novo com --confirm para aplicar.");
} finally {
  db.close();
}
