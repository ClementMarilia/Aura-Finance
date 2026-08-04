import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useQuery } from "@tanstack/react-query";

import FinancialHealth, { isFinancialHealthPayload } from "./FinancialHealth";

jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("@/i18n", () => ({
  getLocale: () => "pt-BR",
  translate: (key) => key,
}));
jest.mock("react-router-dom", () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}), { virtual: true });

describe("FinancialHealth", () => {
  const refetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("keeps a loading state when the route remounts before data is available", () => {
    useQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isFetching: true,
      isError: false,
      refetch,
    });

    const html = renderToStaticMarkup(<FinancialHealth />);

    expect(html).toContain("Calculando saúde financeira");
    expect(html).not.toContain("financial-health-page");
  });

  test("shows a retry state instead of crashing when the API returns no payload", () => {
    useQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isFetching: false,
      isError: true,
      refetch,
    });

    const html = renderToStaticMarkup(<FinancialHealth />);

    expect(html).toContain("Não foi possível calcular sua saúde financeira");
    expect(html).toContain("Tentar novamente");
  });

  test("accepts only complete score payloads", () => {
    expect(isFinancialHealthPayload(undefined)).toBe(false);
    expect(isFinancialHealthPayload({ score: 70 })).toBe(false);
    expect(isFinancialHealthPayload({
      score: 70,
      level: "good",
      summary: {},
      factors: [],
    })).toBe(true);
  });
});
