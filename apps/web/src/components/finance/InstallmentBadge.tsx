import type { EntryRecord } from "@projeto41/contracts";

/**
 * Rótulo `3/7` da parcela.
 *
 * A **última** parcela recebe destaque discreto — borda no token de acento, não
 * cor chapada nem ícone novo. Os dois pontos, rótulo e destaque, foram pedidos
 * explicitamente: não unificar num só.
 */
export function InstallmentBadge({ entry }: { entry: EntryRecord }) {
  if (entry.installmentNumber == null || entry.installmentCount == null) return null;
  const isLast = entry.installmentNumber === entry.installmentCount;
  return (
    <em
      className={`fin-installment ${isLast ? "last" : ""}`}
      title={isLast ? "última parcela" : `parcela ${entry.installmentNumber} de ${entry.installmentCount}`}
    >
      {entry.installmentNumber}/{entry.installmentCount}
    </em>
  );
}
