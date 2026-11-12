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
  const toggle = container.querySelector("button[aria-expanded]");
  if (toggle?.getAttribute("aria-expanded") === "false") await act(async () => toggle.click());
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

test("failed AI keeps the text and offers explicit basic entry without another provider call", async () => {
  const onBasicResult = jest.fn();
  api.get.mockResolvedValue({ data: { source: "own" } });
  api.post.mockRejectedValue({ response: { data: { detail: "AI_MODEL_UNAVAILABLE" } } });
  await act(async () => { root.render(<AIEntry onResult={jest.fn()} onBasicResult={onBasicResult} />); });
  await send("Gastei 20 no mercado");
  expect(container.querySelector("textarea").value).toBe("Gastei 20 no mercado");
  const fallback = [...container.querySelectorAll("button")].find(node => node.textContent === "Usar preenchimento básico sem IA");
  await act(async () => fallback.click());
  expect(onBasicResult).toHaveBeenCalledWith(expect.objectContaining({ amount: 20, type: "expense" }));
  expect(api.post).toHaveBeenCalledTimes(1);
});

test("assistant is collapsed by default and expands on demand", async () => {
  await render(jest.fn());
  const toggle = container.querySelector("button[aria-expanded]");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(container.textContent).toContain("Assistente com IA");
  expect(container.querySelector("#ai-command")).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("#ai-command")).not.toBeNull();
  await act(async () => toggle.click());
  expect(container.querySelector("#ai-command")).toBeNull();
});

test("voice quick-add expands the assistant without another tap", async () => {
  api.get.mockResolvedValue({ data: { source: "own" } });
  await act(async () => root.render(<AIEntry onResult={jest.fn()} expandInitially />));
  expect(container.querySelector("button[aria-expanded]").getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("#ai-command")).not.toBeNull();
});

test("answers a question with the previous draft and updates without saving", async () => {
  const onResult = jest.fn();
  const draft = { type: "expense", status: "pending", amount: 269.99, description: "Amazon", date: "2026-12-15", question: "Qual conta?" };
  api.post.mockResolvedValueOnce({ data: { draft } }).mockResolvedValueOnce({ data: { draft: { ...draft, question: "", account_id: "revolut" } } });
  await render(onResult);
  await send("Ainda tenho que pagar a Nathalia 269.99 euros");
  const answer = container.querySelector("#ai-answer");
  expect(answer).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(answer, "Vou pagar pela Revolut");
    answer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => [...container.querySelectorAll("button")].find(node => node.textContent === "Responder e atualizar").click());
  expect(api.post).toHaveBeenLastCalledWith("/ai/interpret", expect.objectContaining({ previous_draft: draft, clarifications: [{ question: "Qual conta?", answer: "Vou pagar pela Revolut" }] }), expect.any(Object));
  expect(onResult).toHaveBeenLastCalledWith(expect.objectContaining({ status: "pending", amount: 269.99, account_id: "revolut" }));
  expect(container.querySelector("#ai-answer")).toBeNull();
  expect(api.post).toHaveBeenCalledTimes(2);
});

test("installment assistant uses the same interpretation API with explicit purchase mode", async () => {
  api.get.mockResolvedValue({ data: { source: "aura" } });
  const draft = { type: "expense", amount: 100, installments: 6, amount_mode: "per_parcel", question: "Primeiro vencimento?" };
  api.post.mockResolvedValue({ data: { draft } });
  const onResult = jest.fn();
  await act(async () => root.render(<AIEntry kind="installment" expandInitially onResult={onResult} />));
  await send("Notebook em seis parcelas de 100 euros");
  expect(api.post).toHaveBeenCalledWith("/ai/interpret", expect.objectContaining({ kind: "installment" }), expect.any(Object));
  expect(onResult).toHaveBeenCalledWith(draft);
  expect(container.querySelector("#ai-answer")).not.toBeNull();
});
