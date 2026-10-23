import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-rm-field-edge bg-transparent px-3 py-1 text-ui-md text-rm-text outline-none placeholder:text-rm-text-muted file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-ui-sm file:font-medium file:text-rm-text disabled:cursor-not-allowed disabled:opacity-45 md:text-ui-sm",
        "aria-invalid:border-rm-danger-ink",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
