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
          className="ml-1 inline-flex cursor-help align-[-2px] rounded-xs text-ink-3 pointer-fine:hover:text-ink-1"
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
