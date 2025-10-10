import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import moment from "moment";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MessageColorEffect, SoundType } from "../../../types/settings";
import type { BreakMessageAttachment, BreakMessageContent, Settings } from "../../../types/settings";
import { FindBar } from "../find-bar";
import { TimeRemaining } from "./utils";

const BREATHING_PRESETS: Record<MessageColorEffect, string[]> = {
  [MessageColorEffect.Static]: [],
  [MessageColorEffect.BreathingAurora]: ["#38ef7d", "#4facfe", "#38ef7d"],
  [MessageColorEffect.BreathingSunset]: ["#ff9966", "#ff5e62", "#ff9966"],
  [MessageColorEffect.BreathingOcean]: ["#43cea2", "#185a9d", "#43cea2"],
};

interface BreakProgressProps {
  breakMessage: BreakMessageContent;
  breakTitle: string;
  endBreakEnabled: boolean;
  onEndBreak: () => void;
  settings: Settings;
  uiColor: string;
  titleColor: string;
  messageColor: string;
  messageColorEffect: MessageColorEffect;
  isClosing?: boolean;
  sharedBreakEndTime?: number | null;
}

type ListKind = "ul" | "ol";
type ListStyle = "decimal" | "lower-alpha";

interface BuildFormattedMessageOptions {
  searchTerm?: string;
  activeMatchIndex?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFormattedMessage(
  text: string,
  options: BuildFormattedMessageOptions = {},
): { nodes: ReactNode[]; totalMatches: number } {
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];

  const searchTerm = options.searchTerm?.trim();
  const activeMatchIndex = options.activeMatchIndex ?? 0;
  const searchPattern =
    searchTerm && searchTerm.length > 0 ? escapeRegExp(searchTerm) : null;
  let matchCounter = 0;

  const applyHighlights = (value: string): ReactNode[] => {
    if (!searchPattern) {
      return [value];
    }

    if (value.length === 0) {
      return [value];
    }

    const regex = new RegExp(searchPattern, "gi");
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parts.push(value.slice(lastIndex, match.index));
      }

      const currentIndex = matchCounter++;
      const isActive = currentIndex === activeMatchIndex;

      parts.push(
        <mark
          key={`match-${currentIndex}`}
          data-break-match="true"
          data-break-match-index={currentIndex}
          className={
            isActive
              ? "rounded-sm bg-yellow-400 px-0.5 text-black"
              : "rounded-sm bg-yellow-200 px-0.5 text-black"
          }
        >
          {match[0]}
        </mark>,
      );

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < value.length) {
      parts.push(value.slice(lastIndex));
    }

    if (parts.length === 0) {
      parts.push(value);
    }

    return parts;
  };

  let blockKey = 0;
  let paragraphLines: string[] = [];
  let listState:
    | {
        kind: ListKind;
        items: string[];
        start?: number;
        style?: ListStyle;
      }
    | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const content = paragraphLines.join("\n");
    nodes.push(
      <p className="whitespace-pre-wrap break-words" key={`p-${blockKey++}`}>
        {applyHighlights(content)}
      </p>,
    );
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listState) {
      return;
    }

    const listKey = `list-${blockKey++}`;

    if (listState.kind === "ul") {
      nodes.push(
        <ul key={listKey} className="list-disc pl-5 space-y-1">
          {listState.items.map((item, idx) => (
            <li key={`${listKey}-item-${idx}`} className="whitespace-pre-wrap break-words">
              {applyHighlights(item)}
            </li>
          ))}
        </ul>,
      );
    } else {
      const styleProps =
        listState.style === "lower-alpha"
          ? { listStyleType: "lower-alpha" as const }
          : undefined;
      const listClass =
        listState.style === "lower-alpha" ? "pl-5 space-y-1" : "list-decimal pl-5 space-y-1";

      nodes.push(
        <ol key={listKey} className={listClass} start={listState.start} style={styleProps}>
          {listState.items.map((item, idx) => (
            <li key={`${listKey}-item-${idx}`} className="whitespace-pre-wrap break-words">
              {applyHighlights(item)}
            </li>
          ))}
        </ol>,
      );
    }

    listState = null;
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[*-]\s+(.*)$/);
    const numericMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    const alphaMatch = trimmed.match(/^([a-zA-Z])\.\s+(.*)$/);

    if (bulletMatch) {
      flushParagraph();
      if (!listState || listState.kind !== "ul") {
        flushList();
        listState = { kind: "ul", items: [] };
      }
      listState.items.push(bulletMatch[1].trim());
      return;
    }

    if (numericMatch) {
      flushParagraph();
      const value = Number.parseInt(numericMatch[1], 10) || 1;
      if (!listState || listState.kind !== "ol" || listState.style !== "decimal") {
        flushList();
        listState = { kind: "ol", items: [], style: "decimal", start: value };
      } else if (listState.items.length === 0) {
        listState.start = value;
      }
      listState.items.push(numericMatch[2].trim());
      return;
    }

    if (alphaMatch) {
      flushParagraph();
      const letter = alphaMatch[1].toLowerCase();
      const value = letter.charCodeAt(0) - 96;
      const safeValue = Number.isNaN(value) || value < 1 ? 1 : value;
      if (!listState || listState.kind !== "ol" || listState.style !== "lower-alpha") {
        flushList();
        listState = {
          kind: "ol",
          items: [],
          style: "lower-alpha",
          start: safeValue,
        };
      } else if (listState.items.length === 0) {
        listState.start = safeValue;
      }
      listState.items.push(alphaMatch[2].trim());
      return;
    }

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      return;
    }

    flushList();
    paragraphLines.push(line);
  });

  flushParagraph();
  flushList();

  if (nodes.length === 0 && text.trim().length > 0) {
    nodes.push(
      <p className="whitespace-pre-wrap break-words" key={`p-${blockKey++}`}>
        {applyHighlights(text)}
      </p>,
    );
  }

  return { nodes, totalMatches: matchCounter };
}

