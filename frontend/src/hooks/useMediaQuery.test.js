import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { DESKTOP_QUERY, useIsDesktop, useMediaQuery } from "./useMediaQuery";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function installMatchMedia(initial) {
  const listeners = new Set();
  const media = {
    matches: initial,
    addEventListener: jest.fn((_, fn) => listeners.add(fn)),
    removeEventListener: jest.fn((_, fn) => listeners.delete(fn)),
  };
  window.matchMedia = jest.fn(() => media);
  return {
    media,
    change(next) {
      media.matches = next;
      listeners.forEach(fn => fn({ matches: next }));
    },
  };
}

function Probe({ useValue }) {
  return <span data-value={String(useValue())} />;
}

describe("useMediaQuery", () => {
  let container;
  let root;

  const value = () => container.querySelector("span").dataset.value;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.matchMedia;
  });

  test("defaults to the desktop layout when matchMedia is unavailable", () => {
    delete window.matchMedia;
    act(() => root.render(<Probe useValue={useIsDesktop} />));
    expect(value()).toBe("true");
  });

  test("follows viewport changes and unsubscribes on unmount", () => {
    const mq = installMatchMedia(false);
    act(() => root.render(<Probe useValue={() => useMediaQuery(DESKTOP_QUERY)} />));
    expect(value()).toBe("false");

    act(() => mq.change(true));
    expect(value()).toBe("true");

    act(() => root.render(<div />));
    expect(mq.media.removeEventListener).toHaveBeenCalled();
  });
});
