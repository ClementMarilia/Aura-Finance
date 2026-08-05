import {
  transactionFiltersFromSearchParams,
  transactionPayloadFromForm,
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

describe("transaction API payload", () => {
  test("sends only fields accepted by TransactionIn", () => {
    const payload = transactionPayloadFromForm({
      type: "expense",
      date: "2026-08-05",
      amount: "12.50",
      category_id: "food",
      person_id: "person-1",
      account_id: "wallet-1",
      from_account_id: "",
      to_account_id: "",
      payment_method: "card",
      description: "Lunch",
      notes: "",
      status: "paid",
      currency: "EUR",
      exchange_rate: "1",
      target_amount: "",
      rate_source: "automatic",
      repeat: "monthly",
      rate_date: "2026-08-05",
      rate_estimated: false,
    }, { sourceCurrency: "EUR", exchangeRate: 1 });

    expect(payload).toEqual({
      type: "expense",
      date: "2026-08-05",
      amount: 12.5,
      category_id: "food",
      person_id: "person-1",
      account_id: "wallet-1",
      from_account_id: null,
      to_account_id: null,
      payment_method: "card",
      description: "Lunch",
      notes: "",
      status: "paid",
      currency: "EUR",
      exchange_rate: 1,
      target_amount: null,
      rate_source: "automatic",
    });
    expect(payload).not.toHaveProperty("repeat");
    expect(payload).not.toHaveProperty("rate_date");
    expect(payload).not.toHaveProperty("rate_estimated");
  });
});
