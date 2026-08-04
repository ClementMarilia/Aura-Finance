import {
  transactionFiltersFromSearchParams,
  transactionQueryParams,
} from "./Transactions";

jest.mock("@/context/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/exporters", () => ({ exportCSV: jest.fn() }));
jest.mock("react-router-dom", () => ({ useSearchParams: jest.fn() }), { virtual: true });

describe("transaction URL filters", () => {
  test("uses URL values before the saved period", () => {
    const filters = transactionFiltersFromSearchParams(
      "status=pending&type=expense&year=2027&month=4&currency=EUR",
      { year: "2026", month: "8" },
      new Date(2025, 0, 1),
    );

    expect(filters).toEqual({
      status: "pending",
      type: "expense",
      category_id: "",
      year: "2027",
      month: "4",
      account_id: "",
      currency: "EUR",
    });
  });

  test("falls back to the saved period and omits empty API parameters", () => {
    const filters = transactionFiltersFromSearchParams(
      new URLSearchParams("category_id=food"),
      { year: "2026", month: "8" },
    );

    expect(transactionQueryParams(filters)).toEqual({
      category_id: "food",
      year: "2026",
      month: "8",
    });
  });
});
