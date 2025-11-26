import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { X, Bold, Italic, Underline, Highlighter, Type } from "lucide-react";
import SettingsCard from "./settings-card";
import { FindBar } from "../find-bar";
import { toast } from "../../toaster";
import TimeInput from "./time-input";
import {
  BreakMessagesMode,
  MAX_BREAK_ATTACHMENT_BYTES,
  normalizeAttachment,
  normalizeBreakMessage,
  type BreakMessageAttachment,
  type BreakMessageContent,
  type Settings,
} from "../../../types/settings";

const EMPTY_HIGHLIGHT_MATCHES: HighlightMatch[] = [];
const INDENT_SEQUENCE = "  ";

interface FormattingToolbarProps {
  onFormat: (formatType: string, value?: string) => void;
  disabled: boolean;
}

function FormattingToolbar({ onFormat, disabled }: FormattingToolbarProps) {
  const [fontSize, setFontSize] = useState("24");

  return (
    <div
      className="sticky z-30 bg-card border border-border rounded-md shadow-sm"
      style={{
        top: "calc(var(--settings-scroll-padding-top, 0px) * -1)",
      }}
    >
      <div className="flex items-center gap-1 p-2 flex-wrap">
        <span className="text-xs text-muted-foreground mr-2">
          Text formatting:
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onFormat("bold")}
          disabled={disabled}
          title="Bold (**text**)"
          className="h-8 w-8 p-0"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onFormat("italic")}
          disabled={disabled}
          title="Italic (*text*)"
          className="h-8 w-8 p-0"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onFormat("underline")}
          disabled={disabled}
          title="Underline (__text__)"
          className="h-8 w-8 p-0"
        >
          <Underline className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onFormat("highlight")}
          disabled={disabled}
          title="Highlight (==text==)"
          className="h-8 w-8 p-0"
        >
          <Highlighter className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1 ml-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onFormat("size", fontSize)}
            disabled={disabled}
            title={`Font size ({size:${fontSize}}text{/size})`}
            className="h-8 gap-1 px-2"
          >
            <Type className="h-4 w-4" />
            <span className="text-xs">{fontSize}px</span>
          </Button>
          <input
            type="number"
            min="8"
            max="72"
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
            className="h-8 w-16 px-2 text-xs border rounded-md"
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

interface MessagesCardProps {
  settingsDraft: Settings;
  onTextChange: (
    field: keyof Settings,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => void;
  onMessagesChange: <K extends keyof Settings>(
    field: K,
    value: Settings[K]
  ) => void;
}

interface HighlightMatch {
  start: number;
  end: number;
  globalIndex: number;
}

interface MessageMatch {
  type: "custom" | "monthly" | "fallback";
  messageIndex: number;
  start: number;
  end: number;
}

interface BreakMessageEditorProps {
  value: BreakMessageContent;
  disabled: boolean;
  onChange: (value: BreakMessageContent) => void;
  onRemove: () => void;
  index: number;
  defaultDurationSeconds: number;
  textareaRef?: (element: HTMLTextAreaElement | null) => void;
  highlightRef?: (element: HTMLDivElement | null) => void;
  searchTerm: string;
  isFindActive: boolean;
  matches: HighlightMatch[];
  activeGlobalMatchIndex: number | null;
  onFocus?: (textarea: HTMLTextAreaElement) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read file contents"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Could not read file contents"));
    };
    reader.readAsDataURL(file);
  });
}

