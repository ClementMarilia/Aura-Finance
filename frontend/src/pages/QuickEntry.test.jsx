import React, { act } from "react";
import { createRoot } from "react-dom/client";
import QuickEntry from "./QuickEntry";
import api, { postCreate } from "@/lib/api";

jest.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>, useSearchParams: () => [new URLSearchParams(globalThis.quickSearch || "")] }), { virtual: true });
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { currency: "EUR" } }) }));
jest.mock("@/lib/api", () => ({ __esModule: true, default: { get: jest.fn() }, postCreate: jest.fn(), formatApiError: () => "Falha", CURRENCIES: [{ value: "EUR", label: "EUR" }] }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/i18n", () => ({ registerMessages: jest.fn(), translate: s => s }));
jest.mock("@/components/ReceiptScanner", () => () => <div>Receipt</div>);
jest.mock("@/components/AmountInput", () => ({ value, onValueChange, ...props }) => <input {...props} value={value} onChange={e => onValueChange(e.target.value)} />);
jest.mock("@/components/AIEntry", () => ({ onResult }) => <button type="button" onClick={() => onResult({ type: "expense", status: "pending", amount: 269.99, date: "2026-12-15", description: "RAM Amazon", notes: "Pagar Nathalia", account_id: "revolut", category_id: "shopping", currency: "EUR" })}>Interpretar teste</button>);
let root, container;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  globalThis.quickSearch = "";
  api.get.mockImplementation(path => Promise.resolve({ data: path === "/categories" ? [{ id: "shopping", kind: "expense", name: "Compras" }] : [{ id: "revolut", currency: "EUR", name: "Revolut" }] }));
  postCreate.mockResolvedValue({});
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function fill() {
  await act(async () => root.render(<QuickEntry />));
  await act(async () => [...container.querySelectorAll("button")].find(node => node.textContent === "Interpretar teste").click());
}
function submit() { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }
test("quick entry fetches only form options and saves only after explicit confirmation", async () => {
  await fill();
  expect(api.get.mock.calls.map(args => args[0])).toEqual(["/categories", "/accounts"]);
  expect(postCreate).not.toHaveBeenCalled();
  expect(container.querySelector('input[type="date"]').value).toBe("2026-12-15");
  expect(container.querySelector("textarea").value).toBe("Pagar Nathalia");
  await act(async () => { submit(); submit(); });
  expect(postCreate).toHaveBeenCalledTimes(1);
  expect(postCreate).toHaveBeenCalledWith("/transactions", expect.objectContaining({ amount: 269.99, status: "pending", currency: "EUR", account_id: "revolut", notes: "Pagar Nathalia" }));
  expect(container.querySelector('input[aria-label="Valor"]').value).toBe("");
});
test("failed saving keeps entered values for retry", async () => {
  postCreate.mockRejectedValue({});
  await fill();
  await act(async () => submit());
  expect(container.querySelector('input[aria-label="Valor"]').value).toBe("269.99");
  expect(container.querySelector("textarea").value).toBe("Pagar Nathalia");
});


test("shortcut link expands instructions and installation requires an explicit click", async () => {
  globalThis.quickSearch = "instalar=1";
  await act(async () => root.render(<QuickEntry />));
  expect(container.querySelector("details").open).toBe(true);
  const prompt = jest.fn().mockResolvedValue(undefined);
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
  await act(async () => window.dispatchEvent(event));
  expect(prompt).not.toHaveBeenCalled();
  await act(async () => [...container.querySelectorAll("button")].find(button => button.textContent === "Instalar atalho").click());
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Instalar atalho");
});
