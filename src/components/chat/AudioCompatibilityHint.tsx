import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function AudioCompatibilityHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label="Audio compatibility information"
          className="ml-1 inline-flex cursor-help align-[-2px] text-rm-text-muted/80 hover:text-rm-text"
          tabIndex={0}
        >
          <Info size={13} aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
