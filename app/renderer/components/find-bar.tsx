import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FindBarProps {
  query: string;
  activeIndex: number;
  matchCount: number;
  focusToken: number;
  position?: "absolute" | "fixed";
  scheme?: "dark" | "light";
  placeholder?: string;
  autoSelect?: boolean;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function FindBar({
  query,
  activeIndex,
  matchCount,
  focusToken,
  position = "absolute",
  scheme = "dark",
  placeholder = "Find",
  autoSelect = true,
  onQueryChange,
  onClose,
  onNext,
  onPrev,
}: FindBarProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    if (autoSelect) {
      input.select();
    } else {
      const caretPosition = input.value.length;
      try {
        input.setSelectionRange(caretPosition, caretPosition);
      } catch {
        // ignore
      }
    }
  }, [autoSelect, focusToken]);

  const positionClass =
    position === "fixed" ? "fixed right-4 top-4" : "absolute right-4 top-4";

  const schemeClasses =
    scheme === "light"
      ? "border-border bg-background/95 text-foreground shadow-lg"
      : "border-white/20 bg-black/60 text-white shadow-lg backdrop-blur";

  const buttonClasses =
    scheme === "light"
      ? "h-8 w-8 rounded-md border border-border/60 bg-background/80 text-foreground hover:bg-accent/50"
      : "h-8 w-8 rounded-md border border-white/10 bg-white/5 text-white hover:bg-white/10";

  const inputClasses =
    scheme === "light"
      ? "h-9 min-w-[220px] rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      : "h-9 min-w-[200px] rounded-md border border-white/20 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-white/60";

  return (
    <div
      className={cn(
        positionClass,
        "z-50 flex items-center gap-2 rounded-md px-3 py-2",
        schemeClasses,
      )}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            if (event.shiftKey) {
              event.preventDefault();
              onPrev();
            } else {
              event.preventDefault();
              onNext();
            }
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder={placeholder}
        className={inputClasses}
      />
      <div
        className={cn(
          "flex items-center gap-1 text-xs",
          scheme === "light" ? "text-muted-foreground" : "text-white/80",
        )}
      >
        {matchCount > 0 ? `${activeIndex + 1} of ${matchCount}` : "0 of 0"}
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={onPrev}
          disabled={matchCount === 0}
          className={buttonClasses}
          aria-label="Previous match"
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={onNext}
          disabled={matchCount === 0}
          className={buttonClasses}
          aria-label="Next match"
        >
          <ChevronDown className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={onClose}
          className={buttonClasses}
          aria-label="Close search"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
