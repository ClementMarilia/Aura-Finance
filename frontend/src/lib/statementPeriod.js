function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function periodDateRange(preset, today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();

  if (preset === "today") {
    const date = localIsoDate(today);
    return { start_date: date, end_date: date };
  }
  if (preset === "this_month") {
    return {
      start_date: localIsoDate(new Date(year, month, 1)),
      end_date: localIsoDate(new Date(year, month + 1, 0)),
    };
  }
  if (preset === "last_30_days") {
    const start = new Date(year, month, today.getDate() - 29);
    return { start_date: localIsoDate(start), end_date: localIsoDate(today) };
  }
  if (preset === "last_6_months") {
    return {
      start_date: localIsoDate(new Date(year, month - 5, 1)),
      end_date: localIsoDate(today),
    };
  }
  if (preset === "this_year") {
    return {
      start_date: localIsoDate(new Date(year, 0, 1)),
      end_date: localIsoDate(new Date(year, 11, 31)),
    };
  }
  return { start_date: "", end_date: "" };
}
