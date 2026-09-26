import { useEffect, useState } from "react";

// Tailwind's `md` breakpoint: below it the app uses its phone layout.
export const DESKTOP_QUERY = "(min-width: 768px)";

function matches(query) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query) {
  const [value, setValue] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const media = window.matchMedia(query);
    const onChange = (event) => setValue(event.matches);
    setValue(media.matches);
    if (media.addEventListener) {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [query]);

  return value;
}

export function useIsDesktop() {
  return useMediaQuery(DESKTOP_QUERY);
}
