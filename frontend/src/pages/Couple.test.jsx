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

test("shows the invite form when there is no couple link", async () => {
  api.get.mockResolvedValue({ data: { link: null, direction: null, partner: null } });
  await act(async () => root.render(<Couple />));
  expect(container.querySelector("#couple-email")).not.toBeNull();
  expect(container.textContent).toContain("Por privacidade, não informamos se um e-mail existe.");
});

test("incoming invite can be accepted", async () => {
  api.get.mockResolvedValue({ data: { items: [] } });
  api.get
    .mockResolvedValueOnce({ data: { link: { id: "l1", status: "pending" }, direction: "incoming", partner: { id: "p", name: "Bruno" } } })
    .mockResolvedValueOnce({ data: { link: { id: "l1", status: "active" }, direction: "incoming", partner: { id: "p", name: "Bruno" } } });
  api.post.mockResolvedValue({ data: {} });
  await act(async () => root.render(<Couple />));
  expect(container.textContent).toContain("Bruno convidou você para conectar as contas como casal.");
  await act(async () => button("Aceitar").click());
  expect(api.post).toHaveBeenCalledWith("/couple/l1/accept");
});

test("sending an invite posts the email and does not reveal whether it exists", async () => {
  api.get.mockResolvedValue({ data: { link: null, direction: null, partner: null } });
  api.post.mockResolvedValue({ data: { status: "sent_if_registered" } });
  await act(async () => root.render(<Couple />));
  const input = container.querySelector("#couple-email");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "bruno@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(api.post).toHaveBeenCalledWith("/couple/invitations", { email: "bruno@example.com" });
});
