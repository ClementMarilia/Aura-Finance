import React, { act } from "react";
import { createRoot } from "react-dom/client";
import AIEntry from "./AIEntry";
import api from "@/lib/api";

jest.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });
jest.mock("@/lib/api", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() } }));
jest.mock("@/i18n", () => ({ registerMessages: jest.fn(), getLanguage: () => "pt", translate: message => message }));

let container;
let root;
beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  jest.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function render(onResult, source = "own") {
  api.get.mockResolvedValue({ data: { source } });
  await act(async () => { root.render(<AIEntry onResult={onResult} />); });
}
async function send(text) {
  const textarea = container.querySelector("textarea");
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = [...container.querySelectorAll("button")].find(node => node.textContent === "Preencher com IA");
  await act(async () => button.click());
}

test("unconfigured users see the settings link and cannot invoke a provider", async () => {
  await render(jest.fn(), "off");
  expect(container.querySelector("a").getAttribute("href")).toBe("/configuracoes/ia");
  expect(container.querySelector("textarea")).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

test("AI returns a draft to the form and never saves a transaction", async () => {
  const onResult = jest.fn();
  const draft = { amount: 32, type: "expense", description: "Fuel", account_id: null, question: "Qual conta?" };
  api.post.mockResolvedValue({ data: { draft } });
  await render(onResult);
  await send("Paguei 32 de gasolina");
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith("/ai/interpret", expect.objectContaining({ text: "Paguei 32 de gasolina", language: "pt" }), expect.any(Object));
  expect(onResult).toHaveBeenCalledWith(draft);
  expect(container.textContent).toContain("Qual conta?");
});

test("a provider limit does not save a draft or switch to a paid connection", async () => {
  const onResult = jest.fn();
  api.post.mockRejectedValue({ response: { data: { detail: "AI_PROVIDER_LIMIT" } } });
  await render(onResult);
  await send("Gastei 20");
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(onResult).not.toHaveBeenCalled();
});
