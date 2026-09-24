import Database from "better-sqlite3";
import { migrations, runMigrations } from "./migrations/index.js";
import { createLedgerRepositories } from "./repositories/index.js";
import type { Contribution, ManualPosition, Operation } from "@projeto41/contracts";

/**
 * Payload do snapshot, versionado (R-03).
 *
 * - **v1 (legado):** objeto plano de numeros, sem nenhuma chave de metadado.
 * - **v2 (fase 4):** `{ version, classes, totals }`.
 *
 * A deteccao e pela **presenca da chave `version`**, nunca por heuristica sobre
 * os nomes das outras chaves. Nenhuma linha v1 e reescrita: o passado nao tinha
 * caixa e continuara nao tendo.
 */
export type SnapshotPayloadV2 = {
  version: 2;
  classes: Record<string, number>;
  totals: { investments: number; bank: number; liabilities: number };
};

export type SnapshotRecord = {
  date: string;
  totalBrl: number;
  payloadVersion: 1 | 2;
  classes: Record<string, number>;
  totals: SnapshotPayloadV2["totals"] | null;
  priceTimes: Record<string, string>;
  /** Mantido para os consumidores antigos, que leem `payload` como as classes. */
  payload: Record<string, number>;
};

type SnapshotInput = {
  date: string;
  totalBrl: number;
  /**
   * v2 para o que o app grava hoje; o objeto plano continua aceito porque o
   * importador da planilha e os dados de demonstracao gravam patrimonio de
   * antes do controle de caixa, que e v1 por natureza.
   */
  payload: SnapshotPayloadV2 | Record<string, number>;
  priceTimes?: Record<string, string>;
};

export type PriceRecord = {
  symbol: string;
  currency: "BRL" | "USD";
  price: number;
  provider: string;
  marketTime: string | null;
  fetchedAt: string;
  error: string | null;
  // Baseline diário: último preço do dia anterior e o dia (YYYY-MM-DD) a que ele se refere.
  // Gerenciado automaticamente pelo upsert e usado para calcular a variação do dia
  // (atual vs. baseline). Não deve ser preenchido pelos provedores.
  prevPrice?: number | null;
  prevDay?: string | null;
};

