import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
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

interface MessagesCardProps {
  settingsDraft: Settings;
  onTextChange: (
    field: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}

interface HighlightMatch {
  start: number;
  end: number;
  globalIndex: number;
}

interface MessageMatch {
  type: "custom" | "fallback";
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
}

function createSyntheticInputEvent<T>(value: T): ChangeEvent<HTMLInputElement> {
  return { target: { value } } as unknown as ChangeEvent<HTMLInputElement>;
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
        }),
      );
    },
    [onChange, value],
  );

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      const next = normalizeBreakMessage({
        ...value,
        attachments: value.attachments.filter((attachment) => attachment.id !== id),
      });
      onChange(next);
    },
    [onChange, value],
  );

  const handleCustomDurationToggle = useCallback(
    (checked: boolean) => {
      if (!checked) {
        onChange(
          normalizeBreakMessage({
            ...value,
            durationSeconds: null,
          }),
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
        }),
      );
    },
    [defaultDurationSeconds, onChange, value],
  );

  const handleDurationChange = useCallback(
    (seconds: number) => {
      onChange(
        normalizeBreakMessage({
          ...value,
          durationSeconds: seconds,
        }),
      );
    },
    [onChange, value],
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file && file.type.startsWith("image/"));

      if (files.length === 0) {
        return;
      }

      const textData = event.clipboardData?.getData("text/plain");
      if (!textData) {
        event.preventDefault();
      }

      setIsProcessingPaste(true);
      try {
        const attachments: BreakMessageAttachment[] = [];
        let rejectedLargeFile = false;

        for (const file of files) {
          if (file.size > MAX_BREAK_ATTACHMENT_BYTES) {
            rejectedLargeFile = true;
            continue;
          }

          try {
            const dataUrl = await readFileAsDataUrl(file);
            const saved = normalizeAttachment({
              dataUrl,
              mimeType: file.type,
              name: file.name,
              sizeBytes: file.size,
            });
            if (saved) {
              attachments.push(saved);
            } else {
              toast("Couldn't use that image. Try a different file.");
            }
          } catch (error) {
            console.error("Failed to read pasted image", error);
            toast("Couldn't load attachment. Try a different file.");
          }
        }

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
        setIsProcessingPaste(false);
      }
    },
    [onChange, value],
  );

  const handleTextareaRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      localTextareaRef.current = element;
      if (textareaRef) {
        textareaRef(element);
      }
    },
    [textareaRef],
  );

  const handleHighlightLayerRef = useCallback(
    (element: HTMLDivElement | null) => {
      highlightLayerRef.current = element;
      if (highlightRef) {
        highlightRef(element);
      }
    },
    [highlightRef],
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

      const matchText = text.slice(match.start, Math.min(match.end, text.length));
      const isActive = match.globalIndex === activeGlobalMatchIndex;
      segments.push(
        <mark
          key={`match-${match.globalIndex}`}
          data-match-index={match.globalIndex}
          className={cn(
            "rounded-sm px-0.5",
            isActive ? "bg-yellow-300 text-black" : "bg-yellow-100 text-black",
          )}
        >
          {matchText}
        </mark>,
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
  }, [activeGlobalMatchIndex, isFindActive, matches, searchTerm.length, value.text]);

  const textareaShouldMask = Boolean(highlightedContent);

  useEffect(() => {
    const textareaElement = localTextareaRef.current;
    const overlayElement = highlightLayerRef.current;
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
  }, [highlightedContent, isFindActive, value.text]);

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
            className="pointer-events-none absolute inset-0 w-full min-h-16 overflow-hidden rounded-md px-3 py-2 text-base text-foreground md:text-sm whitespace-pre-wrap break-words"
            style={{ whiteSpace: "pre-wrap" }}
          >
            {highlightedContent}
          </div>
        )}
        <Textarea
          className={cn(
            "text-sm resize-none flex-1",
            textareaShouldMask && "bg-transparent text-transparent",
          )}
          rows={4}
          value={value.text}
          onChange={handleTextChange}
          onPaste={handlePaste}
          disabled={disabled}
          placeholder="Rest your eyes..."
          ref={handleTextareaRef}
          style={
            textareaShouldMask
              ? {
                  color: "transparent",
                  backgroundColor: "transparent",
                  caretColor: "hsl(var(--foreground))",
                }
              : undefined
          }
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
}: MessagesCardProps) {
  const breakMessages: BreakMessageContent[] = useMemo(
    () => settingsDraft.breakMessages ?? [],
    [settingsDraft.breakMessages],
  );

  const messageRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  const messageHighlightRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const fallbackMessageRef = useRef<HTMLTextAreaElement | null>(null);
  const fallbackHighlightRef = useRef<HTMLDivElement | null>(null);
  const shouldRevealRef = useRef(false);

  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarFocusToken, setFindBarFocusToken] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [matches, setMatches] = useState<MessageMatch[]>([]);

  const normalizedSearchTerm = searchTerm.trim();
  const matchCount = matches.length;
  const isFindActive = findBarOpen && normalizedSearchTerm.length > 0;

  const matchesByMessage = useMemo(() => {
    const map = new Map<number, HighlightMatch[]>();
    matches.forEach((match, idx) => {
      const key = match.type === "custom" ? match.messageIndex : -1;
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

    const fallbackMatches = matchesByMessage.get(-1);
    if (!fallbackMatches || fallbackMatches.length === 0) {
      return null;
    }

    const text = settingsDraft.breakMessage ?? "";
    if (text.length === 0) {
      return null;
    }

    const segments: ReactNode[] = [];
    let cursor = 0;

    const sortedMatches = [...fallbackMatches].sort((a, b) => a.start - b.start);
    sortedMatches.forEach((match) => {
      if (match.start > text.length) {
        return;
      }

      if (cursor < match.start) {
        segments.push(text.slice(cursor, match.start));
      }

      const matchText = text.slice(match.start, Math.min(match.end, text.length));
      const isActive = match.globalIndex === activeGlobalMatchIndex;
      segments.push(
        <mark
          key={`fallback-match-${match.globalIndex}`}
          data-match-index={match.globalIndex}
          className={cn(
            "rounded-sm px-0.5",
            isActive ? "bg-yellow-300 text-black" : "bg-yellow-100 text-black",
          )}
        >
          {matchText}
        </mark>,
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
  }, [activeGlobalMatchIndex, isFindActive, matchesByMessage, settingsDraft.breakMessage]);

  const fallbackTextareaShouldMask = Boolean(fallbackHighlightedContent);

  const handleMessagesChange = useCallback(
    (messages: BreakMessageContent[]) => {
      onTextChange("breakMessages", createSyntheticInputEvent(messages));
    },
    [onTextChange],
  );

  const registerMessageRef = useCallback(
    (index: number, element: HTMLTextAreaElement | null) => {
      if (element) {
        messageRefs.current.set(index, element);
      } else {
        messageRefs.current.delete(index);
      }
    },
    [],
  );

  const registerMessageHighlightRef = useCallback(
    (index: number, element: HTMLDivElement | null) => {
      if (element) {
        messageHighlightRefs.current.set(index, element);
      } else {
        messageHighlightRefs.current.delete(index);
      }
    },
    [],
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
  }, [breakMessages, normalizedSearchTerm, settingsDraft.breakMessage]);

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
          ? messageRefs.current.get(activeMatch.messageIndex) ?? null
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
          ? messageHighlightRefs.current.get(activeMatch.messageIndex) ?? null
          : fallbackHighlightRef.current;

      const highlightElement = highlightContainer?.querySelector<HTMLElement>(
        `[data-match-index="${activeMatchIndex}"]`,
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
    const handleKeyDown = (event: KeyboardEvent) => {
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

      if (!findBarOpen || normalizedSearchTerm.length === 0 || matchCount === 0) {
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

        <div className="space-y-2">
          <Label className="text-sm font-medium">Message Order</Label>
          <Select
            value={settingsDraft.breakMessagesMode || BreakMessagesMode.Random}
            onValueChange={(value) =>
              onTextChange("breakMessagesMode", createSyntheticInputEvent(value))
            }
            disabled={!settingsDraft.breaksEnabled}
          >
            <SelectTrigger style={{ width: 180 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BreakMessagesMode.Random}>Random</SelectItem>
              <SelectItem value={BreakMessagesMode.Sequential}>
                Sequential (Round Robin)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Messages</Label>
          <p className="text-xs text-muted-foreground">
            Add one or more messages. Paste images directly into a message to attach them.
            Markdown-style bullets (&quot;*&quot;, &quot;1.&quot;, &quot;a.&quot;) are formatted automatically during breaks.
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
                highlightRef={(element) => registerMessageHighlightRef(idx, element)}
                searchTerm={normalizedSearchTerm}
                isFindActive={isFindActive}
                matches={matchesByMessage.get(idx) ?? EMPTY_HIGHLIGHT_MATCHES}
                activeGlobalMatchIndex={activeGlobalMatchIndex}
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

          <Label className="text-sm font-medium mt-4 block">
            Single Message (fallback)
          </Label>
          <div className="relative min-h-16">
            {fallbackHighlightedContent && (
              <div
                ref={(element) => {
                  fallbackHighlightRef.current = element;
                }}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 w-full min-h-16 overflow-hidden rounded-md px-3 py-2 text-base text-foreground md:text-sm whitespace-pre-wrap break-words"
                style={{ whiteSpace: "pre-wrap" }}
              >
                {fallbackHighlightedContent}
              </div>
            )}
            <Textarea
              id="break-message"
              className={cn(
                "text-sm resize-none",
                fallbackTextareaShouldMask && "bg-transparent text-transparent",
              )}
              rows={3}
              value={settingsDraft.breakMessage}
              onChange={onTextChange.bind(null, "breakMessage")}
              disabled={!settingsDraft.breaksEnabled}
              placeholder="Enter your break message..."
              ref={(element) => {
                fallbackMessageRef.current = element;
              }}
              style={
                fallbackTextareaShouldMask
                  ? {
                      color: "transparent",
                      backgroundColor: "transparent",
                      caretColor: "hsl(var(--foreground))",
                    }
                  : undefined
              }
            />
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}
