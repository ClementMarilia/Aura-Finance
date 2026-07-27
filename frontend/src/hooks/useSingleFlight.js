import { useCallback, useRef, useState } from "react";

export function useSingleFlight() {
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(async (action) => {
    if (runningRef.current) return undefined;

    runningRef.current = true;
    setIsRunning(true);
    try {
      return await action();
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, []);

  return { isRunning, run };
}
