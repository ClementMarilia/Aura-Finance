import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LoadingButton } from "./loading-button";

describe("LoadingButton", () => {
  test("disables the action and shows loading feedback", () => {
    const html = renderToStaticMarkup(
      <LoadingButton loading loadingText="Saving...">Save</LoadingButton>
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
    expect(html).toContain("Saving...");
    expect(html).not.toContain(">Save<");
  });

  test("renders the normal action while idle", () => {
    const html = renderToStaticMarkup(
      <LoadingButton loading={false} loadingText="Saving...">Save</LoadingButton>
    );

    expect(html).not.toContain('disabled=""');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain(">Save<");
  });
});
