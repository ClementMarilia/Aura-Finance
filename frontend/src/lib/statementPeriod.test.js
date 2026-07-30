import { periodDateRange } from "./statementPeriod";

describe("periodDateRange", () => {
  const today = new Date(2026, 6, 30);

  test("builds the exact range for today", () => {
    expect(periodDateRange("today", today)).toEqual({
      start_date: "2026-07-30",
      end_date: "2026-07-30",
    });
  });

  test("builds complete calendar month and year ranges", () => {
    expect(periodDateRange("this_month", today)).toEqual({
      start_date: "2026-07-01",
      end_date: "2026-07-31",
    });
    expect(periodDateRange("this_year", today)).toEqual({
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    });
  });

  test("builds rolling ranges without counting an extra day", () => {
    expect(periodDateRange("last_30_days", today)).toEqual({
      start_date: "2026-07-01",
      end_date: "2026-07-30",
    });
    expect(periodDateRange("last_6_months", today)).toEqual({
      start_date: "2026-02-01",
      end_date: "2026-07-30",
    });
  });

  test("clears dates for all-time and unknown presets", () => {
    expect(periodDateRange("all", today)).toEqual({
      start_date: "",
      end_date: "",
    });
  });
});
