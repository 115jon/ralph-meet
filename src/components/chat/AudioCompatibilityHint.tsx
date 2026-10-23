import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Icon } from "@/components/ui/icon";
import type { ReactNode } from "react";

export function AudioCompatibilityHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label="Audio compatibility information"
          className="ml-1 inline-flex cursor-help align-[-2px] text-rm-text-muted/80 pointer-fine:hover:text-rm-text"
          tabIndex={0}
        >
          <Icon name="info" size="xs" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
