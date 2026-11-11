import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AISettings from "./AISettings";
import api from "@/lib/api";

jest.mock("@/lib/api", () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { is_super_admin: true } }) }));
jest.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });
jest.mock("@/i18n", () => ({ registerMessages: jest.fn(), translate: text => text }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
let container, root;
const config = master => ({ source: "off", provider: "openai", model: "auto", ready: true,
  aura_available: true, master_access: master, models: { openai: ["auto"] }, default_models: { openai: "auto" },
  plan: master ? { used: 3, command_limit: 300, expires_at: "2099-01-01T00:00:00Z", access_type: "master" } : null });
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks();
  container=document.createElement("div"); document.body.appendChild(container); root=createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const button = label => [...container.querySelectorAll("button")].find(node => node.textContent === label);

test("master sees direct access and retains the own AI choice without a self-request button", async () => {
  api.get.mockResolvedValue({ data: config(true) });
  await act(async () => root.render(<AISettings />));
  expect(container.textContent).toContain("Acesso master à IA do Aura");
  expect(button("Solicitar acesso à IA do Aura")).toBeUndefined();
  expect(container.querySelector('#ai-source option[value="own"]')).not.toBeNull();
  expect(container.textContent).toContain("3 / 300");
});

test("master selects Aura and saves the connection without approval or payment", async () => {
  api.get.mockResolvedValue({ data: config(true) }); api.put.mockResolvedValue({ data: { ok: true } });
  await act(async () => root.render(<AISettings />));
  await act(async () => { const select=container.querySelector('#ai-source'); select.value="aura"; select.dispatchEvent(new Event("change",{bubbles:true})); });
  await act(async () => container.querySelector('input[type="checkbox"]').click());
  await act(async () => button("Salvar conexão").click());
  expect(api.put).toHaveBeenCalledWith("/ai/settings",expect.objectContaining({source:"aura",consent:true}));
  expect(api.post).not.toHaveBeenCalled();
});

test("client admin flag alone never hides the server-required request flow", async () => {
  api.get.mockResolvedValue({ data: config(false) });
  await act(async () => root.render(<AISettings />));
  expect(button("Solicitar acesso à IA do Aura")).toBeDefined();
  expect(container.textContent).not.toContain("Acesso master à IA do Aura");
});
