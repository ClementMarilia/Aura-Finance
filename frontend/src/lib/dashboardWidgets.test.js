import {
  DEFAULT_DASHBOARD_WIDGETS,
  hasDashboardWidget,
  normalizeDashboardWidgets,
} from "./dashboardWidgets";

describe("dashboard widget preferences", () => {
  test("keeps the current dashboard visible for users without saved preferences", () => {
    expect(normalizeDashboardWidgets(undefined)).toEqual(DEFAULT_DASHBOARD_WIDGETS);
    expect(DEFAULT_DASHBOARD_WIDGETS).toHaveLength(14);
    expect(new Set(DEFAULT_DASHBOARD_WIDGETS).size).toBe(14);
    expect(DEFAULT_DASHBOARD_WIDGETS).toContain("balance_summary");
    expect(DEFAULT_DASHBOARD_WIDGETS).toContain("balance");
  });

  test("preserves canonical order and ignores unsupported values", () => {
    expect(normalizeDashboardWidgets(["budget", "unknown", "balance"]))
      .toEqual(["balance", "budget"]);
  });

  test("supports a deliberately empty dashboard", () => {
    const widgets = normalizeDashboardWidgets([]);
    expect(widgets).toEqual([]);
    expect(hasDashboardWidget(widgets, "balance")).toBe(false);
  });
});
