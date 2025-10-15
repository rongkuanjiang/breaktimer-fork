import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MessageColorEffect, SoundType, normalizeBreakMessage } from "../../types/settings";
import type { BreakMessageContent, Settings } from "../../types/settings";
import { BreakNotification } from "./break/break-notification";
import { BreakProgress } from "./break/break-progress";
import { createDarkerRgba, createRgba } from "./break/utils";

export default function Break() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [currentBreakMessage, setCurrentBreakMessage] =
    useState<BreakMessageContent | null>(null);
  const [countingDown, setCountingDown] = useState(true);
  const [allowPostpone, setAllowPostpone] = useState<boolean | null>(null);
  const [timeSinceLastBreak, setTimeSinceLastBreak] = useState<number | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const [breakWindowReady, setBreakWindowReady] = useState(false);
  const [sharedBreakEndTime, setSharedBreakEndTime] = useState<number | null>(
    null,
  );
  const hasNotifiedWindowReadyRef = useRef(false);
  const hasSignaledBreakStartRef = useRef(false);

  const isPrimaryWindow = useMemo(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const windowId = urlParams.get("windowId");
    return windowId === "0" || windowId === null;
  }, []);

  useEffect(() => {
    const init = async () => {
      const [allowPostpone, settings, timeSince, startedFromTray] =
        await Promise.all([
          ipcRenderer.invokeGetAllowPostpone(),
          ipcRenderer.invokeGetSettings() as Promise<Settings>,
          ipcRenderer.invokeGetTimeSinceLastBreak(),
          ipcRenderer.invokeWasStartedFromTray(),
        ]);

      setAllowPostpone(allowPostpone);
      setSettings(settings);
      const currentMessage =
        (await ipcRenderer.invokeGetCurrentBreakMessage()) as
          | BreakMessageContent
          | null;
      setCurrentBreakMessage(
        currentMessage ? normalizeBreakMessage(currentMessage) : null,
      );
      setTimeSinceLastBreak(timeSince);

      // Skip the countdown if immediately start breaks is enabled or started from tray
      if (settings.immediatelyStartBreaks || startedFromTray) {
        setCountingDown(false);
      }

      setReady(true);
    };

    // Listen for break start broadcasts from other windows
    const handleBreakStart = (breakEndTime: number | string) => {
      const parsedBreakEndTime =
        typeof breakEndTime === "number"
          ? breakEndTime
          : typeof breakEndTime === "string"
            ? Number.parseInt(breakEndTime, 10)
            : Number.NaN;

      setSharedBreakEndTime(
        Number.isFinite(parsedBreakEndTime) ? parsedBreakEndTime : null,
      );
      setCountingDown(false);
    };

    // Listen for break end broadcasts from other windows
    const handleBreakEnd = () => {
      setClosing(true);
    };

    ipcRenderer.onBreakStart(handleBreakStart);
    ipcRenderer.onBreakEnd(handleBreakEnd);

    // Delay or the window displays incorrectly.
    // FIXME: work out why and how to avoid this.
    setTimeout(init, 1000);
  }, []);

  useEffect(() => {
    if (!ready || hasNotifiedWindowReadyRef.current) {
      return;
    }

    hasNotifiedWindowReadyRef.current = true;

    const notifyMainProcess = async () => {
      try {
        await ipcRenderer.invokeBreakWindowReady();
      } catch (error) {
        console.warn("Failed to notify main process that break window is ready", error);
      }
    };

    void notifyMainProcess();
  }, [ready]);

  const signalBreakStart = useCallback(async () => {
    if (hasSignaledBreakStartRef.current) {
      return;
    }

    hasSignaledBreakStartRef.current = true;

    try {
      await ipcRenderer.invokeBreakStart();
    } catch (error) {
      hasSignaledBreakStartRef.current = false;
      console.warn("Failed to notify main process to start break", error);
    }
  }, []);

  const handleCountdownOver = useCallback(() => {
    if (isPrimaryWindow) {
      void signalBreakStart();
    }
    setCountingDown(false);
  }, [isPrimaryWindow, signalBreakStart]);

  const handleStartBreakNow = useCallback(() => {
    void signalBreakStart();
  }, [signalBreakStart]);

  const backgroundImageSource =
    settings?.backgroundImage?.uri || settings?.backgroundImage?.dataUrl || null;
  const hasBackgroundImage = Boolean(backgroundImageSource);

  useEffect(() => {
    if (countingDown) {
      setBreakWindowReady(false);
      return;
    }

    let cancelled = false;
    setBreakWindowReady(hasBackgroundImage ? false : true);

    const renderer = ipcRenderer as typeof ipcRenderer & {
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
    await ipcRenderer.invokeBreakPostpone("snoozed");
    setClosing(true);
  }, []);

  const handleSkipBreak = useCallback(async () => {
    await ipcRenderer.invokeBreakPostpone("skipped");
    setClosing(true);
  }, []);

  const handleEndBreak = useCallback(async (durationMs?: number) => {
    if (
      typeof durationMs === "number" &&
      Number.isFinite(durationMs) &&
      durationMs >= 0
    ) {
      try {
        await ipcRenderer.invokeCompleteBreakTracking(durationMs);
      } catch (error) {
        console.warn("Failed to record break duration", error);
      }
    }

    // Only play end sound from primary window
    const urlParams = new URLSearchParams(window.location.search);
    const windowId = urlParams.get("windowId");
    const isPrimary = windowId === "0" || windowId === null;

    if (isPrimary && settings && settings?.soundType !== SoundType.None) {
      ipcRenderer.invokeEndSound(settings.soundType, settings.breakSoundVolume);
    }

    // Broadcast to all windows to start their closing animations
    await ipcRenderer.invokeBreakEnd();
  }, [settings]);

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
  const breakMessageForDisplay =
    currentBreakMessage ?? fallbackBreakMessage;
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
      animate={{ opacity: closing || (hasBackgroundImage && !breakWindowReady) ? 0 : 1 }}
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
            settings={settings}
            uiColor={settings.textColor}
            titleColor={settings.titleTextColor || settings.textColor}
            messageColor={settings.messageTextColor || settings.textColor}
            messageColorEffect={settings.messageColorEffect || MessageColorEffect.Static}
            isClosing={closing}
            sharedBreakEndTime={sharedBreakEndTime}
          />
        )}
      </motion.div>
    </motion.div>
  );
}