export function BreakProgress({
  breakMessage,
  breakTitle,
  endBreakEnabled,
  onEndBreak,
  settings,
  uiColor,
  titleColor,
  messageColor,
  messageColorEffect,
  isClosing = false,
  sharedBreakEndTime = null,
}: BreakProgressProps) {
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining | null>(
    null,
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [breakStartTime] = useState(new Date());
  const [previewAttachment, setPreviewAttachment] =
    useState<BreakMessageAttachment | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarFocusToken, setFindBarFocusToken] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const soundPlayedRef = useRef(false);
  const isClosingRef = useRef(isClosing);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  isClosingRef.current = isClosing;

  const normalizedSearchTerm = searchTerm.trim();

  const { nodes: formattedMessage, totalMatches } = useMemo(() => {
    if (normalizedSearchTerm.length === 0) {
      return buildFormattedMessage(breakMessage.text);
    }

    return buildFormattedMessage(breakMessage.text, {
      searchTerm: normalizedSearchTerm,
      activeMatchIndex,
    });
  }, [breakMessage.text, normalizedSearchTerm, activeMatchIndex]);

  const messageAnimation = useMemo(() => {
    if (messageColorEffect === MessageColorEffect.Static) {
      return {
        initial: { color: messageColor },
        animate: { color: messageColor },
        transition: undefined,
      };
    }

    const palette =
      BREATHING_PRESETS[messageColorEffect] &&
      BREATHING_PRESETS[messageColorEffect].length > 0
        ? BREATHING_PRESETS[messageColorEffect]
        : [messageColor];

    return {
      initial: { color: palette[0] },
      animate: { color: palette },
      transition: {
        duration: 6,
        repeat: Infinity,
        repeatType: "reverse" as const,
        ease: "easeInOut" as const,
      },
    };
  }, [messageColor, messageColorEffect]);

  const handleQueryChange = useCallback((value: string) => {
    setSearchTerm(value);
    setActiveMatchIndex(0);
  }, []);

  const handleCloseFindBar = useCallback(() => {
    setFindBarOpen(false);
    setSearchTerm("");
    setActiveMatchIndex(0);
  }, []);

  const handleNextMatch = useCallback(() => {
    if (normalizedSearchTerm.length === 0 || totalMatches === 0) {
      return;
    }

    setActiveMatchIndex((previous) => {
      if (totalMatches === 0) {
        return 0;
      }
      return (previous + 1) % totalMatches;
    });
  }, [normalizedSearchTerm, totalMatches]);

  const handlePrevMatch = useCallback(() => {
    if (normalizedSearchTerm.length === 0 || totalMatches === 0) {
      return;
    }

    setActiveMatchIndex((previous) => {
      if (totalMatches === 0) {
        return 0;
      }
      return (previous - 1 + totalMatches) % totalMatches;
    });
  }, [normalizedSearchTerm, totalMatches]);

  useEffect(() => {
    if (normalizedSearchTerm.length === 0) {
      if (activeMatchIndex !== 0) {
        setActiveMatchIndex(0);
      }
      return;
    }

    if (totalMatches === 0 && activeMatchIndex !== 0) {
      setActiveMatchIndex(0);
      return;
    }

    if (totalMatches > 0 && activeMatchIndex >= totalMatches) {
      setActiveMatchIndex(0);
    }
  }, [activeMatchIndex, normalizedSearchTerm, totalMatches]);

  useEffect(() => {
    if (!findBarOpen || normalizedSearchTerm.length === 0 || totalMatches === 0) {
      return;
    }

    const container = messageContainerRef.current;
    if (!container) {
      return;
    }

    const activeMatch = container.querySelector<HTMLElement>(
      `[data-break-match-index="${activeMatchIndex}"]`,
    );

    if (activeMatch) {
      activeMatch.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
  }, [activeMatchIndex, findBarOpen, normalizedSearchTerm, totalMatches]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFindBarOpen(true);
        setFindBarFocusToken((value) => value + 1);
      }

      if (event.key === "Escape" && findBarOpen) {
        event.preventDefault();
        handleCloseFindBar();
      }

      if (!findBarOpen || normalizedSearchTerm.length === 0 || totalMatches === 0) {
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
    normalizedSearchTerm,
    totalMatches,
  ]);

  const openAttachment = useCallback((attachment: BreakMessageAttachment) => {
    setPreviewAttachment(attachment);
  }, []);

  const closeAttachment = useCallback(() => {
    setPreviewAttachment(null);
  }, []);

  useEffect(() => {
    if (!previewAttachment) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAttachment();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAttachment, previewAttachment]);

  const isPrimaryWindow = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const windowId = urlParams.get("windowId");
    return windowId === "0" || windowId === null;
  }, []);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    // Only play start sound from primary window and only once per break
    if (
      isPrimaryWindow &&
      settings.soundType !== SoundType.None &&
      !soundPlayedRef.current
    ) {
      soundPlayedRef.current = true;
      ipcRenderer.invokeStartSound(
        settings.soundType,
        settings.breakSoundVolume,
      );
    }

    (async () => {
      // Use shared end time if available (from synchronized break start), otherwise calculate it
      let breakEndTime: moment.Moment;
      if (sharedBreakEndTime) {
        breakEndTime = moment(sharedBreakEndTime);
      } else {
        const lengthSeconds = await ipcRenderer.invokeGetBreakLength();
        breakEndTime = moment().add(lengthSeconds, "seconds");
      }

      const startMsRemaining = moment(breakEndTime).diff(
        moment(),
        "milliseconds",
      );

      const tick = () => {
        const now = moment();

        if (now > moment(breakEndTime)) {
          // Always track break completion, regardless of which window triggers it
          const breakDurationMs =
            new Date().getTime() - breakStartTime.getTime();
          ipcRenderer.invokeCompleteBreakTracking(breakDurationMs);

          onEndBreak();
          return;
        }

        const msRemaining = moment(breakEndTime).diff(now, "milliseconds");
        setProgress(1 - msRemaining / startMsRemaining);
        setTimeRemaining({
          hours: Math.floor(msRemaining / 1000 / 3600),
          minutes: Math.floor(msRemaining / 1000 / 60),
          seconds: (msRemaining / 1000) % 60,
        });

        if (!isClosingRef.current) {
          timeoutId = setTimeout(tick, 50);
        }
      };

      tick();
    })();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    onEndBreak,
    settings,
    breakStartTime,
    isPrimaryWindow,
    sharedBreakEndTime,
  ]);

  const fadeIn = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.8, delay: 0.5 },
  };

  if (timeRemaining === null || progress === null) {
    return null;
  }

  const progressPercentage = (progress || 0) * 100;

  return (
    <>
      {previewAttachment && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur"
          onClick={closeAttachment}
          role="presentation"
        >
          <div
            className="relative flex flex-col items-center gap-4 max-h-[90vh] max-w-[90vw]"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={previewAttachment.uri || previewAttachment.dataUrl || ""}
              alt={previewAttachment.name || "Break attachment"}
              className="max-h-[80vh] max-w-[88vw] rounded-lg object-contain"
            />
            {previewAttachment.name && (
              <div className="text-sm text-white/80">{previewAttachment.name}</div>
            )}
            <Button variant="outline" onClick={closeAttachment}>Close</Button>
          </div>
        </div>
      )}

      <motion.div
        className="flex flex-col h-full w-full z-10 relative"
        {...fadeIn}
      >
        {findBarOpen && (
          <FindBar
            query={searchTerm}
            activeIndex={totalMatches > 0 ? activeMatchIndex : 0}
            matchCount={totalMatches}
            focusToken={findBarFocusToken}
            placeholder="Find in message"
            onQueryChange={handleQueryChange}
            onClose={handleCloseFindBar}
            onNext={handleNextMatch}
            onPrev={handlePrevMatch}
          />
        )}
        {/* Title and button row */}
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h1
            className="text-3xl font-semibold tracking-tight"
            style={{ color: titleColor }}
          >
            {breakTitle}
          </h1>
          {endBreakEnabled && (
            <Button
              className="!bg-transparent hover:!bg-black/10 active:!bg-black/20 border-white/20"
              onClick={onEndBreak}
              variant="outline"
              style={{
                color: uiColor,
                borderColor: "rgba(255, 255, 255, 0.2)",
              }}
            >
              {progress < 0.5 ? "Cancel Break" : "End Break"}
            </Button>
          )}
        </div>

        {/* Scrollable message + progress container */}
        <div className="flex flex-col min-h-0 flex-1 overflow-hidden">
          <div
            className="text-lg opacity-80 font-medium overflow-y-auto pr-2 custom-scroll flex-1 max-h-[60vh]"
            ref={messageContainerRef}
          >
          <motion.div
            className="space-y-4"
            initial={messageAnimation.initial}
            animate={messageAnimation.animate}
            transition={messageAnimation.transition}
            style={{ color: messageColor }}
          >
            {formattedMessage.length > 0 ? (
              formattedMessage
            ) : (
              <p className="whitespace-pre-wrap break-words">{breakMessage.text}</p>
            )}
          </motion.div>
          {breakMessage.attachments.length > 0 && (
            <div className="flex flex-wrap gap-3 mt-4">
              {breakMessage.attachments.map((attachment) => (
                <figure
                  key={attachment.id}
                  className="flex flex-col gap-1 text-sm cursor-zoom-in"
                  style={{ color: uiColor }}
                  onClick={() => openAttachment(attachment)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " " ) {
                      event.preventDefault();
                      openAttachment(attachment);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <img
                    src={attachment.uri || attachment.dataUrl || ""}
                    alt={attachment.name || "Break attachment"}
                    className="max-h-48 max-w-full rounded-lg border object-contain bg-black/20 pointer-events-none select-none"
                    style={{ borderColor: uiColor }}
                  />
                  {attachment.name && (
                    <figcaption className="text-xs opacity-70">
                      {attachment.name}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}
        </div>
        {/* Progress section */}
        <div className="pt-4 flex-shrink-0">
          <div className="w-full">
            <div className="flex justify-end items-center mb-2">
              <div
                className="text-sm font-medium opacity-60 flex-shrink-0 tabular-nums flex items-center gap-0.5"
                style={{ color: uiColor }}
              >
                <span style={{ color: uiColor }}>
                  {String(
                    Math.floor(timeRemaining.hours * 60 + timeRemaining.minutes),
                  ).padStart(2, "0")} {" "}
                </span>
                <span style={{ color: uiColor }}>:</span>
                <span style={{ color: uiColor }}>
                  {String(Math.floor(timeRemaining.seconds)).padStart(2, "0")}
                </span>
              </div>
            </div>
            <div
              className="w-full h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: "rgba(255, 255, 255, 0.2)" }}
            >
              <div
                className="h-full transition-all duration-75 ease-out"
                style={{
                  backgroundColor: uiColor,
                  width: `${progressPercentage}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
      </motion.div>
    </>
  );
}
