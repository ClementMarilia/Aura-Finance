import React, { act } from "react";
import { createRoot } from "react-dom/client";
import QuickEntryAccess from "./QuickEntryAccess";
jest.mock("react-router-dom", () => ({ Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });
jest.mock("@/i18n", () => ({ registerMessages: jest.fn(), translate: s => s }));
test("normal app exposes entry and shortcut destinations", async () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<QuickEntryAccess />));
  const links = container.querySelectorAll("a");
  expect([...links].map(link => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Adicionar rápido", "/adicionar"], ["Criar atalho no celular", "/adicionar?instalar=1"],
  ]);
  await act(async () => root.unmount()); container.remove();
});
