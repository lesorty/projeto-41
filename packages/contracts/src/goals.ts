import { z } from "zod";
import { centsSchema, colorSchema, idSchema, isoDateSchema } from "./ledger.js";

/**
 * Caixinhas (plano mestre 4.5).
 *
 * `mode` é escolhido na criação e **nunca pode ser convertido**: não existe
 * rota, tela nem caminho de migração que troque o modo de uma caixinha
 * existente. Converter marcação em conta significaria criar dinheiro do nada.
 */
export const goalModeSchema = z.enum(["earmark", "account"]);
export type GoalMode = z.infer<typeof goalModeSchema>;

const goalBase = z.object({
  name: z.string().trim().min(1).max(80),
  color: colorSchema,
  icon: z.string().trim().max(40).nullable().optional(),
  targetAmountCents: centsSchema.positive().nullable().optional(),
  targetDate: isoDateSchema.nullable().optional(),
  /**
   * Percentual do CDI. Na marcação, o rendimento é creditado na conta marcada
   * e fica separado na própria caixinha.
   */
  cdiPercent: z.number().min(1).max(300).nullable().optional()
});

export const goalCreateSchema = goalBase
  .extend({
    mode: goalModeSchema,
    /** Só no modo marcação: a conta cujo saldo a caixinha marca. */
    accountId: idSchema.nullable().optional(),
    /** Só no modo conta: dono da conta criada junto. */
    personId: idSchema.nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (value.mode === "earmark" && value.accountId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accountId"],
        message: "Marcacao precisa da conta que ela marca"
      });
    }
  });

/**
 * **Sem o campo `mode`.** O modo é imutável por contrato, por repositório e por
 * `CHECK` de esquema — três camadas.
 */
export const goalUpdateSchema = goalBase;

export const goalDepositSchema = z.object({
  amountCents: centsSchema.positive(),
  date: isoDateSchema,
  fromAccountId: idSchema,
  description: z.string().trim().max(200).nullable().optional()
});

export const goalWithdrawalSchema = z.object({
  amountCents: centsSchema.positive(),
  date: isoDateSchema,
  toAccountId: idSchema,
  description: z.string().trim().max(200).nullable().optional()
});

export const goalAllocationSchema = z.object({
  entryId: idSchema,
  amountCents: centsSchema.positive()
});

/** Separa (positivo) ou libera (negativo) parte do saldo numa marcação. */
export const goalMarkSchema = z.object({
  amountCents: centsSchema.refine((value) => value !== 0, "Informe um valor")
});

export const goalAccrueSchema = z.object({ through: isoDateSchema.optional() });

/** "O saldo real era X no fim do dia D": o sistema recalcula dali em diante. */
export const goalCorrectionSchema = z.object({
  date: isoDateSchema,
  valueCents: z.number().int().nonnegative()
});

export type GoalCreateInput = z.input<typeof goalCreateSchema>;
export type GoalUpdateInput = z.input<typeof goalUpdateSchema>;
export type GoalDepositInput = z.infer<typeof goalDepositSchema>;
export type GoalWithdrawalInput = z.infer<typeof goalWithdrawalSchema>;

export type GoalRecord = {
  id: number;
  name: string;
  mode: GoalMode;
  accountId: number | null;
  accountName: string | null;
  targetAmountCents: number | null;
  targetDate: string | null;
  cdiPercent: number | null;
  color: string;
  icon: string | null;
  archived: boolean;
  createdAt: string;
};

/**
 * Progresso consolidado.
 *
 * Rendimento **realizado e projetado são campos distintos**, nunca um só: se
 * existisse um campo único, alguém somaria projeção com realizado na primeira
 * refatoração.
 */
export type GoalProgress = GoalRecord & {
  /** Saldo calculado: o que você colocou + o que rendeu + as correções. */
  balanceCents: number;
  /** Depósitos menos saques: o dinheiro que você pôs. */
  contributedCents: number;
  /** Rendimento já no saldo (lançado na conta própria ou separado na marcação). */
  yieldCents: number;
  /** Soma das correções de saldo informadas por você. */
  correctionCents: number;
  targetRatioPerMille: number | null;
  remainingCents: number | null;
  daysToTarget: number | null;
  realizedYieldCents: number;
  realizedThroughDate: string | null;
  projectedYieldCents: number;
  projectedThroughDate: string | null;
  /** Resgate hipotético hoje, já com IOF e IR (D15). */
  grossCents: number;
  iofCents: number;
  irCents: number;
  netCents: number;
  /** Dia em que o IOF do aporte mais novo zera, ou `null` se já passou. */
  iofFreeFrom: string | null;
  projection: {
    monthlyDepositCents: number;
    estimatedDate: string | null;
    basis: "deposits" | "deposits+yield" | "none";
  };
};

export type CdiStatus = {
  lastDate: string | null;
  rowCount: number;
  lastFetchAt: string | null;
  seededThrough: string | null;
  online: boolean;
  staleDays: number | null;
};
