
import { cn } from "@/lib/utils";

export const StreamLoadingIndicator = ({ className }: { className?: string }) => (
  <div className={cn("absolute inset-0 z-30 flex items-center justify-center bg-[#111214]", className)}>
    <div className="grid grid-cols-2 gap-1.5 p-2 animate-in zoom-in duration-300">
      <div className="w-4 h-4 sm:w-5 sm:h-5 bg-primary rounded-[4px] animate-stream-loader" style={{ animationDelay: '0ms' }} />
      <div className="w-4 h-4 sm:w-5 sm:h-5 bg-primary rounded-[4px] animate-stream-loader" style={{ animationDelay: '200ms' }} />
      <div className="w-4 h-4 sm:w-5 sm:h-5 bg-primary rounded-[4px] animate-stream-loader" style={{ animationDelay: '600ms' }} />
      <div className="w-4 h-4 sm:w-5 sm:h-5 bg-primary rounded-[4px] animate-stream-loader" style={{ animationDelay: '400ms' }} />
    </div>
  </div>
);