function BreakMessageEditor({
  value,
  disabled,
  onChange,
  onRemove,
  index,
  defaultDurationSeconds,
  textareaRef,
  highlightRef,
  searchTerm,
  isFindActive,
  matches,
  activeGlobalMatchIndex,
  onFocus,
}: BreakMessageEditorProps) {
  const [isProcessingPaste, setIsProcessingPaste] = useState(false);
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const hasCustomDuration =
    Object.prototype.hasOwnProperty.call(value, "durationSeconds") &&
    value.durationSeconds !== null;

  const effectiveDurationSeconds = hasCustomDuration
    ? Math.max(0, value.durationSeconds ?? 0)
    : defaultDurationSeconds;

  const handleTextChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(
        normalizeBreakMessage({
          ...value,
          text: event.target.value,
        })
      );
    },
    [onChange, value]
  );

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      const next = normalizeBreakMessage({
        ...value,
        attachments: value.attachments.filter(
          (attachment) => attachment.id !== id
        ),
      });
      onChange(next);
    },
    [onChange, value]
  );

  const handleCustomDurationToggle = useCallback(
    (checked: boolean) => {
      if (!checked) {
        onChange(
          normalizeBreakMessage({
            ...value,
            durationSeconds: null,
          })
        );
        return;
      }

      const currentDuration =
        typeof value.durationSeconds === "number" &&
        Number.isFinite(value.durationSeconds)
          ? Math.max(0, value.durationSeconds)
          : defaultDurationSeconds;

      onChange(
        normalizeBreakMessage({
          ...value,
          durationSeconds: currentDuration,
        })
      );
    },
    [defaultDurationSeconds, onChange, value]
  );

  const handleDurationChange = useCallback(
    (seconds: number) => {
      onChange(
        normalizeBreakMessage({
          ...value,
          durationSeconds: seconds,
        })
      );
    },
    [onChange, value]
  );

  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .map((item) => item.getAsFile())
        .filter(
          (file): file is File => !!file && file.type.startsWith("image/")
        );

      if (files.length === 0) {
        return;
      }

      const textData = event.clipboardData?.getData("text/plain");
      if (!textData) {
        event.preventDefault();
      }

      setIsProcessingPaste(true);
      try {
        let rejectedLargeFile = false;

        const validFiles = files.filter((file) => {
          if (file.size > MAX_BREAK_ATTACHMENT_BYTES) {
            rejectedLargeFile = true;
            return false;
          }
          return true;
        });

        const attachmentPromises = validFiles.map(async (file) => {
          try {
            const dataUrl = await readFileAsDataUrl(file);

            if (!isMounted.current) {
              return null;
            }

            const saved = normalizeAttachment({
              dataUrl,
              mimeType: file.type,
              name: file.name,
              sizeBytes: file.size,
            });
            if (saved) {
              return saved;
            } else {
              toast("Couldn't use that image. Try a different file.");
              return null;
            }
          } catch (error) {
            console.error("Failed to read pasted image", error);
            if (isMounted.current) {
              toast("Couldn't load attachment. Try a different file.");
            }
            return null;
          }
        });

        const results = await Promise.all(attachmentPromises);

        if (!isMounted.current) {
          return;
        }

        const attachments = results.filter(
          (a): a is BreakMessageAttachment => a !== null
        );

        if (rejectedLargeFile) {
          toast("Images must be 4 MB or smaller.");
        }

        if (attachments.length > 0) {
          const next = normalizeBreakMessage({
            ...value,
            attachments: [...value.attachments, ...attachments],
          });
          onChange(next);
        }
      } finally {
        if (isMounted.current) {
          setIsProcessingPaste(false);
        }
      }
    },
    [onChange, value]
  );

  const handleTextareaRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      localTextareaRef.current = element;
      if (textareaRef) {
        textareaRef(element);
      }
    },
    [textareaRef]
  );

  const handleHighlightLayerRef = useCallback(
    (element: HTMLDivElement | null) => {
      highlightLayerRef.current = element;
      if (highlightRef) {
        highlightRef(element);
      }
    },
    [highlightRef]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Tab" || event.shiftKey || disabled) {
        return;
      }

      event.preventDefault();

      const textarea = event.currentTarget;
      const selectionStart = textarea.selectionStart ?? 0;
      const selectionEnd = textarea.selectionEnd ?? 0;
      const existingText = textarea.value ?? "";

      const before = existingText.slice(0, selectionStart);
      const selected = existingText.slice(selectionStart, selectionEnd);
      const after = existingText.slice(selectionEnd);

      const indentedSelection = selected.replace(/\n/g, `\n${INDENT_SEQUENCE}`);
      const nextText = `${before}${INDENT_SEQUENCE}${indentedSelection}${after}`;
      const nextSelectionStart = selectionStart + INDENT_SEQUENCE.length;
      const nextSelectionEnd = nextSelectionStart + indentedSelection.length;

      onChange(
        normalizeBreakMessage({
          ...value,
          text: nextText,
        })
      );

      window.requestAnimationFrame(() => {
        const nextTextarea = localTextareaRef.current;
        if (!nextTextarea) {
          return;
        }
        nextTextarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
      });
    },
    [disabled, onChange, value]
  );

  const highlightedContent = useMemo(() => {
    if (!isFindActive || searchTerm.length === 0 || matches.length === 0) {
      return null;
    }

    const text = value.text ?? "";
    if (text.length === 0) {
      return null;
    }

    const segments: ReactNode[] = [];
    let cursor = 0;

    const sortedMatches = [...matches].sort((a, b) => a.start - b.start);
    sortedMatches.forEach((match) => {
      if (match.start > text.length) {
        return;
      }

      if (cursor < match.start) {
        segments.push(text.slice(cursor, match.start));
      }

      const matchText = text.slice(
        match.start,
        Math.min(match.end, text.length)
      );
      const isActive = match.globalIndex === activeGlobalMatchIndex;
      segments.push(
        <mark
          key={`match-${match.globalIndex}`}
          data-match-index={match.globalIndex}
          className="rounded-sm px-0.5"
          style={{
            backgroundColor: isActive
              ? "rgba(250, 204, 21, 0.6)"
              : "rgba(254, 240, 138, 0.45)",
          }}
        >
          {matchText}
        </mark>
      );

      cursor = Math.min(match.end, text.length);
    });

    if (cursor < text.length) {
      segments.push(text.slice(cursor));
    }

    if (segments.length === 0) {
      return null;
    }

    return segments;
  }, [
    activeGlobalMatchIndex,
    isFindActive,
    matches,
    searchTerm.length,
    value.text,
  ]);

  const syncScroll = useCallback(() => {
    const textarea = localTextareaRef.current;
    const overlay = highlightLayerRef.current;
    if (textarea && overlay) {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    }
  }, []);

  useEffect(() => {
    const textarea = localTextareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("scroll", syncScroll);
    return () => {
      textarea.removeEventListener("scroll", syncScroll);
    };
  }, [syncScroll]);

  useEffect(() => {
    syncScroll();
  }, [syncScroll, highlightedContent, value.text]);

  return (
    <div className="rounded-md border p-3 space-y-3 bg-muted/10">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Message {index + 1}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
        >
          Remove
        </Button>
      </div>
      <div className="relative min-h-16">
        {highlightedContent && (
          <div
            ref={handleHighlightLayerRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 w-full min-h-16 overflow-hidden rounded-md px-3 py-2 text-base text-transparent md:text-sm whitespace-pre-wrap break-words"
          >
            {highlightedContent}
          </div>
        )}
        <Textarea
          className="text-sm resize-none flex-1"
          rows={4}
          value={value.text}
          onChange={handleTextChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onFocus={(e) => onFocus?.(e.currentTarget)}
          disabled={disabled}
          placeholder="Rest your eyes..."
          ref={handleTextareaRef}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Paste images directly into the message area to attach them.
      </p>
      {isProcessingPaste && (
        <p className="text-xs text-muted-foreground">Attaching image...</p>
      )}
      {value.attachments.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {value.attachments.map((attachment) => (
            <figure
              key={attachment.id}
              className="relative rounded-md border bg-background p-2"
            >
              <img
                src={attachment.uri || attachment.dataUrl || ""}
                alt={attachment.name || "Break message attachment"}
                className="max-h-32 max-w-[16rem] rounded-sm object-contain"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={() => handleRemoveAttachment(attachment.id)}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </Button>
              {attachment.name && (
                <figcaption className="mt-1 truncate text-xs text-muted-foreground">
                  {attachment.name}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label className="text-sm font-medium">Custom break length</Label>
            <p className="text-xs text-muted-foreground">
              Override the default break length for this message.
            </p>
          </div>
          <Switch
            checked={hasCustomDuration}
            onCheckedChange={handleCustomDurationToggle}
            disabled={disabled}
            aria-label="Toggle custom break length"
          />
        </div>
        <TimeInput
          precision="seconds"
          value={effectiveDurationSeconds}
          onChange={handleDurationChange}
          disabled={disabled || !hasCustomDuration}
        />
        {!hasCustomDuration && (
          <p className="text-xs text-muted-foreground">
            Uses the default break length.
          </p>
        )}
      </div>
    </div>
  );
}

export default function MessagesCard({
  settingsDraft,
  onTextChange,
  onMessagesChange,
}: MessagesCardProps) {
  const breakMessages: BreakMessageContent[] = useMemo(
    () => settingsDraft.breakMessages ?? [],
    [settingsDraft.breakMessages]
  );

  const monthlyMessages: BreakMessageContent[] = useMemo(
    () => settingsDraft.monthlyMessages ?? [],
    [settingsDraft.monthlyMessages]
  );

  const messageRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  const messageHighlightRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const monthlyMessageRefs = useRef<Map<number, HTMLTextAreaElement>>(
    new Map()
  );
  const monthlyMessageHighlightRefs = useRef<Map<number, HTMLDivElement>>(
    new Map()
  );
  const fallbackMessageRef = useRef<HTMLTextAreaElement | null>(null);
  const fallbackHighlightRef = useRef<HTMLDivElement | null>(null);
  const shouldRevealRef = useRef(false);
  const activeTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarFocusToken, setFindBarFocusToken] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [matches, setMatches] = useState<MessageMatch[]>([]);

  const normalizedSearchTerm = searchTerm.trim();
  const matchCount = matches.length;
  const isFindActive = findBarOpen && normalizedSearchTerm.length > 0;

  const matchesByMessage = useMemo(() => {
    const map = new Map<string, HighlightMatch[]>();
    matches.forEach((match, idx) => {
      const key =
        match.type === "custom"
          ? `custom-${match.messageIndex}`
          : match.type === "monthly"
            ? `monthly-${match.messageIndex}`
            : "fallback";
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push({
        start: match.start,
        end: match.end,
        globalIndex: idx,
      });
    });
    return map;
  }, [matches]);

  const activeGlobalMatchIndex = matchCount > 0 ? activeMatchIndex : null;

  const fallbackHighlightedContent = useMemo(() => {
    if (!isFindActive) {
      return null;
    }

    const fallbackMatches = matchesByMessage.get("fallback");
    if (!fallbackMatches || fallbackMatches.length === 0) {
      return null;
    }

    const text = settingsDraft.breakMessage ?? "";
    if (text.length === 0) {
      return null;
    }

    const segments: ReactNode[] = [];
    let cursor = 0;

    const sortedMatches = [...fallbackMatches].sort(
      (a, b) => a.start - b.start
    );
    sortedMatches.forEach((match) => {
      if (match.start > text.length) {
        return;
      }

      if (cursor < match.start) {
        segments.push(text.slice(cursor, match.start));
      }

      const matchText = text.slice(
        match.start,
        Math.min(match.end, text.length)
      );
      const isActive = match.globalIndex === activeGlobalMatchIndex;
      segments.push(
        <mark
          key={`fallback-match-${match.globalIndex}`}
          data-match-index={match.globalIndex}
          className="rounded-sm px-0.5"
          style={{
            backgroundColor: isActive
              ? "rgba(250, 204, 21, 0.6)"
              : "rgba(254, 240, 138, 0.45)",
          }}
        >
          {matchText}
        </mark>
      );

      cursor = Math.min(match.end, text.length);
    });

    if (cursor < text.length) {
      segments.push(text.slice(cursor));
    }

    if (segments.length === 0) {
      return null;
    }

    return segments;
  }, [
    activeGlobalMatchIndex,
    isFindActive,
    matchesByMessage,
    settingsDraft.breakMessage,
  ]);

  const handleMessagesChange = useCallback(
    (messages: BreakMessageContent[]) => {
      onMessagesChange("breakMessages", messages);
    },
    [onMessagesChange]
  );

  const handleMonthlyMessagesChange = useCallback(
    (messages: BreakMessageContent[]) => {
      onMessagesChange("monthlyMessages", messages);
    },
    [onMessagesChange]
  );

  const registerMessageRef = useCallback(
    (index: number, element: HTMLTextAreaElement | null) => {
      if (element) {
        messageRefs.current.set(index, element);
      } else {
        messageRefs.current.delete(index);
      }
    },
    []
  );

  const registerMessageHighlightRef = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      if (element) {
        messageHighlightRefs.current.set(index, element);
      } else {
        messageHighlightRefs.current.delete(index);
      }
    },
    []
  );

  const registerMonthlyMessageRef = useCallback(
    (index: number, element: HTMLTextAreaElement | null) => {
      if (element) {
        monthlyMessageRefs.current.set(index, element);
      } else {
        monthlyMessageRefs.current.delete(index);
      }
    },
    []
  );

  const registerMonthlyMessageHighlightRef = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      if (element) {
        monthlyMessageHighlightRefs.current.set(index, element);
      } else {
        monthlyMessageHighlightRefs.current.delete(index);
      }
    },
    []
  );

  const handleQueryChange = useCallback((value: string) => {
    setSearchTerm(value);
    setActiveMatchIndex(0);
    shouldRevealRef.current = value.trim().length > 0;
  }, []);

  const handleCloseFindBar = useCallback(() => {
    setFindBarOpen(false);
    setSearchTerm("");
    setActiveMatchIndex(0);
    shouldRevealRef.current = false;
  }, []);

  const handleNextMatch = useCallback(() => {
    if (matchCount === 0) {
      return;
    }
    shouldRevealRef.current = true;
    setActiveMatchIndex((prev) => (prev + 1) % matchCount);
  }, [matchCount]);

  const handlePrevMatch = useCallback(() => {
    if (matchCount === 0) {
      return;
    }
    shouldRevealRef.current = true;
    setActiveMatchIndex((prev) => (prev - 1 + matchCount) % matchCount);
  }, [matchCount]);

  const handleTextareaFocus = useCallback((textarea: HTMLTextAreaElement) => {
    activeTextareaRef.current = textarea;
  }, []);

  const handleFormat = useCallback((formatType: string, value?: string) => {
    const textarea = activeTextareaRef.current;
    if (!textarea) {
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selectedText = text.substring(start, end);

    let before = "";
    let after = "";
    let newText = "";

    switch (formatType) {
      case "bold":
        before = "**";
        after = "**";
        break;
      case "italic":
        before = "*";
        after = "*";
        break;
      case "underline":
        before = "__";
        after = "__";
        break;
      case "highlight":
        before = "==";
        after = "==";
        break;
      case "size":
        before = `{size:${value || "24"}}`;
        after = "{/size}";
        break;
      default:
        return;
    }

    newText =
      text.substring(0, start) +
      before +
      (selectedText || "text") +
      after +
      text.substring(end);

    // Update the textarea value
    textarea.value = newText;

    // Set cursor position
    const newCursorPos = selectedText
      ? start + before.length + selectedText.length + after.length
      : start + before.length;

    textarea.setSelectionRange(newCursorPos, newCursorPos);
    textarea.focus();

    // Trigger change event
    const event = new Event("input", { bubbles: true });
    textarea.dispatchEvent(event);
  }, []);

  useEffect(() => {
    const textareaElement = fallbackMessageRef.current;
    const overlayElement = fallbackHighlightRef.current;
    if (!textareaElement || !overlayElement) {
      return;
    }

    const syncScroll = () => {
      overlayElement.scrollTop = textareaElement.scrollTop;
      overlayElement.scrollLeft = textareaElement.scrollLeft;
    };

    syncScroll();
    textareaElement.addEventListener("scroll", syncScroll);
    return () => {
      textareaElement.removeEventListener("scroll", syncScroll);
    };
  }, [fallbackHighlightedContent, isFindActive, settingsDraft.breakMessage]);

  useEffect(() => {
    if (normalizedSearchTerm.length === 0) {
      setMatches([]);
      setActiveMatchIndex(0);
      return;
    }

    const lowerTerm = normalizedSearchTerm.toLowerCase();
    const computedMatches: MessageMatch[] = [];

    breakMessages.forEach((message, idx) => {
      const text = message.text ?? "";
      if (!text) {
        return;
      }
      const lowerText = text.toLowerCase();
      let pointer = lowerText.indexOf(lowerTerm);
      while (pointer !== -1) {
        computedMatches.push({
          type: "custom",
          messageIndex: idx,
          start: pointer,
          end: pointer + normalizedSearchTerm.length,
        });
        pointer = lowerText.indexOf(lowerTerm, pointer + lowerTerm.length);
      }
    });

    monthlyMessages.forEach((message, idx) => {
      const text = message.text ?? "";
      if (!text) {
        return;
      }
      const lowerText = text.toLowerCase();
      let pointer = lowerText.indexOf(lowerTerm);
      while (pointer !== -1) {
        computedMatches.push({
          type: "monthly",
          messageIndex: idx,
          start: pointer,
          end: pointer + normalizedSearchTerm.length,
        });
        pointer = lowerText.indexOf(lowerTerm, pointer + lowerTerm.length);
      }
    });

    const fallbackText = settingsDraft.breakMessage ?? "";
    if (fallbackText) {
      const lowerText = fallbackText.toLowerCase();
      let pointer = lowerText.indexOf(lowerTerm);
      while (pointer !== -1) {
        computedMatches.push({
          type: "fallback",
          messageIndex: -1,
          start: pointer,
          end: pointer + normalizedSearchTerm.length,
        });
        pointer = lowerText.indexOf(lowerTerm, pointer + lowerTerm.length);
      }
    }

    setMatches(computedMatches);
    setActiveMatchIndex((prev) => {
      if (computedMatches.length === 0) {
        return 0;
      }
      return Math.min(prev, computedMatches.length - 1);
    });
  }, [
    breakMessages,
    monthlyMessages,
    normalizedSearchTerm,
    settingsDraft.breakMessage,
  ]);

  useEffect(() => {
    if (!findBarOpen || normalizedSearchTerm.length === 0 || matchCount === 0) {
      return;
    }

    if (!shouldRevealRef.current) {
      return;
    }

    const activeMatch = matches[activeMatchIndex];
    if (!activeMatch) {
      return;
    }

    window.requestAnimationFrame(() => {
      shouldRevealRef.current = false;
      const targetElement =
        activeMatch.type === "custom"
          ? (messageRefs.current.get(activeMatch.messageIndex) ?? null)
          : activeMatch.type === "monthly"
            ? (monthlyMessageRefs.current.get(activeMatch.messageIndex) ?? null)
            : fallbackMessageRef.current;

      if (targetElement && !targetElement.disabled) {
        try {
          targetElement.focus({ preventScroll: true });
        } catch {
          targetElement.focus();
        }
        try {
          targetElement.setSelectionRange(activeMatch.start, activeMatch.end);
        } catch {
          /* ignore selection issues */
        }
      }

      const highlightContainer =
        activeMatch.type === "custom"
          ? (messageHighlightRefs.current.get(activeMatch.messageIndex) ?? null)
          : activeMatch.type === "monthly"
            ? (monthlyMessageHighlightRefs.current.get(
                activeMatch.messageIndex
              ) ?? null)
            : fallbackHighlightRef.current;

      const highlightElement = highlightContainer?.querySelector<HTMLElement>(
        `[data-match-index="${activeMatchIndex}"]`
      );

      if (highlightElement) {
        highlightElement.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "smooth",
        });
      } else if (targetElement) {
        targetElement.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      setFindBarFocusToken((token) => token + 1);
    });
  }, [
    activeMatchIndex,
    findBarOpen,
    matchCount,
    matches,
    normalizedSearchTerm,
    setFindBarFocusToken,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindBarOpen(true);
        setFindBarFocusToken((token) => token + 1);
        shouldRevealRef.current = true;
      }

      if (event.key === "Escape" && findBarOpen) {
        event.preventDefault();
        handleCloseFindBar();
        return;
      }

      if (
        !findBarOpen ||
        normalizedSearchTerm.length === 0 ||
        matchCount === 0
      ) {
        return;
      }

      if (event.key === "F3") {
        event.preventDefault();
        if (event.shiftKey) {
          handlePrevMatch();
        } else {
          handleNextMatch();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          handlePrevMatch();
        } else {
          handleNextMatch();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [
    findBarOpen,
    handleCloseFindBar,
    handleNextMatch,
    handlePrevMatch,
    matchCount,
    normalizedSearchTerm,
  ]);

  return (
    <SettingsCard
      title="Messages"
      helperText="Manage messages shown during breaks."
    >
      <div className="relative space-y-4">
        <FormattingToolbar
          onFormat={handleFormat}
          disabled={!settingsDraft.breaksEnabled}
        />

        {findBarOpen && (
          <FindBar
            query={searchTerm}
            activeIndex={matchCount > 0 ? activeMatchIndex : 0}
            matchCount={matchCount}
            focusToken={findBarFocusToken}
            position="fixed"
            scheme="light"
            placeholder="Find messages"
            autoSelect={false}
            onQueryChange={handleQueryChange}
            onClose={handleCloseFindBar}
            onNext={handleNextMatch}
            onPrev={handlePrevMatch}
          />
        )}

        <Tabs defaultValue="daily" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="daily">Daily Messages</TabsTrigger>
            <TabsTrigger value="monthly">Monthly Messages</TabsTrigger>
            <TabsTrigger value="settings">Message Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="daily" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Add one or more messages. Paste images directly into a message to
              attach them. Use rich text formatting (bold, italic, underline,
              etc.) and markdown-style bullets (&quot;*&quot;, &quot;1.&quot;,
              &quot;a.&quot;).
            </p>
            <div className="space-y-3">
              {breakMessages.map((msg, idx) => (
                <BreakMessageEditor
                  key={idx}
                  value={msg}
                  index={idx}
                  defaultDurationSeconds={settingsDraft.breakLengthSeconds}
                  disabled={!settingsDraft.breaksEnabled}
                  textareaRef={(element) => registerMessageRef(idx, element)}
                  highlightRef={(element) =>
                    registerMessageHighlightRef(idx, element)
                  }
                  searchTerm={normalizedSearchTerm}
                  isFindActive={isFindActive}
                  matches={
                    matchesByMessage.get(`custom-${idx}`) ??
                    EMPTY_HIGHLIGHT_MATCHES
                  }
                  activeGlobalMatchIndex={activeGlobalMatchIndex}
                  onFocus={handleTextareaFocus}
                  onChange={(updated) => {
                    const next = [...breakMessages];
                    next[idx] = updated;
                    handleMessagesChange(next);
                  }}
                  onRemove={() => {
                    const next = [...breakMessages];
                    next.splice(idx, 1);
                    handleMessagesChange(next);
                  }}
                />
              ))}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const next = [
                      ...breakMessages,
                      normalizeBreakMessage(settingsDraft.breakMessage || ""),
                    ];
                    handleMessagesChange(next);
                  }}
                  disabled={!settingsDraft.breaksEnabled}
                >
                  Add Message
                </Button>
                {breakMessages.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleMessagesChange([])}
                    disabled={!settingsDraft.breaksEnabled}
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="monthly" className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Add messages that rotate on a monthly basis. These messages can be
              used for monthly themes, goals, or reminders. Rich text formatting
              and images are supported.
            </p>
            <div className="space-y-3">
              {monthlyMessages.map((msg, idx) => (
                <BreakMessageEditor
                  key={idx}
                  value={msg}
                  index={idx}
                  defaultDurationSeconds={settingsDraft.breakLengthSeconds}
                  disabled={!settingsDraft.breaksEnabled}
                  textareaRef={(element) =>
                    registerMonthlyMessageRef(idx, element)
                  }
                  highlightRef={(element) =>
                    registerMonthlyMessageHighlightRef(idx, element)
                  }
                  searchTerm={normalizedSearchTerm}
                  isFindActive={isFindActive}
                  matches={
                    matchesByMessage.get(`monthly-${idx}`) ??
                    EMPTY_HIGHLIGHT_MATCHES
                  }
                  activeGlobalMatchIndex={activeGlobalMatchIndex}
                  onFocus={handleTextareaFocus}
                  onChange={(updated) => {
                    const next = [...monthlyMessages];
                    next[idx] = updated;
                    handleMonthlyMessagesChange(next);
                  }}
                  onRemove={() => {
                    const next = [...monthlyMessages];
                    next.splice(idx, 1);
                    handleMonthlyMessagesChange(next);
                  }}
                />
              ))}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const next = [
                      ...monthlyMessages,
                      normalizeBreakMessage(""),
                    ];
                    handleMonthlyMessagesChange(next);
                  }}
                  disabled={!settingsDraft.breaksEnabled}
                >
                  Add Message
                </Button>
                {monthlyMessages.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleMonthlyMessagesChange([])}
                    disabled={!settingsDraft.breaksEnabled}
                  >
                    Clear All
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Message Order</Label>
              <Select
                value={
                  settingsDraft.breakMessagesMode || BreakMessagesMode.Random
                }
                onValueChange={(value) =>
                  onMessagesChange(
                    "breakMessagesMode",
                    value as BreakMessagesMode
                  )
                }
                disabled={!settingsDraft.breaksEnabled}
              >
                <SelectTrigger style={{ width: 180 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={BreakMessagesMode.Random}>
                    Random
                  </SelectItem>
                  <SelectItem value={BreakMessagesMode.Sequential}>
                    Sequential (Round Robin)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Single Message (fallback)
              </Label>
              <p className="text-xs text-muted-foreground">
                This message is shown when no daily or monthly messages are
                available.
              </p>
              <div className="relative min-h-16">
                {fallbackHighlightedContent && (
                  <div
                    ref={(element) => {
                      fallbackHighlightRef.current = element;
                    }}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 w-full min-h-16 overflow-hidden rounded-md px-3 py-2 text-base text-transparent md:text-sm whitespace-pre-wrap break-words"
                  >
                    {fallbackHighlightedContent}
                  </div>
                )}
                <Textarea
                  id="break-message"
                  className="text-sm resize-none"
                  rows={3}
                  value={settingsDraft.breakMessage}
                  onChange={(e) => onTextChange("breakMessage", e)}
                  onFocus={(e) => handleTextareaFocus(e.currentTarget)}
                  disabled={!settingsDraft.breaksEnabled}
                  placeholder="Enter your break message..."
                  ref={(element) => {
                    fallbackMessageRef.current = element;
                  }}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </SettingsCard>
  );
}
