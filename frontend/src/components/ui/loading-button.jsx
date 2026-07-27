import * as React from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "./button";

const LoadingButton = React.forwardRef(({
  loading = false,
  loadingText,
  disabled,
  children,
  ...props
}, ref) => (
  <Button
    ref={ref}
    aria-busy={loading}
    disabled={disabled || loading}
    {...props}
  >
    {loading ? (
      <>
        <LoaderCircle aria-hidden="true" className="animate-spin" />
        <span>{loadingText}</span>
      </>
    ) : children}
  </Button>
));

LoadingButton.displayName = "LoadingButton";

export { LoadingButton };
