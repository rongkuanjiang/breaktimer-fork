/* global BreakTimerStartPayload, BreakTimerPausePayload */
import { motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  MessageColorEffect,
  SoundType,
  normalizeBreakMessage,
} from "../../types/settings";
import type { BreakMessageContent, Settings } from "../../types/settings";
import type {
  BreakMessageSwitchResult,
  BreakMessageUpdatePayload,
} from "../../types/breaks";
import { BreakNotification } from "./break/break-notification";
import { BreakProgress } from "./break/break-progress";
import { createDarkerRgba, createRgba } from "./break/utils";
import { useIpc } from "../contexts/ipc-context";

export default function Break() {
  const ipc = useIpc();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [currentBreakMessage, setCurrentBreakMessage] =
    useState<BreakMessageContent | null>(null);
  const [countingDown, setCountingDown] = useState(true);
  const [allowPostpone, setAllowPostpone] = useState<boolean | null>(null);
  const [timeSinceLastBreak, setTimeSinceLastBreak] = useState<number | null>(
    null
  );
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const [breakWindowReady, setBreakWindowReady] = useState(false);
  const [sharedBreakEndTime, setSharedBreakEndTime] = useState<number | null>(
    null
  );
  const [breakPaused, setBreakPaused] = useState(false);
  const breakPausedRef = useRef(false);
  const [pausedRemainingMs, setPausedRemainingMs] = useState<number | null>(
    null
  );
  const [breakTotalDurationMs, setBreakTotalDurationMs] = useState<
    number | null
  >(null);
  const [switchingMessage, setSwitchingMessage] = useState(false);
  const [hasPreviousMessage, setHasPreviousMessage] = useState(false);
  const [hasNextMessage, setHasNextMessage] = useState(true);
  const hasNotifiedWindowReadyRef = useRef(false);
  const hasSignaledBreakStartRef = useRef(false);
  const settingsRef = useRef<Settings | null>(null);

  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    breakPausedRef.current = breakPaused;
  }, [breakPaused]);

  const isPrimaryWindow = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const windowId = urlParams.get("windowId");
    return windowId === "0" || windowId === null;
  }, []);

  const applySwitchResult = useCallback(
    (
      payload:
        | BreakMessageSwitchResult
        | BreakMessageUpdatePayload
        | null
        | undefined,
      options?: { updateTimer?: boolean }
    ) => {
      if (!isMounted.current) {
        return;
      }
      const fallbackSource = settingsRef.current?.breakMessage ?? "";
      const normalized = payload?.message
        ? normalizeBreakMessage(payload.message)
        : normalizeBreakMessage(fallbackSource);
      setCurrentBreakMessage(normalized);

      const durationFromPayload =
        payload && "durationMs" in payload
          ? Number((payload as BreakMessageSwitchResult).durationMs)
          : NaN;

      let resolvedDurationMs: number | null = null;

      if (Number.isFinite(durationFromPayload) && durationFromPayload > 0) {
        resolvedDurationMs = Math.max(1, Math.round(durationFromPayload));
      } else if (
        typeof normalized?.durationSeconds === "number" &&
        Number.isFinite(normalized.durationSeconds) &&
        normalized.durationSeconds > 0
      ) {
        resolvedDurationMs =
          Math.max(1, Math.round(normalized.durationSeconds)) * 1000;
      } else {
        const fallbackLengthSecondsRaw =
          settingsRef.current?.breakLengthSeconds;
        if (
          typeof fallbackLengthSecondsRaw === "number" &&
          Number.isFinite(fallbackLengthSecondsRaw) &&
          fallbackLengthSecondsRaw > 0
        ) {
          resolvedDurationMs =
            Math.max(1, Math.round(fallbackLengthSecondsRaw)) * 1000;
        }
      }

      if (resolvedDurationMs !== null) {
        setBreakTotalDurationMs(resolvedDurationMs);
        if (options?.updateTimer) {
          if (breakPausedRef.current) {
            setPausedRemainingMs(resolvedDurationMs);
            setSharedBreakEndTime(null);
          } else {
            setSharedBreakEndTime(Date.now() + resolvedDurationMs);
            setPausedRemainingMs(null);
          }
        }
      }

      if (payload && typeof payload.hasPrevious === "boolean") {
        setHasPreviousMessage(payload.hasPrevious);
      } else if (!payload) {
        setHasPreviousMessage(false);
      }

      const fallbackHasNext =
        (settingsRef.current?.breakMessages?.length ?? 0) > 1;
      if (payload && typeof payload.hasNext === "boolean") {
        setHasNextMessage(payload.hasNext);
      } else {
        setHasNextMessage(fallbackHasNext);
      }
    },
    []
  );

  useEffect(() => {
    const init = async () => {
      const [allowPostpone, settings, timeSince, startedFromTray] =
        await Promise.all([
          ipc.invokeGetAllowPostpone(),
          ipc.invokeGetSettings(),
          ipc.invokeGetTimeSinceLastBreak(),
          ipc.invokeWasStartedFromTray(),
        ]);

      if (!isMounted.current) {
        return;
      }

      setAllowPostpone(allowPostpone);
      setSettings(settings);
      settingsRef.current = settings;
      const currentMessageResult =
        (await ipc.invokeGetCurrentBreakMessage()) as BreakMessageSwitchResult | null;

      if (!isMounted.current) {
        return;
      }

      applySwitchResult(currentMessageResult, { updateTimer: false });
      setTimeSinceLastBreak(timeSince);

      // Skip the countdown if immediately start breaks is enabled or started from tray
      if (settings.immediatelyStartBreaks || startedFromTray) {
        setCountingDown(false);
      }

      setReady(true);
    };

    // Listen for break start/resume broadcasts from other windows
    const handleBreakStart = (
      payload: BreakTimerStartPayload | number | string
    ) => {
      if (!isMounted.current) return;
      let breakEndTimeValue: number | null = null;
      let totalDurationValue: number | null = null;

      if (payload && typeof payload === "object" && "breakEndTime" in payload) {
        const endCandidate = Number(
          (payload as BreakTimerStartPayload).breakEndTime
        );
        breakEndTimeValue = Number.isFinite(endCandidate) ? endCandidate : null;
        const durationCandidate = Number(
          (payload as BreakTimerStartPayload).totalDurationMs
        );
        totalDurationValue = Number.isFinite(durationCandidate)
          ? Math.max(1, Math.round(durationCandidate))
          : null;
      } else if (typeof payload === "number") {
        breakEndTimeValue = payload;
      } else if (typeof payload === "string") {
        const parsed = Number.parseInt(payload, 10);
        breakEndTimeValue = Number.isFinite(parsed) ? parsed : null;
      }

      if (
        typeof totalDurationValue === "number" &&
        Number.isFinite(totalDurationValue) &&
        totalDurationValue > 0
      ) {
        setBreakTotalDurationMs(totalDurationValue);
      }

      setSharedBreakEndTime(breakEndTimeValue);
      setBreakPaused(false);
      setPausedRemainingMs(null);
      setCountingDown(false);
    };

    const handleBreakPause = (payload: BreakTimerPausePayload) => {
      if (!isMounted.current) return;
      const remainingCandidate = Number(payload?.remainingMs);
      const durationCandidate = Number(payload?.totalDurationMs);

      setBreakPaused(true);
      setSharedBreakEndTime(null);
      setPausedRemainingMs(
        Number.isFinite(remainingCandidate) && remainingCandidate >= 0
          ? remainingCandidate
          : null
      );

      if (Number.isFinite(durationCandidate) && durationCandidate !== 0) {
        setBreakTotalDurationMs(Math.max(1, Math.round(durationCandidate)));
      }
    };

    const handleBreakMessageUpdate = (payload: BreakMessageUpdatePayload) => {
      if (!isMounted.current) return;
      applySwitchResult(payload, { updateTimer: false });
      setSwitchingMessage(false);
    };

    // Listen for break end broadcasts from other windows
    const handleBreakEnd = () => {
      if (!isMounted.current) return;
      setClosing(true);
    };

    const removeBreakStart = ipc.onBreakStart(handleBreakStart);
    const removeBreakPause = ipc.onBreakPause(handleBreakPause);
    const removeBreakEnd = ipc.onBreakEnd(handleBreakEnd);
    const removeBreakMessageUpdate = ipc.onBreakMessageUpdate(
      handleBreakMessageUpdate
    );

    // Wait for ipcRenderer to be available and window to be ready
    // This ensures proper initialization without race conditions
    const startInit = () => {
      // Check if ipc is available
      if (typeof ipc === "undefined") {
        // Retry after a short delay if ipc isn't ready
        window.requestAnimationFrame(() => setTimeout(startInit, 50));
        return;
      }

      // Use requestAnimationFrame to ensure the DOM is fully ready
      window.requestAnimationFrame(() => {
        void init();
      });
    };

    startInit();

    return () => {
      removeBreakStart();
      removeBreakPause();
      removeBreakEnd();
      removeBreakMessageUpdate();
    };
  }, [applySwitchResult]);

  useEffect(() => {
    if (!ready || hasNotifiedWindowReadyRef.current) {
      return;
    }

    hasNotifiedWindowReadyRef.current = true;

    const notifyMainProcess = async () => {
      try {
        await ipc.invokeBreakWindowReady();
      } catch (error) {
        console.warn(
          "Failed to notify main process that break window is ready",
          error
        );
      }
    };

    void notifyMainProcess();
  }, [ready]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const signalBreakStart = useCallback(async () => {
    if (hasSignaledBreakStartRef.current) {
      return;
    }

    hasSignaledBreakStartRef.current = true;

    try {
      await ipc.invokeBreakStart();
    } catch (error) {
      hasSignaledBreakStartRef.current = false;
      console.warn("Failed to notify main process to start break", error);
    }
  }, []);

  useEffect(() => {
    // Ensure skipping the countdown still notifies the main process once
    if (countingDown || !ready || !isPrimaryWindow) {
      return;
    }

    if (hasSignaledBreakStartRef.current) {
      return;
    }

    if (sharedBreakEndTime !== null) {
      return;
    }

    signalBreakStart().catch((error) => {
      console.error("Error in signalBreakStart effect:", error);
    });
  }, [
    countingDown,
    ready,
    isPrimaryWindow,
    sharedBreakEndTime,
    signalBreakStart,
  ]);

  const handleCountdownOver = useCallback(() => {
    if (isPrimaryWindow) {
      signalBreakStart().catch((error) => {
        console.error("Error in handleCountdownOver:", error);
      });
    }
    setCountingDown(false);
  }, [isPrimaryWindow, signalBreakStart]);

  const handleStartBreakNow = useCallback(() => {
    signalBreakStart().catch((error) => {
      console.error("Error in handleStartBreakNow:", error);
    });
  }, [signalBreakStart]);

  const backgroundImageSource =
    settings?.backgroundImage?.uri ||
    settings?.backgroundImage?.dataUrl ||
    null;
  const hasBackgroundImage = Boolean(backgroundImageSource);

  useEffect(() => {
    if (countingDown) {
      setBreakWindowReady(false);
      return;
    }

    let cancelled = false;
    setBreakWindowReady(hasBackgroundImage ? false : true);

    const renderer = ipc as typeof ipc & {
      invokeBreakWindowResize?: () => Promise<void>;
    };

    const resizeWindow = async () => {
      try {
        if (renderer.invokeBreakWindowResize) {
          await renderer.invokeBreakWindowResize();
        }
      } catch (error) {
        console.warn("Failed to resize break window", error);
      } finally {
        if (!cancelled && hasBackgroundImage) {
          setBreakWindowReady(true);
        }
      }
    };

    resizeWindow();

    return () => {
      cancelled = true;
    };
  }, [countingDown, hasBackgroundImage]);

  useEffect(() => {
    if (closing) {
      setTimeout(() => {
        window.close();
      }, 500);
    }
  }, [closing]);

  const handlePostponeBreak = useCallback(async () => {
    await ipc.invokeBreakPostpone("snoozed");
    if (isMounted.current) {
      setClosing(true);
    }
  }, []);

  const handleSkipBreak = useCallback(async () => {
    await ipc.invokeBreakPostpone("skipped");
    if (isMounted.current) {
      setClosing(true);
    }
  }, []);

  const handleNextBreakMessage = useCallback(async () => {
    if (switchingMessage) {
      return;
    }

    setSwitchingMessage(true);

    try {
      const response =
        (await ipc.invokeBreakMessageNext()) as BreakMessageSwitchResult;

      if (!isMounted.current) {
        return;
      }

      applySwitchResult(response, { updateTimer: true });
    } catch (error) {
      console.warn("Failed to switch break message", error);
    } finally {
      if (isMounted.current) {
        setSwitchingMessage(false);
      }
    }
  }, [applySwitchResult, switchingMessage]);

  const handlePreviousBreakMessage = useCallback(async () => {
    if (switchingMessage) {
      return;
    }

    setSwitchingMessage(true);

    try {
      const response =
        (await ipc.invokeBreakMessagePrevious()) as BreakMessageSwitchResult;

      if (!isMounted.current) {
        return;
      }

      applySwitchResult(response, { updateTimer: true });
    } catch (error) {
      console.warn("Failed to switch to previous break message", error);
    } finally {
      if (isMounted.current) {
        setSwitchingMessage(false);
      }
    }
  }, [applySwitchResult, switchingMessage]);

  const pauseBreak = useCallback(async () => {
    if (breakPausedRef.current) {
      return;
    }

    try {
      await ipc.invokeBreakPause();
    } catch (error) {
      console.warn("Failed to pause break countdown", error);
    }
  }, []);

  const resumeBreak = useCallback(async () => {
    if (!breakPausedRef.current) {
      return;
    }

    try {
      await ipc.invokeBreakResume();
    } catch (error) {
      console.warn("Failed to resume break countdown", error);
    }
  }, []);

  const adjustBreakDuration = useCallback(async (deltaMs: number) => {
    try {
      await ipc.invokeBreakAdjustDuration(deltaMs);
    } catch (error) {
      console.warn("Failed to adjust break duration", error);
    }
  }, []);

  const handleEndBreak = useCallback(
    async (durationMs?: number) => {
      if (
        typeof durationMs === "number" &&
        Number.isFinite(durationMs) &&
        durationMs >= 0
      ) {
        try {
          await ipc.invokeCompleteBreakTracking(durationMs);
        } catch (error) {
          console.warn("Failed to record break duration", error);
        }
      }

      // Only play end sound from primary window
      const urlParams = new URLSearchParams(window.location.search);
      const windowId = urlParams.get("windowId");
      const isPrimary = windowId === "0" || windowId === null;

      if (isPrimary && settings && settings?.soundType !== SoundType.None) {
        ipc.invokeEndSound(settings.soundType, settings.breakSoundVolume);
      }

      // Broadcast to all windows to start their closing animations
      await ipc.invokeBreakEnd();
    },
    [settings]
  );

  if (settings === null || allowPostpone === null) {
    return null;
  }

  const allowPostponeEnabled = allowPostpone === true;
  const postponeBreakEnabled =
    settings.postponeBreakEnabled &&
    allowPostponeEnabled &&
    !settings.immediatelyStartBreaks;
  const skipBreakEnabled =
    settings.skipBreakEnabled &&
    allowPostponeEnabled &&
    !settings.immediatelyStartBreaks;
  const postponeLimitReached =
    !allowPostponeEnabled &&
    (settings.postponeBreakEnabled || settings.skipBreakEnabled) &&
    !settings.immediatelyStartBreaks;

  const fallbackBreakMessage = normalizeBreakMessage(settings.breakMessage);
  const breakMessageForDisplay = currentBreakMessage ?? fallbackBreakMessage;
  const breakMessagesCount = settings.breakMessages?.length ?? 0;
  const canSkipBreakMessage = breakMessagesCount > 1;
  const rootStyle: CSSProperties = {};

  rootStyle.backgroundColor = settings.backgroundColor;

  if (backgroundImageSource && breakWindowReady) {
    rootStyle.backgroundImage = `url(${backgroundImageSource})`;
    rootStyle.backgroundSize = "cover";
    rootStyle.backgroundPosition = "center";
    rootStyle.backgroundRepeat = "no-repeat";
  }

  const hasVisibleBackgroundImage = hasBackgroundImage && breakWindowReady;

  const countdownSurfaceColor = hasBackgroundImage
    ? createRgba(settings.backgroundColor, 0.88)
    : settings.backgroundColor;

  const breakSurfaceColor = hasVisibleBackgroundImage
    ? createRgba(settings.backgroundColor, 0.88)
    : settings.backgroundColor;

  const countdownRootStyle: CSSProperties = hasBackgroundImage
    ? {}
    : { backgroundColor: settings.backgroundColor };

  if (countingDown) {
    return (
      <motion.div
        className="h-full flex items-center justify-center"
        style={countdownRootStyle}
        initial={{ opacity: 1 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{
          duration: 0.5,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      >
        {ready && !closing && (
          <BreakNotification
            onCountdownOver={handleCountdownOver}
            onPostponeBreak={handlePostponeBreak}
            onSkipBreak={handleSkipBreak}
            onStartBreakNow={handleStartBreakNow}
            postponeBreakEnabled={postponeBreakEnabled}
            skipBreakEnabled={skipBreakEnabled}
            postponeLimitReached={postponeLimitReached}
            timeSinceLastBreak={timeSinceLastBreak}
            textColor={settings.textColor}
            backgroundColor={countdownSurfaceColor}
            backgroundImage={backgroundImageSource}
          />
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      className="h-full flex items-center justify-center relative"
      style={rootStyle}
      initial={{ opacity: hasBackgroundImage ? 0 : 1 }}
      animate={{
        opacity: closing || (hasBackgroundImage && !breakWindowReady) ? 0 : 1,
      }}
      transition={{
        duration: 0.5,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
    >
      {settings.showBackdrop && (
        <motion.div
          className="absolute inset-0"
          animate={{
            opacity: closing ? 0 : settings.backdropOpacity,
          }}
          initial={{ opacity: 0 }}
          transition={{
            duration: 0.5,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
          style={{
            backgroundColor: hasVisibleBackgroundImage
              ? "rgb(0, 0, 0)"
              : createDarkerRgba(settings.backgroundColor, 1),
          }}
        />
      )}
      <motion.div
        className="flex flex-col justify-center items-center relative p-6 text-balance focus:outline-none w-[960px] max-w-[95vw] max-h-[90vh] overflow-hidden rounded-xl"
        animate={{
          opacity: closing ? 0 : 1,
          y: closing ? -20 : 0,
        }}
        initial={{ opacity: 0, y: -20 }}
        transition={{
          duration: 0.5,
          ease: [0.25, 0.46, 0.45, 0.94], // easeOutQuart
        }}
        style={{
          color: settings.textColor,
          backgroundColor: breakSurfaceColor,
          backdropFilter: hasVisibleBackgroundImage ? "blur(6px)" : undefined,
        }}
      >
        {ready && (
          <BreakProgress
            breakMessage={breakMessageForDisplay}
            breakTitle={settings.breakTitle}
            endBreakEnabled={settings.endBreakEnabled}
            onEndBreak={handleEndBreak}
            onPreviousMessage={
              canSkipBreakMessage ? handlePreviousBreakMessage : undefined
            }
            onPauseBreak={pauseBreak}
            onResumeBreak={resumeBreak}
            onAdjustBreakDuration={adjustBreakDuration}
            onNextMessage={
              canSkipBreakMessage ? handleNextBreakMessage : undefined
            }
            canSkipMessage={canSkipBreakMessage}
            switchMessagePending={switchingMessage}
            hasPreviousMessage={hasPreviousMessage}
            hasNextMessage={hasNextMessage}
            settings={settings}
            uiColor={settings.textColor}
            titleColor={settings.titleTextColor || settings.textColor}
            messageColor={settings.messageTextColor || settings.textColor}
            messageColorEffect={
              settings.messageColorEffect || MessageColorEffect.Static
            }
            isPaused={breakPaused}
            isClosing={closing}
            sharedBreakEndTime={sharedBreakEndTime}
            pausedRemainingMs={pausedRemainingMs}
            totalDurationMs={breakTotalDurationMs}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
