import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import moment from "moment";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MessageColorEffect, SoundType } from "../../../types/settings";
import type {
  BreakMessageAttachment,
  BreakMessageContent,
  Settings,
} from "../../../types/settings";
import { FindBar } from "../find-bar";
import { TimeRemaining } from "./utils";
import { useIpc } from "../../contexts/ipc-context";

const BREATHING_PRESETS: Record<MessageColorEffect, string[]> = {
  [MessageColorEffect.Static]: [],
  [MessageColorEffect.BreathingAurora]: ["#38ef7d", "#4facfe", "#38ef7d"],
  [MessageColorEffect.BreathingSunset]: ["#ff9966", "#ff5e62", "#ff9966"],
  [MessageColorEffect.BreathingOcean]: ["#43cea2", "#185a9d", "#43cea2"],
};

const INHERITED_TEXT_STYLE = { color: "inherit" as const };

interface BreakProgressProps {
  breakMessage: BreakMessageContent;
  breakTitle: string;
  endBreakEnabled: boolean;
  onEndBreak: (durationMs?: number) => void | Promise<void>;
  onNextMessage?: () => void | Promise<void>;
  onPreviousMessage?: () => void | Promise<void>;
  onAdjustBreakDuration: (deltaMs: number) => void | Promise<void>;
  onPauseBreak: () => void | Promise<void>;
  onResumeBreak: () => void | Promise<void>;
  settings: Settings;
  uiColor: string;
  titleColor: string;
  messageColor: string;
  messageColorEffect: MessageColorEffect;
  isClosing?: boolean;
  sharedBreakEndTime?: number | null;
  isPaused: boolean;
  pausedRemainingMs?: number | null;
  totalDurationMs?: number | null;
  canSkipMessage?: boolean;
  switchMessagePending?: boolean;
  hasPreviousMessage?: boolean;
  hasNextMessage?: boolean;
}

type ListKind = "ul" | "ol";
type ListStyle = "decimal" | "lower-alpha";

interface BuildFormattedMessageOptions {
  searchTerm?: string;
  activeMatchIndex?: number;
}