export type CryptoAsset = {
  symbol: string;
  slug: string;
  name: string;
};

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(path: string) {
  const raw = new Database(path);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  // O `migrate()` legado cuida das tabelas de investimento e roda primeiro; o
  // runner versionado (D26) cuida de tudo que veio depois da fase 0.
  migrate(raw);
  runMigrations(raw, migrations);

  return {
    raw,
    close: () => raw.close(),
    transaction: <T>(callback: () => T) => raw.transaction(callback)(),
    // Modulo de financas (centavos inteiros), separado das tabelas legadas de
    // investimento que seguem em REAL logo abaixo (D19).
    ledger: createLedgerRepositories(raw),
    operations: {
      list: (portfolio?: string) =>
        raw
          .prepare(
            `SELECT id, portfolio, type, asset, date, quantity, total, currency, notes,
                    account_id AS accountId
             FROM operations
             ${portfolio ? "WHERE portfolio = ?" : ""}
             ORDER BY date DESC, id DESC`
          )
          .all(...(portfolio ? [portfolio] : [])) as (Operation & { id: number })[],
      create: (operation: Operation) => {
        const result = raw
          .prepare(
            `INSERT INTO operations
             (portfolio, type, asset, date, quantity, total, currency, notes, account_id)
             VALUES (@portfolio, @type, @asset, @date, @quantity, @total, @currency, @notes,
                     @accountId)`
          )
          .run({ notes: null, accountId: null, ...operation });
        return Number(result.lastInsertRowid);
      },
      update: (id: number, operation: Operation) =>
        raw
          .prepare(
            `UPDATE operations SET portfolio=@portfolio, type=@type, asset=@asset,
             date=@date, quantity=@quantity, total=@total, currency=@currency, notes=@notes,
             account_id=@accountId
             WHERE id=@id`
          )
          .run({ notes: null, accountId: null, ...operation, id }).changes,
      remove: (id: number) => raw.prepare("DELETE FROM operations WHERE id = ?").run(id).changes,
      clear: (portfolio?: string) =>
        raw
          .prepare(`DELETE FROM operations ${portfolio ? "WHERE portfolio = ?" : ""}`)
          .run(...(portfolio ? [portfolio] : [])).changes
    },
    // Keyed by symbol: the asset identity across operations/prices/dividends.
    // Assumes one coin per ticker; re-picking a different coin for an existing
    // symbol overwrites its slug by design.
    cryptoAssets: {
      list: () =>
        raw
          .prepare("SELECT symbol, slug, name FROM crypto_assets ORDER BY symbol")
          .all() as CryptoAsset[],
      get: (symbol: string) =>
        raw
          .prepare("SELECT symbol, slug, name FROM crypto_assets WHERE symbol = ?")
          .get(symbol) as CryptoAsset | undefined,
      upsert: (asset: CryptoAsset) =>
        raw
          .prepare(
            `INSERT INTO crypto_assets(symbol, slug, name) VALUES (@symbol, @slug, @name)
             ON CONFLICT(symbol) DO UPDATE SET slug=excluded.slug, name=excluded.name`
          )
          .run(asset)
    },
    positions: {
      list: () =>
        raw
          .prepare(
            `SELECT id, category, name, invested, current_value AS currentValue,
             currency, notes FROM manual_positions ORDER BY category, id`
          )
          .all() as (ManualPosition & { id: number })[],
      upsert: (position: ManualPosition) => {
        const values = { notes: null, ...position };
        if (position.id) {
          raw
            .prepare(
              `UPDATE manual_positions SET category=@category, name=@name, invested=@invested,
               current_value=@currentValue, currency=@currency, notes=@notes WHERE id=@id`
            )
            .run(values);
          return position.id;
        }
        const result = raw
          .prepare(
            `INSERT INTO manual_positions
             (category, name, invested, current_value, currency, notes)
             VALUES (@category, @name, @invested, @currentValue, @currency, @notes)`
          )
          .run(values);
        return Number(result.lastInsertRowid);
      },
      remove: (id: number) =>
        raw.prepare("DELETE FROM manual_positions WHERE id=?").run(id).changes
    },
    dividends: {
      list: () =>
        raw.prepare("SELECT asset, amount FROM dividends ORDER BY asset").all() as {
          asset: string;
          amount: number;
        }[],
      set: (asset: string, amount: number) =>
        raw
          .prepare(
            `INSERT INTO dividends(asset, amount) VALUES (?, ?)
             ON CONFLICT(asset) DO UPDATE SET amount=excluded.amount`
          )
          .run(asset, amount)
    },
    contributions: {
      list: () =>
        raw
          .prepare("SELECT id, date, amount, notes FROM contributions ORDER BY date")
          .all() as (Contribution & { id: number })[],
      create: (entry: Contribution) =>
        Number(
          raw
            .prepare(
              "INSERT INTO contributions(date, amount, notes) VALUES (@date, @amount, @notes)"
            )
            .run({ notes: null, ...entry }).lastInsertRowid
        ),
      update: (id: number, entry: Contribution) =>
        raw
          .prepare(
            "UPDATE contributions SET date=@date, amount=@amount, notes=@notes WHERE id=@id"
          )
          .run({ notes: null, ...entry, id }).changes,
      remove: (id: number) => raw.prepare("DELETE FROM contributions WHERE id=?").run(id).changes
    },
    prices: {
      list: () =>
        raw
          .prepare(
            `SELECT symbol, currency, price, provider, market_time AS marketTime,
             fetched_at AS fetchedAt, error,
             prev_price AS prevPrice, prev_day AS prevDay FROM prices ORDER BY symbol`
          )
          .all() as PriceRecord[],
      get: (symbol: string) =>
        raw
          .prepare(
            `SELECT symbol, currency, price, provider, market_time AS marketTime,
             fetched_at AS fetchedAt, error,
             prev_price AS prevPrice, prev_day AS prevDay FROM prices WHERE symbol=?`
          )
          .get(symbol) as PriceRecord | undefined,
      upsert: (price: PriceRecord) =>
        raw
          .prepare(
            // prev_price/prev_day = "fechamento" do dia anterior: quando chega um preço de
            // um dia mais novo que o último gravado, o preço antigo vira a referência do dia.
            `INSERT INTO prices(symbol, currency, price, provider, market_time, fetched_at, error,
               prev_price, prev_day)
             VALUES (@symbol,@currency,@price,@provider,@marketTime,@fetchedAt,@error,
               @price,@day)
             ON CONFLICT(symbol) DO UPDATE SET currency=excluded.currency, price=excluded.price,
             provider=excluded.provider, market_time=excluded.market_time,
             fetched_at=excluded.fetched_at, error=excluded.error,
             prev_price = CASE WHEN substr(prices.fetched_at, 1, 10) < @day
               THEN prices.price ELSE prices.prev_price END,
             prev_day = CASE WHEN substr(prices.fetched_at, 1, 10) < @day
               THEN substr(prices.fetched_at, 1, 10) ELSE prices.prev_day END`
          )
          .run({
            symbol: price.symbol,
            currency: price.currency,
            price: price.price,
            provider: price.provider,
            marketTime: price.marketTime,
            fetchedAt: price.fetchedAt,
            error: price.error,
            day: price.fetchedAt.slice(0, 10)
          }),
      markError: (symbol: string, error: string, fetchedAt: string) =>
        raw
          .prepare("UPDATE prices SET error=?, fetched_at=? WHERE symbol=?")
          .run(error, fetchedAt, symbol)
    },
    targets: {
      list: () =>
        raw.prepare("SELECT category, weight FROM allocation_targets ORDER BY category").all() as {
          category: string;
          weight: number;
        }[],
      set: (category: string, weight: number) =>
        raw
          .prepare(
            `INSERT INTO allocation_targets(category, weight) VALUES (?,?)
             ON CONFLICT(category) DO UPDATE SET weight=excluded.weight`
          )
          .run(category, weight)
    },
    settings: {
      get: (key: string) =>
        (
          raw.prepare("SELECT value FROM settings WHERE key=?").get(key) as
            | { value: string }
            | undefined
        )?.value,
      set: (key: string, value: string) =>
        raw
          .prepare(
            `INSERT INTO settings(key,value) VALUES (?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`
          )
          .run(key, value)
    },
    snapshots: {
      list: () =>
        (
          raw
            .prepare(
              `SELECT date, total_brl AS totalBrl, payload, price_times AS priceTimes
               FROM snapshots ORDER BY date`
            )
            .all() as {
            date: string;
            totalBrl: number;
            payload: string;
            priceTimes: string;
          }[]
        ).map((row): SnapshotRecord => {
          const parsed = JSON.parse(row.payload) as Record<string, unknown>;
          const isV2 = parsed.version === 2;
          const classes = (
            isV2 ? (parsed.classes ?? {}) : parsed
          ) as Record<string, number>;
          return {
            date: row.date,
            totalBrl: row.totalBrl,
            payloadVersion: isV2 ? 2 : 1,
            classes,
            totals: isV2 ? (parsed.totals as SnapshotPayloadV2["totals"]) : null,
            priceTimes: JSON.parse(row.priceTimes) as Record<string, string>,
            payload: classes
          };
        }),
      upsert: (snapshot: SnapshotInput) =>
        raw
          .prepare(
            `INSERT INTO snapshots(date,total_brl,payload,price_times)
             VALUES (@date,@totalBrl,@payload,@priceTimes)
             ON CONFLICT(date) DO UPDATE SET total_brl=excluded.total_brl,
             payload=excluded.payload, price_times=excluded.price_times`
          )
          .run({
            ...snapshot,
            payload: JSON.stringify(snapshot.payload),
            priceTimes: JSON.stringify(snapshot.priceTimes ?? {})
          })
    },
    // Vinculo 1-1 entre operacao de investimento e a transferencia que ela
    // gerou no livro. Saber isso numa consulta e o que permite a interface
    // distinguir operacao com e sem movimento de caixa.
    operationLinks: {
      get: (operationId: number) =>
        raw
          .prepare(
            `SELECT operation_id AS operationId, transfer_id AS transferId,
                    created_at AS createdAt
             FROM operation_transfers WHERE operation_id = ?`
          )
          .get(operationId) as
          | { operationId: number; transferId: number; createdAt: string }
          | undefined,
      set: (operationId: number, transferId: number) =>
        raw
          .prepare(
            `INSERT INTO operation_transfers(operation_id, transfer_id, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT(operation_id) DO UPDATE SET transfer_id = excluded.transfer_id`
          )
          .run(operationId, transferId, new Date().toISOString()),
      remove: (operationId: number) =>
        raw.prepare("DELETE FROM operation_transfers WHERE operation_id = ?").run(operationId)
          .changes,
      /** O lancamento que converte caixa da corretora em ativo (ou de volta). */
      getCash: (operationId: number) =>
        raw
          .prepare(
            `SELECT operation_id AS operationId, entry_id AS entryId
             FROM operation_cash_entries WHERE operation_id = ?`
          )
          .get(operationId) as { operationId: number; entryId: number } | undefined,
      setCash: (operationId: number, entryId: number) =>
        raw
          .prepare(
            `INSERT INTO operation_cash_entries(operation_id, entry_id, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT(operation_id) DO UPDATE SET entry_id = excluded.entry_id`
          )
          .run(operationId, entryId, new Date().toISOString()),
      removeCash: (operationId: number) =>
        raw.prepare("DELETE FROM operation_cash_entries WHERE operation_id = ?").run(operationId)
          .changes,
      /** Estado do vinculo de cada operacao, para a listagem. */
      listByOperations: (ids: number[]) => {
        if (ids.length === 0) return [];
        return raw
          .prepare(
            `SELECT ot.operation_id AS operationId, ot.transfer_id AS transferId,
                    e.status AS transferStatus, a.name AS accountName
             FROM operation_transfers ot
             JOIN transfers t ON t.id = ot.transfer_id
             JOIN entries e ON e.id = t.from_entry_id
             JOIN accounts a ON a.id = e.account_id
             WHERE ot.operation_id IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as {
          operationId: number;
          transferId: number;
          transferStatus: string;
          accountName: string;
        }[];
      }
    },
    imports: {
      has: (fingerprint: string) =>
        Boolean(raw.prepare("SELECT 1 FROM imports WHERE fingerprint=?").get(fingerprint)),
      record: (fingerprint: string, report: unknown) =>
        raw
          .prepare("INSERT INTO imports(fingerprint, imported_at, report) VALUES (?,?,?)")
          .run(fingerprint, new Date().toISOString(), JSON.stringify(report))
    }
  };
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio TEXT NOT NULL CHECK(portfolio IN ('crypto','b3')),
      type TEXT NOT NULL CHECK(type IN ('buy','sell')),
      asset TEXT NOT NULL,
      date TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity > 0),
      total REAL NOT NULL CHECK(total >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('BRL','USD')),
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS crypto_assets (
      symbol TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manual_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      invested REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('BRL','USD')),
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS dividends (
      asset TEXT PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT
    );
    CREATE TABLE IF NOT EXISTS prices (
      symbol TEXT PRIMARY KEY,
      currency TEXT NOT NULL,
      price REAL NOT NULL,
      provider TEXT NOT NULL,
      market_time TEXT,
      fetched_at TEXT NOT NULL,
      error TEXT,
      prev_price REAL,
      prev_day TEXT
    );
    CREATE TABLE IF NOT EXISTS allocation_targets (
      category TEXT PRIMARY KEY,
      weight REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      date TEXT PRIMARY KEY,
      total_brl REAL NOT NULL,
      payload TEXT NOT NULL,
      price_times TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS imports (
      fingerprint TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL,
      report TEXT NOT NULL
    );
  `);

  // Colunas adicionadas após o release inicial: garantem upgrade de bancos existentes.
  ensureColumn(db, "prices", "prev_price", "REAL");
  ensureColumn(db, "prices", "prev_day", "TEXT");

  const targetCount = db
    .prepare("SELECT COUNT(*) AS count FROM allocation_targets")
    .get() as { count: number };
  if (targetCount.count === 0) {
    db.exec(`
      INSERT INTO allocation_targets(category, weight) VALUES
        ('bitcoin', 0.25),
        ('shitcoins', 0.05),
        ('dolar', 0.10),
        ('caixa_br', 0.10),
        ('bolsa_brasil', 0.25),
        ('renda_fixa', 0.15),
        ('acoes_globais', 0.10);
    `);
  }
}

function ensureColumn(db: Database.Database, table: string, column: string, type: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export * from "./repositories/index.js";
export * from "./migrations/index.js";
export * from "./testing.js";
