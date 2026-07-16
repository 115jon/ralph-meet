import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

const TABBABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isHiddenOrInert(element: HTMLElement): boolean {
  if (element.closest("[hidden], [inert], [aria-hidden='true']")) {
    return true;
  }

  let current: HTMLElement | null = element;
  while (current) {
    if (
      current.hasAttribute("hidden") ||
      current.hasAttribute("inert") ||
      current.getAttribute("aria-hidden") === "true"
    ) {
      return true;
    }

    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function getTabbableElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  ).filter((element) => element.isConnected && !isHiddenOrInert(element));
}

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  className,
  triggerClassName,
  menuClassName,
  ariaLabel,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const selectedOption = options.find((o) => o.value === value);
  const activeOptionIndex =
    options.length === 0
      ? -1
      : Math.min(Math.max(activeIndex, 0), options.length - 1);

  const closeSelect = (restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const selectOption = (index: number) => {
    const option = options[index];
    if (!option) return;
    setActiveIndex(index);
    onChange(option.value);
    closeSelect();
  };

  useEffect(() => {
    const clickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", clickOutside);
    return () => document.removeEventListener("mousedown", clickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleFocusIn = (event: FocusEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeOptionIndex]?.focus();
  }, [activeOptionIndex, isOpen]);

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return;
    setActiveIndex((current) => {
      const next = current + direction;
      return next < 0 ? options.length - 1 : next >= options.length ? 0 : next;
    });
  };

  const moveFocusOutside = (current: HTMLElement, backwards: boolean): void => {
    const tabbable = getTabbableElements();
    const currentIndex = tabbable.indexOf(current);
    const direction = backwards ? -1 : 1;
    for (
      let index = currentIndex + direction;
      index >= 0 && index < tabbable.length;
      index += direction
    ) {
      const candidate = tabbable[index];
      if (candidate && !containerRef.current?.contains(candidate)) {
        candidate.focus();
        if (document.activeElement === candidate) {
          setIsOpen(false);
          return;
        }
      }
    }
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!isOpen) {
          setActiveIndex(
            Math.max(
              0,
              options.findIndex((option) => option.value === value),
            ),
          );
          setIsOpen(true);
        } else {
          moveActive(event.key === "ArrowDown" ? 1 : -1);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!isOpen) setIsOpen(true);
        else selectOption(activeOptionIndex);
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          closeSelect();
        }
        break;
      case "Tab":
        if (isOpen) setIsOpen(false);
        break;
      case "Home":
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(Math.max(0, options.length - 1));
        }
        break;
    }
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, options.length - 1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectOption(index);
        break;
      case "Escape":
        event.preventDefault();
        closeSelect();
        break;
      case "Tab":
        event.preventDefault();
        moveFocusOutside(event.currentTarget, event.shiftKey);
        break;
    }
  };

  return (
    <div
      className={cn("relative", isOpen && "z-[450]", className)}
      ref={containerRef}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setActiveIndex(
            Math.max(
              0,
              options.findIndex((option) => option.value === value),
            ),
          );
          setIsOpen((open) => !open);
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "flex w-full items-center justify-between rounded-xl border border-rm-border bg-rm-bg-elevated/50 px-4 py-3 text-sm text-rm-text outline-none transition-all hover:bg-rm-bg-elevated focus:border-primary/40",
          triggerClassName,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selectedOption?.icon}
          <span className="truncate">
            {selectedOption?.label || placeholder}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "text-rm-text-muted transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {isOpen && (
        <div
          className={cn(
            "absolute z-[500] mt-2 w-full animate-in fade-in slide-in-from-top-2 rounded-xl border border-rm-border bg-rm-bg-floating p-1.5 shadow-2xl duration-200",
            menuClassName,
          )}
        >
          <div
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label={ariaLabel ?? placeholder}
            className="max-h-60 overflow-y-auto custom-scrollbar"
          >
            {options.map((opt, index) => (
              <button
                key={opt.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                tabIndex={index === activeOptionIndex ? 0 : -1}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all text-left",
                  opt.value === value
                    ? "bg-primary text-primary-foreground"
                    : "text-rm-text-secondary hover:bg-rm-bg-elevated hover:text-rm-text",
                )}
              >
                {opt.icon}
                <span className="truncate flex-1 font-medium">{opt.label}</span>
                {opt.value === value && (
                  <Check size={14} className="shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
