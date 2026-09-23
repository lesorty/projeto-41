import { z } from "zod";
import { idSchema, isoDateSchema } from "./ledger.js";

export const importSourceSchema = z.enum(["ofx", "csv", "pdf"]);
export const importBatchStatusSchema = z.enum([
  "awaiting_mapping",
  "review",
  "committed",
  "discarded"
]);
export const importRowStatusSchema = z.enum([
  "new",
  "duplicate",
  "ignored",
  "committed",
  "needs_review"
]);
export const matchReasonSchema = z.enum(["external_id", "content_hash", "fuzzy_amount_date"]);
export const ruleStageSchema = z.enum(["pre", "default"]);
export const ruleModeSchema = z.enum(["auto", "ask"]);
export const ruleConditionOpSchema = z.enum([
  "contains",
  "equals",
  "regex",
  "amount_between",
  "account_is"
]);
export const ruleActionKindSchema = z.enum([
  "set_place",
  "set_category",
  "set_description",
  "set_tag",
  "set_person",
  "ignore"
]);

export const accountIdentityKindSchema = z.enum(["bank_account", "document", "pix_key"]);

/**
 * A contraparte extraida do descritor do banco.
 *
 * O arquivo nunca diz quem e o dono da conta, mas quase sempre diz com quem a
 * transacao foi feita. Estes campos sao o que permite reconhecer uma
 * transferencia interna e o que alimenta o mapeamento destinatario -> local.
 */
export const counterpartySchema = z.object({
  name: z.string().nullable(),
  /** So digitos. CPF mascarado pelo banco vem `null`: mascara nao identifica. */
  document: z.string().nullable(),
  bankId: z.string().nullable(),
  branchId: z.string().nullable(),
  accountNumber: z.string().nullable(),
  bankName: z.string().nullable()
});

/** A saida dos leitores de OFX e de CSV: o unico formato que o resto conhece. */
export const parsedTransactionSchema = z.object({
  lineNo: z.number().int().nonnegative(),
  date: isoDateSchema,
  /** `HH:MM`. Quase sempre sintetica; preservada, nunca gravada em `entries`. */
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  amountCents: z.number().int(),
  rawDescription: z.string(),
  externalId: z.string().optional(),
  trnType: z.string().optional(),
  checkNum: z.string().optional(),
  counterparty: counterpartySchema.optional(),
  installment: z
    .object({
      number: z.number().int().positive(),
      total: z.number().int().positive(),
      uncertain: z.boolean()
    })
    .optional()
});

export const ofxStatementSchema = z.object({
  /** `bank` vira conta corrente; `credit_card` exige conta de cartao (Task 7). */
  envelope: z.enum(["bank", "credit_card"]),
  currency: z.string(),
  accountId: z.string().nullable(),
  bankId: z.string().nullable(),
  branchId: z.string().nullable(),
  accountType: z.string().nullable(),
  institution: z.string().nullable(),
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  closingBalanceCents: z.number().int().nullable(),
  transactions: z.array(parsedTransactionSchema)
});

export const csvFieldSchema = z.enum([
  "date",
  "amount",
  "amount_in",
  "amount_out",
  "description",
  "type",
  "document",
  "ignore"
]);

