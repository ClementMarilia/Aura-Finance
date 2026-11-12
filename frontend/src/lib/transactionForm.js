export function transactionPayloadFromForm(form, {
  sourceCurrency,
  exchangeRate,
} = {}) {
  return {
    type: form.type,
    date: form.date,
    amount: parseFloat(form.amount),
    category_id: form.category_id || null,
    person_id: form.type === "transfer" ? null : (form.person_id || null),
    account_id: form.account_id || null,
    from_account_id: form.type === "transfer" ? (form.from_account_id || null) : null,
    to_account_id: form.type === "transfer" ? (form.to_account_id || null) : null,
    payment_method: form.payment_method || null,
    description: form.description,
    notes: form.notes,
    status: form.status,
    currency: sourceCurrency,
    exchange_rate: exchangeRate,
    target_amount: form.type === "transfer" ? (parseFloat(form.target_amount) || 0) : null,
    rate_source: form.rate_source,
  };
}

export function applyAIDraftToForm(current, draft, currency) {
  return {
    ...current,
    type: draft.type,
    status: draft.status === "paid" ? "paid" : "pending",
    amount: draft.amount ? draft.amount.toFixed(2) : "",
    description: draft.description || "",
    notes: draft.notes ?? current.notes,
    date: draft.date || current.date,
    category_id: draft.category_id || "",
    account_id: draft.account_id || "",
    currency: draft.currency || currency,
    payment_method: draft.payment_method || "",
  };
}

