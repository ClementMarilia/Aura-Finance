export function reconciliationDifference(actualBalance, calculatedBalance) {
  if (actualBalance === "" || actualBalance === null || actualBalance === undefined) {
    return null;
  }
  const actual = Number(actualBalance);
  const calculated = Number(calculatedBalance);
  if (!Number.isFinite(actual) || !Number.isFinite(calculated)) return null;
  const difference = Math.round((actual - calculated) * 100) / 100;
  return Math.abs(difference) < 0.01 ? 0 : difference;
}

export const BALANCE_COMPONENTS = [
  { key: "initial_balance", label: "Saldo inicial", sign: 1 },
  { key: "income", label: "Receitas pagas", sign: 1 },
  { key: "expense", label: "Despesas pagas", sign: -1 },
  { key: "transfers_in", label: "Transferências recebidas", sign: 1 },
  { key: "transfers_out", label: "Transferências enviadas", sign: -1 },
  { key: "installments", label: "Parcelas pagas", sign: -1 },
  { key: "adjustments", label: "Ajustes de conciliação", sign: 1 },
];

export const BALANCE_ENTRY_LABELS = {
  initial_balance: "Saldo inicial",
  income: "Receita",
  expense: "Despesa",
  transfer_in: "Transferência recebida",
  transfer_out: "Transferência enviada",
  installment: "Parcela paga",
  adjustment: "Conciliação",
};
