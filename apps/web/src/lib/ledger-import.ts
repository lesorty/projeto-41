import type {
  BalancesResult,
  ImportBatchSummary,
  ImportBatchView,
  ImportRowConfirm,
  StatementKind
} from "@projeto41/contracts";
import { api } from "./api.js";

/** Cliente da importacao de extrato (CSV do Nubank, OFX). */
export const importApi = {
  list: () => api<ImportBatchSummary[]>("/ledger/imports"),

  get: (batchId: number) => api<ImportBatchView>(`/ledger/imports/${batchId}`),

  /** `multipart/form-data`: o browser define o `Content-Type` com o boundary. */
  upload: async (accountId: number, kind: StatementKind, file: File) => {
    const form = new FormData();
    form.append("accountId", String(accountId));
    form.append("kind", kind);
    form.append("file", file);
    const response = await fetch("/api/ledger/imports", { method: "POST", body: form });
    if (!response.ok) {
      if (response.status === 413) throw new Error("Arquivo maior que o limite de 10 MB");
      const body = await response.json().catch(() => ({ error: "Falha no envio" }));
      throw new Error(body.error ?? "Falha no envio");
    }
    return (await response.json()) as ImportBatchView;
  },

  confirm: (batchId: number, rowId: number, body: ImportRowConfirm) =>
    api<ImportBatchView & { balances: BalancesResult }>(
      `/ledger/imports/${batchId}/rows/${rowId}/confirm`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  reopen: (batchId: number, rowId: number) =>
    api<ImportBatchView>(`/ledger/imports/${batchId}/rows/${rowId}/reopen`, { method: "POST" }),

  commitReady: (batchId: number) =>
    api<ImportBatchView & { balances: BalancesResult }>(
      `/ledger/imports/${batchId}/commit-ready`,
      { method: "POST" }
    ),

  discard: (batchId: number) =>
    api<ImportBatchView>(`/ledger/imports/${batchId}/discard`, { method: "POST" })
};
