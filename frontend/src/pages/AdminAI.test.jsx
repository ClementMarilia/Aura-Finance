import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AdminAI from "./AdminAI";
import api from "@/lib/api";

jest.mock("@/lib/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("@/i18n", () => ({ registerMessages: jest.fn(), translate: message => message }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

let root, container;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  jest.clearAllMocks();
  api.get.mockImplementation(url => Promise.resolve({ data: url === "/admin/ai/master-settings" ? { command_limit: 300, used: 17 } : [{ user_id: "alice", email: "alice@example.com", request_id: "request-1", status: "pending" }] }));
  api.put.mockResolvedValue({ data: { command_limit: 5000, used: 17 } });
  api.post.mockResolvedValue({ data: { ok: true } });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = text => [...document.querySelectorAll("button")].find(node => node.textContent === text);

test("free trial starts with editable 24 hours and 20 commands and needs explicit confirmation", async () => {
  await act(async () => root.render(<AdminAI />));
  await act(async () => button("Liberar teste gratuito").click());
  expect(document.getElementById("grant-hours").value).toBe("24");
  expect(document.getElementById("grant-limit").value).toBe("20");
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => button("Confirmar").click());
  expect(api.post).toHaveBeenCalledWith("/admin/ai/plans/alice", expect.objectContaining({
    action: "approve", access_type: "trial", duration_hours: 24, command_limit: 20, payment_confirmed: false,
  }));
});

test("paid access cannot be approved without the payment checkbox", async () => {
  await act(async () => root.render(<AdminAI />));
  await act(async () => button("Confirmar pagamento e ativar").click());
  expect(button("Confirmar").disabled).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => document.querySelector('input[type="checkbox"]').click());
  expect(button("Confirmar").disabled).toBe(false);
  await act(async () => button("Confirmar").click());
  expect(api.post).toHaveBeenCalledWith("/admin/ai/plans/alice", expect.objectContaining({
    access_type: "paid", payment_confirmed: true,
  }));
});


test("master changes their monthly limit without resetting usage or touching a user request", async () => {
  await act(async () => root.render(<AdminAI />));
  const input = document.getElementById("master-command-limit");
  expect(input.value).toBe("300");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "5000");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Salvar meu limite").click());
  expect(api.put).toHaveBeenCalledWith("/admin/ai/master-settings", { command_limit: 5000 });
  expect(container.textContent).toContain("17 / 5000");
  expect(api.post).not.toHaveBeenCalled();
});
