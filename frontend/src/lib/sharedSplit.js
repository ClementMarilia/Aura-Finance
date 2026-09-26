// Mirrors backend compute_splits validation so the form can warn before the
// request fails: manual shares must add up to the total, percentages to 100.
const cents = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function splitCheck(amount, splitType, participants) {
  const total = cents(amount);
  if (splitType === "manual") {
    const values = participants.map((p) => Number(p.amount) || 0);
    if (values.some((v) => v < 0)) return { valid: false, kind: "negative" };
    const sum = cents(values.reduce((acc, v) => acc + v, 0));
    const remaining = cents(total - sum);
    return { valid: Math.abs(remaining) <= 0.01, kind: "manual", sum, remaining };
  }
  if (splitType === "percent") {
    const values = participants.map((p) => Number(p.percent) || 0);
    if (values.some((v) => v < 0)) return { valid: false, kind: "negative" };
    const sum = Math.round(values.reduce((acc, v) => acc + v, 0) * 100) / 100;
    const remaining = Math.round((100 - sum) * 100) / 100;
    return { valid: Math.abs(remaining) <= 0.01, kind: "percent", sum, remaining };
  }
  return { valid: participants.length > 0, kind: "equal" };
}