interface FormatToken {
  type: "text" | "bold" | "italic" | "underline" | "highlight" | "size";
  content: string;
  fontSize?: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse inline formatting from text and return tokens
 * Supports:
 * - **bold**
 * - *italic*
 * - __underline__
 * - ==highlight==
 * - {size:20}custom size{/size}
 */
function parseInlineFormatting(text: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  let i = 0;

  while (i < text.length) {
    // Check for {size:N}...{/size}
    const sizeMatch = text.slice(i).match(/^\{size:(\d+)\}/);
    if (sizeMatch) {
      const fontSize = Number.parseInt(sizeMatch[1], 10);
      const closeTag = "{/size}";
      const closeIndex = text.indexOf(closeTag, i + sizeMatch[0].length);

      if (closeIndex !== -1) {
        const content = text.slice(i + sizeMatch[0].length, closeIndex);
        tokens.push({
          type: "size",
          content,
          fontSize: fontSize || 16,
        });
        i = closeIndex + closeTag.length;
        continue;
      }
    }

    // Check for **bold**
    if (text.slice(i, i + 2) === "**") {
      const closeIndex = text.indexOf("**", i + 2);
      if (closeIndex !== -1) {
        const content = text.slice(i + 2, closeIndex);
        tokens.push({ type: "bold", content });
        i = closeIndex + 2;
        continue;
      }
    }

    // Check for __underline__
    if (text.slice(i, i + 2) === "__") {
      const closeIndex = text.indexOf("__", i + 2);
      if (closeIndex !== -1) {
        const content = text.slice(i + 2, closeIndex);
        tokens.push({ type: "underline", content });
        i = closeIndex + 2;
        continue;
      }
    }

    // Check for ==highlight==
    if (text.slice(i, i + 2) === "==") {
      const closeIndex = text.indexOf("==", i + 2);
      if (closeIndex !== -1) {
        const content = text.slice(i + 2, closeIndex);
        tokens.push({ type: "highlight", content });
        i = closeIndex + 2;
        continue;
      }
    }

    // Check for *italic* (single asterisk, not followed by another asterisk)
    if (text[i] === "*" && text[i + 1] !== "*") {
      const closeIndex = text.indexOf("*", i + 1);
      if (closeIndex !== -1 && text[closeIndex - 1] !== "*") {
        const content = text.slice(i + 1, closeIndex);
        tokens.push({ type: "italic", content });
        i = closeIndex + 1;
        continue;
      }
    }

    // Regular text
    let textContent = "";
    while (
      i < text.length &&
      text[i] !== "*" &&
      text.slice(i, i + 2) !== "__" &&
      text.slice(i, i + 2) !== "==" &&
      !text.slice(i).match(/^\{size:\d+\}/)
    ) {
      textContent += text[i];
      i++;
    }

    if (textContent) {
      tokens.push({ type: "text", content: textContent });
    }
  }

  return tokens;
}

/**
 * Render format tokens as React nodes
 */
function renderFormatTokens(
  tokens: FormatToken[],
  keyPrefix: string
): ReactNode[] {
  return tokens.map((token, idx) => {
    const key = `${keyPrefix}-token-${idx}`;

    switch (token.type) {
      case "bold":
        return (
          <strong key={key} style={INHERITED_TEXT_STYLE}>
            {token.content}
          </strong>
        );
      case "italic":
        return (
          <em key={key} style={INHERITED_TEXT_STYLE}>
            {token.content}
          </em>
        );
      case "underline":
        return (
          <span
            key={key}
            style={{ textDecoration: "underline", ...INHERITED_TEXT_STYLE }}
          >
            {token.content}
          </span>
        );
      case "highlight":
        return (
          <span
            key={key}
            style={{
              backgroundColor: "rgba(255, 255, 0, 0.3)",
              padding: "0 4px",
              borderRadius: "2px",
              ...INHERITED_TEXT_STYLE,
            }}
          >
            {token.content}
          </span>
        );
      case "size":
        return (
          <span
            key={key}
            style={{ fontSize: `${token.fontSize}px`, ...INHERITED_TEXT_STYLE }}
          >
            {token.content}
          </span>
        );
      default:
        return token.content;
    }
  });
}

function buildFormattedMessage(
  text: string,
  options: BuildFormattedMessageOptions = {}
): { nodes: ReactNode[]; totalMatches: number } {
  const lines = text.split(/\r?\n/);
  const nodes: ReactNode[] = [];

  const searchTerm = options.searchTerm?.trim();
  const activeMatchIndex = options.activeMatchIndex ?? 0;
  const searchPattern =
    searchTerm && searchTerm.length > 0 ? escapeRegExp(searchTerm) : null;
  let matchCounter = 0;

  const applyHighlights = (value: string): ReactNode[] => {
    // First parse inline formatting
    const tokens = parseInlineFormatting(value);

    if (!searchPattern) {
      return renderFormatTokens(tokens, "fmt");
    }

    if (value.length === 0) {
      return [value];
    }

    // Apply search highlighting to each token's content
    const highlightedTokens: ReactNode[] = [];
    tokens.forEach((token, tokenIdx) => {
      const tokenContent = token.content;
      const regex = new RegExp(searchPattern, "gi");
      const parts: ReactNode[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(tokenContent)) !== null) {
        if (match.index > lastIndex) {
          parts.push(tokenContent.slice(lastIndex, match.index));
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
          </mark>
        );

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < tokenContent.length) {
        parts.push(tokenContent.slice(lastIndex));
      }

      if (parts.length === 0) {
        parts.push(tokenContent);
      }

      // Wrap the highlighted content in the appropriate format
      const wrappedContent =
        parts.length === 1 && typeof parts[0] === "string" ? (
          parts[0]
        ) : (
          <>{parts}</>
        );

      switch (token.type) {
        case "bold":
          highlightedTokens.push(
            <strong key={`fmt-${tokenIdx}`} style={INHERITED_TEXT_STYLE}>
              {wrappedContent}
            </strong>
          );
          break;
        case "italic":
          highlightedTokens.push(
            <em key={`fmt-${tokenIdx}`} style={INHERITED_TEXT_STYLE}>
              {wrappedContent}
            </em>
          );
          break;
        case "underline":
          highlightedTokens.push(
            <span
              key={`fmt-${tokenIdx}`}
              style={{ textDecoration: "underline", ...INHERITED_TEXT_STYLE }}
            >
              {wrappedContent}
            </span>
          );
          break;
        case "highlight":
          highlightedTokens.push(
            <span
              key={`fmt-${tokenIdx}`}
              style={{
                backgroundColor: "rgba(255, 255, 0, 0.3)",
                padding: "0 4px",
                borderRadius: "2px",
                ...INHERITED_TEXT_STYLE,
              }}
            >
              {wrappedContent}
            </span>
          );
          break;
        case "size":
          highlightedTokens.push(
            <span
              key={`fmt-${tokenIdx}`}
              style={{
                fontSize: `${token.fontSize}px`,
                ...INHERITED_TEXT_STYLE,
              }}
            >
              {wrappedContent}
            </span>
          );
          break;
        default:
          highlightedTokens.push(wrappedContent);
      }
    });

    return highlightedTokens;
  };

