import * as React from "react";

import { FIELD } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Multi-line field on the same edge as Input; grows with its content. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        FIELD,
        "field-sizing-content min-h-16 px-2.5 py-1.5 text-ui-md md:text-ui-row",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
