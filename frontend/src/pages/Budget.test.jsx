import React, { act } from "react";
import { createRoot } from "react-dom/client";

import api from "@/lib/api";
import Budget from "./Budget";

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn() },
  fmtMoney: (value, currency) => `${currency} ${value}`,
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { currency: "EUR" } }),
}));
jest.mock("@/i18n", () => ({
  getMonthNames: () => Array.from({ length: 12 }, (_, index) => `M${index + 1}`),
  translate: (key) => key,
}));

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

function dashboardResponse(income) {
  return { data: { budget: { income, rules: [] } } };
}

describe("Budget request lifecycle", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("keeps the newest period when requests finish out of order", async () => {
    const first = deferred();
    const second = deferred();
    api.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    await act(async () => { root.render(<Budget />); });
    const month = container.querySelector('[data-testid="budget-month-select"]');
    const nextMonth = month.value === "12" ? "11" : String(Number(month.value) + 1);

    await act(async () => {
      month.value = nextMonth;
      month.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { second.resolve(dashboardResponse(200)); });
    expect(container.textContent).toContain("EUR 200");

    await act(async () => { first.resolve(dashboardResponse(100)); });
    expect(container.textContent).toContain("EUR 200");
    expect(container.textContent).not.toContain("EUR 100");
  });

  test("ignores a pending response after leaving the route", async () => {
    const pending = deferred();
    api.get.mockReturnValueOnce(pending.promise);
    await act(async () => { root.render(<Budget />); });
    act(() => root.unmount());

    await act(async () => { pending.resolve(dashboardResponse(100)); });
    expect(container.textContent).toBe("");

    root = createRoot(container);
    api.get.mockResolvedValueOnce(dashboardResponse(300));
    await act(async () => { root.render(<Budget />); });
    expect(container.textContent).toContain("EUR 300");
  });
});