  let blockKey = 0;
  let paragraphLines: string[] = [];
  let listState: {
    kind: ListKind;
    items: string[];
    start?: number;
    style?: ListStyle;
  } | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const content = paragraphLines.join("\n");
    nodes.push(
      <p
        className="whitespace-pre-wrap break-words"
        style={INHERITED_TEXT_STYLE}
        key={`p-${blockKey++}`}
      >
        {applyHighlights(content)}
      </p>
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
            <li
              key={`${listKey}-item-${idx}`}
              className="whitespace-pre-wrap break-words"
              style={INHERITED_TEXT_STYLE}
            >
              {applyHighlights(item)}
            </li>
          ))}
        </ul>
      );
    } else {
      const styleProps =
        listState.style === "lower-alpha"
          ? { listStyleType: "lower-alpha" as const }
          : undefined;
      const listClass =
        listState.style === "lower-alpha"
          ? "pl-5 space-y-1"
          : "list-decimal pl-5 space-y-1";

      nodes.push(
        <ol
          key={listKey}
          className={listClass}
          start={listState.start}
          style={styleProps}
        >
          {listState.items.map((item, idx) => (
            <li
              key={`${listKey}-item-${idx}`}
              className="whitespace-pre-wrap break-words"
              style={INHERITED_TEXT_STYLE}
            >
              {applyHighlights(item)}
            </li>
          ))}
        </ol>
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
      if (
        !listState ||
        listState.kind !== "ol" ||
        listState.style !== "decimal"
      ) {
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
      if (
        !listState ||
        listState.kind !== "ol" ||
        listState.style !== "lower-alpha"
      ) {
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
      <p
        className="whitespace-pre-wrap break-words"
        style={INHERITED_TEXT_STYLE}
        key={`p-${blockKey++}`}
      >
        {applyHighlights(text)}
      </p>
    );
  }

  return { nodes, totalMatches: matchCounter };
}

function toTimeRemaining(ms: number): TimeRemaining {
  const clampedMs = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  const totalSeconds = Math.floor(clampedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

export function BreakProgress({
  breakMessage,
  breakTitle,
  endBreakEnabled,
  onEndBreak,
  onNextMessage,
  onPreviousMessage,
  onAdjustBreakDuration,
  onPauseBreak,
  onResumeBreak,
  settings,
  uiColor,
  titleColor,
  messageColor,
  messageColorEffect,
  isClosing = false,
  sharedBreakEndTime = null,
  isPaused,
  pausedRemainingMs = null,
  totalDurationMs = null,
  canSkipMessage = false,
  switchMessagePending = false,
  hasPreviousMessage = false,
  hasNextMessage = true,
}: BreakProgressProps) {
  const ipc = useIpc();
  const [timeRemaining, setTimeRemaining] = useState<TimeRemaining | null>(
    null
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [breakStartTime] = useState(new Date());
  const [pauseActionPending, setPauseActionPending] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<BreakMessageAttachment | null>(null);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarFocusToken, setFindBarFocusToken] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastTouchDistance, setLastTouchDistance] = useState<number | null>(
    null
  );
  const [lastTouchCenter, setLastTouchCenter] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const soundPlayedRef = useRef(false);
  const isClosingRef = useRef(isClosing);
  const messageContainerRef = useRef<HTMLDivElement | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const baselineDurationMsRef = useRef<number | null>(null);
  const remainingMsRef = useRef<number>(0);
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

  const createColorAnimation = useCallback(
    (baseColor: string, enabled: boolean) => {
      if (!enabled || messageColorEffect === MessageColorEffect.Static) {
        return {
          initial: { color: baseColor },
          animate: { color: baseColor },
          transition: undefined,
        };
      }

      const palette =
        BREATHING_PRESETS[messageColorEffect] &&
        BREATHING_PRESETS[messageColorEffect].length > 0
          ? BREATHING_PRESETS[messageColorEffect]
          : [baseColor];

      return {
        initial: { color: palette[0] ?? baseColor },
        animate: { color: palette },
        transition: {
          duration: 6,
          repeat: Infinity,
          repeatType: "reverse" as const,
          ease: "easeInOut" as const,
        },
      };
    },
    [messageColorEffect]
  );

  const messageAnimation = useMemo(
    () => createColorAnimation(messageColor, true),
    [createColorAnimation, messageColor]
  );

  const titleAnimation = useMemo(
    () =>
      createColorAnimation(
        titleColor,
        Boolean(settings.applyMessageColorEffectToTitle)
      ),
    [createColorAnimation, settings.applyMessageColorEffectToTitle, titleColor]
  );

  const buttonsAnimation = useMemo(
    () =>
      createColorAnimation(
        uiColor,
        Boolean(settings.applyMessageColorEffectToButtons)
      ),
    [createColorAnimation, settings.applyMessageColorEffectToButtons, uiColor]
  );

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

  const handleEndBreakRequest = useCallback(() => {
    const baseline = baselineDurationMsRef.current;
    const remaining = remainingMsRef.current;

    if (baseline && baseline > 0) {
      const elapsedMs = Math.max(0, baseline - remaining);
      onEndBreak(elapsedMs);
      return;
    }

    const elapsedMs = Math.max(0, Date.now() - breakStartTime.getTime());
    onEndBreak(elapsedMs);
  }, [breakStartTime, onEndBreak]);

  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handlePauseToggle = useCallback(async () => {
    if (pauseActionPending) {
      return;
    }

    setPauseActionPending(true);

    try {
      if (isPaused) {
        await Promise.resolve(onResumeBreak());
      } else {
        await Promise.resolve(onPauseBreak());
      }
    } catch (error) {
      console.warn("Failed to toggle break pause state", error);
    } finally {
      if (isMounted.current) {
        setPauseActionPending(false);
      }
    }
  }, [isPaused, onPauseBreak, onResumeBreak, pauseActionPending]);

  const handleAdjustDuration = useCallback(
    (delta: number) => {
      void onAdjustBreakDuration(delta);
    },
    [onAdjustBreakDuration]
  );

  const handleNextMessageClick = useCallback(() => {
    if (!onNextMessage) {
      return;
    }
    void onNextMessage();
  }, [onNextMessage]);

  const handlePreviousMessageClick = useCallback(() => {
    if (!onPreviousMessage) {
      return;
    }
    void onPreviousMessage();
  }, [onPreviousMessage]);

  const canShowPreviousMessageButton = Boolean(
    canSkipMessage && onPreviousMessage
  );
  const canShowNextMessageButton = Boolean(canSkipMessage && onNextMessage);
  const previousMessageDisabled =
    isClosing || switchMessagePending || !hasPreviousMessage;
  const nextMessageDisabled =
    isClosing || switchMessagePending || !hasNextMessage;

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
    if (
      !findBarOpen ||
      normalizedSearchTerm.length === 0 ||
      totalMatches === 0
    ) {
      return;
    }

    const container = messageContainerRef.current;
    if (!container) {
      return;
    }

    const activeMatch = container.querySelector<HTMLElement>(
      `[data-break-match-index="${activeMatchIndex}"]`
    );

    if (activeMatch) {
      activeMatch.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
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

      if (
        !findBarOpen ||
        normalizedSearchTerm.length === 0 ||
        totalMatches === 0
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
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
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
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
    setIsDragging(false);
    setLastTouchDistance(null);
    setLastTouchCenter(null);
  }, []);

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!previewAttachment) {
        return;
      }

      event.preventDefault();

      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      setZoomLevel((prev) => {
        const newZoom = Math.max(0.5, Math.min(5, prev + delta));
        return newZoom;
      });
    },
    [previewAttachment]
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (zoomLevel <= 1) {
        return;
      }

      event.preventDefault();
      setIsDragging(true);
      setDragStart({
        x: event.clientX - panPosition.x,
        y: event.clientY - panPosition.y,
      });
    },
    [panPosition, zoomLevel]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!isDragging || zoomLevel <= 1) {
        return;
      }

      event.preventDefault();
      setPanPosition({
        x: event.clientX - dragStart.x,
        y: event.clientY - dragStart.y,
      });
    },
    [dragStart, isDragging, zoomLevel]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const getTouchDistance = useCallback(
    (touch1: React.Touch, touch2: React.Touch): number => {
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    },
    []
  );

  const getTouchCenter = useCallback(
    (touch1: React.Touch, touch2: React.Touch): { x: number; y: number } => {
      return {
        x: (touch1.clientX + touch2.clientX) / 2,
        y: (touch1.clientY + touch2.clientY) / 2,
      };
    },
    []
  );

  const handleTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (event.touches.length === 2) {
        // Two-finger pinch to zoom and pan
        event.preventDefault();
        const distance = getTouchDistance(event.touches[0], event.touches[1]);
        const center = getTouchCenter(event.touches[0], event.touches[1]);
        setLastTouchDistance(distance);
        setLastTouchCenter(center);
        setIsDragging(false);
      } else if (event.touches.length === 1) {
        // Single-finger drag to pan
        event.preventDefault();
        setIsDragging(true);
        setDragStart({
          x: event.touches[0].clientX - panPosition.x,
          y: event.touches[0].clientY - panPosition.y,
        });
      }
    },
    [getTouchCenter, getTouchDistance, panPosition]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (
        event.touches.length === 2 &&
        lastTouchDistance !== null &&
        lastTouchCenter !== null
      ) {
        // Handle simultaneous pinch zoom and pan
        event.preventDefault();

        const distance = getTouchDistance(event.touches[0], event.touches[1]);
        const center = getTouchCenter(event.touches[0], event.touches[1]);

        // Calculate zoom scale
        const scale = distance / lastTouchDistance;
        setZoomLevel((prev) => Math.max(0.5, Math.min(5, prev * scale)));

        // Calculate pan based on center point movement
        const centerDeltaX = center.x - lastTouchCenter.x;
        const centerDeltaY = center.y - lastTouchCenter.y;
        setPanPosition((prev) => ({
          x: prev.x + centerDeltaX,
          y: prev.y + centerDeltaY,
        }));

        // Update last values
        setLastTouchDistance(distance);
        setLastTouchCenter(center);
      } else if (event.touches.length === 1 && isDragging) {
        // Handle single-finger panning
        event.preventDefault();
        setPanPosition({
          x: event.touches[0].clientX - dragStart.x,
          y: event.touches[0].clientY - dragStart.y,
        });
      }
    },
    [
      dragStart,
      getTouchCenter,
      getTouchDistance,
      isDragging,
      lastTouchCenter,
      lastTouchDistance,
    ]
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      // Only clear states if all touches are done
      if (event.touches.length === 0) {
        setIsDragging(false);
        setLastTouchDistance(null);
        setLastTouchCenter(null);
      } else if (event.touches.length === 1) {
        // Transition from pinch to pan - reset drag start position
        setLastTouchDistance(null);
        setLastTouchCenter(null);
        setDragStart({
          x: event.touches[0].clientX - panPosition.x,
          y: event.touches[0].clientY - panPosition.y,
        });
      }
    },
    [panPosition]
  );

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

  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container || !previewAttachment) {
      return undefined;
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel, previewAttachment]);

  const isPrimaryWindow = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const windowId = urlParams.get("windowId");
    return windowId === "0" || windowId === null;
  }, []);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | undefined;

    if (
      isPrimaryWindow &&
      settings.soundType !== SoundType.None &&
      !soundPlayedRef.current
    ) {
      soundPlayedRef.current = true;
      ipc.invokeStartSound(settings.soundType, settings.breakSoundVolume);
    }

    const sanitizeDurationMs = (
      value: number | null | undefined
    ): number | null => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
      }
      const normalized = Math.max(1, Math.round(value));
      return normalized > 0 ? normalized : 1;
    };

    const defaultDurationMs =
      sanitizeDurationMs(totalDurationMs) ??
      sanitizeDurationMs(baselineDurationMsRef.current) ??
      Math.max(1, Math.round(settings.breakLengthSeconds)) * 1000;

    const updateFromRemaining = (
      remainingMsRaw: number,
      baselineMsRaw?: number
    ) => {
      const baselineMs =
        sanitizeDurationMs(baselineMsRaw) ??
        sanitizeDurationMs(totalDurationMs) ??
        defaultDurationMs;
      const remainingMs =
        sanitizeDurationMs(remainingMsRaw) ?? baselineMs ?? defaultDurationMs;
      const safeBaseline = baselineMs ?? defaultDurationMs;
      const safeRemaining = Math.min(Math.max(0, remainingMs), safeBaseline);

      baselineDurationMsRef.current = safeBaseline;
      remainingMsRef.current = safeRemaining;
      setProgress(safeBaseline > 0 ? 1 - safeRemaining / safeBaseline : 1);
      setTimeRemaining(toTimeRemaining(safeRemaining));
    };

    if (isPaused) {
      const remainingCandidate =
        sanitizeDurationMs(pausedRemainingMs ?? remainingMsRef.current) ??
        defaultDurationMs;
      updateFromRemaining(remainingCandidate);
      return () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };
    }

    const MINIMUM_REMAINING_BUFFER_MS = 500;

    const resolveBreakTiming = async (): Promise<{
      breakEndMoment: moment.Moment;
      baselineDurationMs: number;
      initialRemainingMs: number;
    }> => {
      const now = moment();

      const computeBaselineDuration = async (): Promise<number> => {
        const directDuration = sanitizeDurationMs(totalDurationMs);
        if (directDuration) {
          return directDuration;
        }
        try {
          const lengthSecondsRaw = await ipc.invokeGetBreakLength();
          const fallbackSeconds =
            typeof lengthSecondsRaw === "number" &&
            Number.isFinite(lengthSecondsRaw) &&
            lengthSecondsRaw !== null
              ? Math.max(1, Math.round(lengthSecondsRaw))
              : Math.max(1, Math.round(settings.breakLengthSeconds));
          return fallbackSeconds * 1000;
        } catch (error) {
          console.warn(
            "Failed to get break length from IPC, using settings fallback",
            error
          );
          return Math.max(1, Math.round(settings.breakLengthSeconds)) * 1000;
        }
      };

      const fallbackDurationMs = await computeBaselineDuration();

      if (sharedBreakEndTime !== null) {
        const normalized = Number(sharedBreakEndTime);
        if (Number.isFinite(normalized)) {
          const candidate = moment(normalized);
          if (candidate.isValid()) {
            const rawRemainingMs = candidate.diff(now, "milliseconds");
            if (rawRemainingMs <= MINIMUM_REMAINING_BUFFER_MS) {
              const clampedRemaining = Math.max(0, rawRemainingMs);
              const immediateMoment = clampedRemaining > 0 ? candidate : now;
              return {
                breakEndMoment: immediateMoment,
                baselineDurationMs: fallbackDurationMs,
                initialRemainingMs: clampedRemaining,
              };
            }

            return {
              breakEndMoment: candidate,
              baselineDurationMs: fallbackDurationMs,
              initialRemainingMs: rawRemainingMs,
            };
          }
        }
      }

      const fallbackEnd = moment().add(fallbackDurationMs, "milliseconds");
      return {
        breakEndMoment: fallbackEnd,
        baselineDurationMs: fallbackDurationMs,
        initialRemainingMs: fallbackDurationMs,
      };
    };

    (async () => {
      const timing = await resolveBreakTiming();

      if (!isMounted.current) {
        return;
      }

      const { breakEndMoment, baselineDurationMs, initialRemainingMs } = timing;

      updateFromRemaining(initialRemainingMs, baselineDurationMs);

      const tick = () => {
        if (!isMounted.current) return;

        const now = moment();

        if (now.isSameOrAfter(breakEndMoment)) {
          updateFromRemaining(0, baselineDurationMs);
          const baseline = baselineDurationMsRef.current;
          const remaining = remainingMsRef.current;
          const elapsedMs =
            baseline && baseline > 0
              ? Math.max(0, baseline - remaining)
              : Math.max(0, Date.now() - breakStartTime.getTime());
          ipc.invokeCompleteBreakTracking(elapsedMs);
          onEndBreak();
          return;
        }

        const rawRemainingMs = breakEndMoment.diff(now, "milliseconds");
        updateFromRemaining(rawRemainingMs, baselineDurationMs);

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
    breakStartTime,
    isPaused,
    isPrimaryWindow,
    onEndBreak,
    pausedRemainingMs,
    settings,
    sharedBreakEndTime,
    totalDurationMs,
  ]);

  const fadeIn = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.8, delay: 0.5 },
  };

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Only close if clicking directly on the backdrop, not on children
      if (event.target === event.currentTarget) {
        closeAttachment();
      }
    },
    [closeAttachment]
  );

  if (timeRemaining === null || progress === null) {
    return null;
  }

  const progressPercentage = (progress || 0) * 100;

  return (
    <>
      {previewAttachment && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur"
          onClick={handleBackdropClick}
          role="presentation"
        >
          <div className="relative flex flex-col items-center gap-4 max-h-[90vh] max-w-[90vw]">
            <div
              ref={imageContainerRef}
              className="relative overflow-hidden rounded-lg"
              style={{
                maxHeight: "80vh",
                maxWidth: "88vw",
                cursor:
                  zoomLevel > 1
                    ? isDragging
                      ? "grabbing"
                      : "grab"
                    : "default",
                touchAction: "none",
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            >
              <img
                src={previewAttachment.uri || previewAttachment.dataUrl || ""}
                alt={previewAttachment.name || "Break attachment"}
                className="max-h-[80vh] max-w-[88vw] object-contain select-none"
                style={{
                  transform: `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`,
                  transition: isDragging ? "none" : "transform 0.1s ease-out",
                }}
                draggable={false}
              />
            </div>
            {previewAttachment.name && (
              <div className="text-sm text-white/80">
                {previewAttachment.name}
              </div>
            )}
            <Button variant="outline" onClick={closeAttachment}>
              Close
            </Button>
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
        {/* Title */}
        <motion.h1
          className="text-3xl font-semibold tracking-tight mb-4 flex-shrink-0"
          style={{ color: titleColor }}
          initial={titleAnimation.initial}
          animate={titleAnimation.animate}
          transition={titleAnimation.transition}
        >
          {breakTitle}
        </motion.h1>

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
                <p
                  className="whitespace-pre-wrap break-words"
                  style={INHERITED_TEXT_STYLE}
                >
                  {breakMessage.text}
                </p>
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
                      if (event.key === "Enter" || event.key === " ") {
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
              <div className="flex justify-end items-center mb-2 gap-2 flex-wrap">
                {isPaused && (
                  <span
                    className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border"
                    style={{
                      color: uiColor,
                      borderColor: uiColor,
                      backgroundColor: "rgba(255, 255, 255, 0.08)",
                    }}
                  >
                    Paused
                  </span>
                )}
                <motion.div
                  className="flex items-center gap-2"
                  initial={buttonsAnimation.initial}
                  animate={buttonsAnimation.animate}
                  transition={buttonsAnimation.transition}
                  style={{ color: uiColor }}
                >
                  <div
                    className="text-sm font-medium opacity-60 flex-shrink-0 tabular-nums flex items-center gap-0.5"
                    style={{ color: "inherit" }}
                  >
                    {timeRemaining.hours > 0 && (
                      <>
                        <span style={{ color: "inherit" }}>
                          {String(timeRemaining.hours).padStart(2, "0")}
                        </span>
                        <span style={{ color: "inherit" }}>:</span>
                      </>
                    )}
                    <span style={{ color: "inherit" }}>
                      {String(timeRemaining.minutes).padStart(2, "0")}
                    </span>
                    <span style={{ color: "inherit" }}>:</span>
                    <span style={{ color: "inherit" }}>
                      {String(timeRemaining.seconds).padStart(2, "0")}
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-2"
                    style={{ color: "inherit" }}
                  >
                    {canShowPreviousMessageButton && (
                      <Button
                        className="!bg-transparent hover:!bg-black/10 active:!bg-black/20 border-white/20"
                        disabled={previousMessageDisabled}
                        onClick={handlePreviousMessageClick}
                        variant="outline"
                        style={{
                          color: "inherit",
                          borderColor: "rgba(255, 255, 255, 0.2)",
                          opacity: previousMessageDisabled ? 0.7 : 1,
                        }}
                      >
                        Previous Message
                      </Button>
                    )}
                    {canShowNextMessageButton && (
                      <Button
                        className="!bg-transparent hover:!bg-black/10 active:!bg-black/20 border-white/20"
                        disabled={nextMessageDisabled}
                        onClick={handleNextMessageClick}
                        variant="outline"
                        style={{
                          color: "inherit",
                          borderColor: "rgba(255, 255, 255, 0.2)",
                          opacity: nextMessageDisabled ? 0.7 : 1,
                        }}
                      >
                        Next Message
                      </Button>
                    )}
                    <Button
                      className="!bg-transparent hover:!bg-black/10 active:!bg-black/20 border-white/20"
                      disabled={isClosing}
                      onClick={() => handleAdjustDuration(30000)}
                      variant="outline"
                      style={{
                        color: "inherit",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                      }}
                    >
                      +30s
                    </Button>
                    <Button
                      aria-pressed={isPaused}
                      className="!bg-transparent hover:!bg-black/10 active:!bg-black/20 border-white/20"
                      disabled={pauseActionPending || isClosing}
                      onClick={handlePauseToggle}
                      variant="outline"
                      style={{
                        color: "inherit",
                        borderColor: isPaused
                          ? "currentColor"
                          : "rgba(255, 255, 255, 0.2)",
                        backgroundColor: isPaused
                          ? "rgba(255, 255, 255, 0.08)"
                          : undefined,
                        opacity: pauseActionPending ? 0.7 : 1,
                      }}
                    >
                      {isPaused ? "Resume" : "Pause"}
                    </Button>
                    <Button
                      className="!bg-transparent hover:!bg-black/10 active:!bg-black/20 border-white/20"
                      disabled={isClosing}
                      onClick={() => handleAdjustDuration(-30000)}
                      variant="outline"
                      style={{
                        color: "inherit",
                        borderColor: "rgba(255, 255, 255, 0.2)",
                      }}
                    >
                      -30s
                    </Button>
                    {endBreakEnabled && (
                      <Button
                        className="!bg-transparent hover:!bg-black/10 active:!bg-black/20 border-white/20"
                        disabled={isClosing}
                        onClick={handleEndBreakRequest}
                        variant="outline"
                        style={{
                          color: "inherit",
                          borderColor: "rgba(255, 255, 255, 0.2)",
                        }}
                      >
                        End Break
                      </Button>
                    )}
                  </div>
                </motion.div>
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
