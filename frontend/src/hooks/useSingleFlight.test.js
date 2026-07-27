import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { useSingleFlight } from "./useSingleFlight";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ action }) {
  const { isRunning, run } = useSingleFlight();

  return (
    <button type="button" data-running={isRunning} onClick={() => run(action).catch(() => {})}>
      Save
    </button>
  );
}

describe("useSingleFlight", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("runs only one action at a time and unlocks after completion", async () => {
    let finish;
    const action = jest.fn(() => new Promise((resolve) => {
      finish = resolve;
    }));

    await act(async () => {
      root.render(<Harness action={action} />);
    });

    const button = container.querySelector("button");
    act(() => {
      button.click();
      button.click();
      button.click();
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(button.dataset.running).toBe("true");

    await act(async () => {
      finish("saved");
    });

    expect(button.dataset.running).toBe("false");

    act(() => button.click());
    expect(action).toHaveBeenCalledTimes(2);

    await act(async () => {
      finish("saved again");
    });
  });

  test("unlocks after an error so the user can retry", async () => {
    const action = jest.fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValueOnce("saved");

    await act(async () => {
      root.render(<Harness action={action} />);
    });

    const button = container.querySelector("button");
    await act(async () => {
      button.click();
    });
    expect(button.dataset.running).toBe("false");

    await act(async () => {
      button.click();
    });
    expect(action).toHaveBeenCalledTimes(2);
  });
});
