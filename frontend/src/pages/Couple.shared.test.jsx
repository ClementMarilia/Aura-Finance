import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Couple from "./Couple";
import api from "@/lib/api";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  formatApiError: err => err?.message || "erro",
}));
jest.mock("@/i18n", () => ({ registerMessages: jest.fn(), translate: (text, params) => (
  params ? Object.keys(params).reduce((out, key) => out.replace(`{${key}}`, params[key]), text) : text
) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let container, root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = label => [...container.querySelectorAll("button")].find(node => node.textContent === label);

function mockActive(items) {
  api.get.mockImplementation(url => {
    if (url === "/couple") {
      return Promise.resolve({ data: { link: { id: "l1", status: "active" }, direction: null, partner: { id: "b", name: "Bruno" } } });
    }
    if (url === "/couple/shared-items") return Promise.resolve({ data: { items } });
    if (url === "/accounts") return Promise.resolve({ data: [{ id: "w1", name: "Conta" }] });
    return Promise.resolve({ data: {} });
  });
}

test("creditor sees pending amount owed to them and can mark it received", async () => {
  mockActive([{ id: "r1", description: "Jantar", amount: 25, currency: "EUR", date: "2999-12-01",
    status: "pending", role: "creditor", payment_state: "pending" }]);
  api.post.mockResolvedValue({ data: {} });
  await act(async () => root.render(<Couple />));

  expect(container.textContent).toContain("Bruno deve");
  expect(container.textContent).toContain("Vence em 2999-12-01");
  await act(async () => button("Recebi").click());
  expect(api.post).toHaveBeenCalledWith("/couple/shared-items/r1/received");
});

test("debtor reports payment and then waits for confirmation", async () => {
  mockActive([{ id: "d1", description: "Jantar", amount: 25, currency: "EUR", date: "2999-12-01",
    status: "pending", role: "debtor", payment_state: "pending" }]);
  api.post.mockResolvedValue({ data: {} });
  await act(async () => root.render(<Couple />));

  expect(container.textContent).toContain("Você deve");
  await act(async () => button("Já paguei").click());
  expect(api.post).toHaveBeenCalledWith("/transactions/d1/pay");
});

test("overdue unsettled item shows the overdue badge", async () => {
  mockActive([{ id: "d2", description: "Gás", amount: 25, currency: "EUR", date: "2000-01-01",
    status: "pending", role: "debtor", payment_state: "pending" }]);
  await act(async () => root.render(<Couple />));

  expect(container.textContent).toContain("Atrasado");
});