export const columnMappingSchema = z
  .object({
    delimiter: z.string().min(1).max(1),
    encoding: z.enum(["utf-8", "windows-1252"]),
    skipLines: z.number().int().nonnegative().default(0),
    hasHeader: z.boolean().default(true),
    dateFormat: z.enum(["dd/MM/yyyy", "dd/MM/yy", "yyyy-MM-dd"]),
    decimalSeparator: z.enum([",", "."]),
    signConvention: z.enum(["signed", "split_columns", "debit_positive"]),
    /** Indice da coluna -> papel. A chave e o indice porque cabecalho repete. */
    columns: z.record(z.string(), csvFieldSchema)
  })
  .superRefine((mapping, ctx) => {
    const roles = Object.values(mapping.columns);
    const count = (role: string) => roles.filter((value) => value === role).length;
    const missing: string[] = [];
    if (count("date") !== 1) missing.push("exatamente uma coluna de data");
    if (count("description") !== 1) missing.push("exatamente uma coluna de descricao");
    const hasSingle = count("amount") === 1;
    const hasSplit = count("amount_in") === 1 && count("amount_out") === 1;
    if (!hasSingle && !hasSplit) {
      missing.push("uma coluna de valor ou o par entrada/saida");
    }
    if (hasSingle && hasSplit) {
      missing.push("valor unico e par entrada/saida ao mesmo tempo");
    }
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Mapeamento incompleto: falta ${missing.join("; ")}.`
      });
    }
  });

export const importRowSchema = z.object({
  id: idSchema,
  batchId: idSchema,
  lineNo: z.number().int(),
  status: importRowStatusSchema,
  parsed: parsedTransactionSchema,
  suggestedPlaceId: idSchema.nullable(),
  suggestedCategoryId: idSchema.nullable(),
  suggestedKind: z.enum(["expense", "income", "transfer"]).nullable(),
  /** Preenchido quando a contraparte e outra conta do proprio usuario. */
  counterpartyAccountId: idSchema.nullable(),
  duplicateOfEntryId: idSchema.nullable(),
  matchReason: matchReasonSchema.nullable(),
  entryId: idSchema.nullable()
});

export const importBatchSchema = z.object({
  id: idSchema,
  source: importSourceSchema,
  accountId: idSchema,
  fileName: z.string(),
  fileHash: z.string(),
  importedAt: z.string(),
  status: importBatchStatusSchema,
  rowCount: z.number().int(),
  committedCount: z.number().int(),
  periodStart: isoDateSchema.nullable(),
  periodEnd: isoDateSchema.nullable(),
  closingBalanceCents: z.number().int().nullable()
});

/** Destinatario que nenhuma regra conhece: o passo interativo pergunta uma vez. */
export const unmappedPayeeSchema = z.object({
  normalized: z.string(),
  display: z.string(),
  document: z.string().nullable(),
  rowCount: z.number().int().positive(),
  totalCents: z.number().int(),
  suggestedKind: z.enum(["expense", "income"])
});

export const importPreviewSchema = z.object({
  batch: importBatchSchema,
  rows: z.array(importRowSchema),
  unmappedPayees: z.array(unmappedPayeeSchema),
  summary: z.object({
    new: z.number().int(),
    duplicate: z.number().int(),
    ignored: z.number().int(),
    transfer: z.number().int()
  })
});

export const ruleConditionSchema = z.object({
  field: z.enum(["description", "raw_description", "amount_cents", "account_id", "document"]),
  op: ruleConditionOpSchema,
  value: z.string()
});

export const ruleActionSchema = z.object({
  action: ruleActionKindSchema,
  value: z.string().nullable()
});

export const ruleSchema = z.object({
  id: idSchema,
  name: z.string(),
  stage: ruleStageSchema,
  priority: z.number().int(),
  active: z.boolean(),
  mode: ruleModeSchema,
  stopProcessing: z.boolean(),
  conditions: z.array(ruleConditionSchema),
  actions: z.array(ruleActionSchema)
});

/** O que o passo interativo de mapeamento envia ao resolver um destinatario. */
export const ruleDraftSchema = z.object({
  normalized: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  placeId: idSchema.nullable().optional(),
  newPlaceName: z.string().trim().min(1).max(120).nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  mode: ruleModeSchema.default("auto")
});

export const importCommitSchema = z.object({
  rowIds: z.array(idSchema).min(1),
  /** 6.7 exige a saida: gravar mesmo o que foi marcado como duplicata. */
  force: z.boolean().default(false)
});

/** Nunca "aplicar em tudo": recebe a lista exata que ficou marcada (R-08). */
export const ruleApplySchema = z.object({
  entryIds: z.array(idSchema).min(1)
});

export const accountIdentitySchema = z.object({
  id: idSchema,
  accountId: idSchema,
  kind: accountIdentityKindSchema,
  value: z.string(),
  label: z.string().nullable()
});

export const accountIdentityDraftSchema = z.object({
  accountId: idSchema,
  kind: accountIdentityKindSchema,
  value: z.string().trim().min(1).max(120),
  label: z.string().trim().max(120).nullable().optional()
});

export type ImportSource = z.infer<typeof importSourceSchema>;
export type ImportBatchStatus = z.infer<typeof importBatchStatusSchema>;
export type ImportRowStatus = z.infer<typeof importRowStatusSchema>;
export type MatchReason = z.infer<typeof matchReasonSchema>;
export type RuleStage = z.infer<typeof ruleStageSchema>;
export type RuleMode = z.infer<typeof ruleModeSchema>;
export type Counterparty = z.infer<typeof counterpartySchema>;
export type ParsedTransaction = z.infer<typeof parsedTransactionSchema>;
export type OfxStatement = z.infer<typeof ofxStatementSchema>;
export type CsvField = z.infer<typeof csvFieldSchema>;
export type ColumnMapping = z.infer<typeof columnMappingSchema>;
export type ColumnMappingDraft = z.input<typeof columnMappingSchema>;
export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportBatch = z.infer<typeof importBatchSchema>;
export type UnmappedPayee = z.infer<typeof unmappedPayeeSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RuleCondition = z.infer<typeof ruleConditionSchema>;
export type RuleAction = z.infer<typeof ruleActionSchema>;
export type RuleDraft = z.input<typeof ruleDraftSchema>;
export type ImportCommit = z.infer<typeof importCommitSchema>;
export type AccountIdentity = z.infer<typeof accountIdentitySchema>;
export type AccountIdentityDraft = z.input<typeof accountIdentityDraftSchema>;
