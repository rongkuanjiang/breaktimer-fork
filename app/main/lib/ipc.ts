import { BrowserWindow, ipcMain, IpcMainInvokeEvent, screen } from "electron";
import log from "electron-log";
import { IpcChannel } from "../../types/ipc";
import type { BreakMessageSwitchResult } from "../../types/breaks";
import type { Settings, SoundType } from "../../types/settings";
import { saveAttachmentFromDataUrl } from "./attachments";
import {
  completeBreakTracking,
  getAllowPostpone,
  getBreakLengthSeconds,
  getTimeSinceLastBreak,
  postponeBreak,
  wasStartedFromTray,
  getCurrentBreakMessageSnapshot,
  goToPreviousBreakMessage,
  skipCurrentBreakMessage,
  beginBreakCountdown,
  pauseActiveBreak,
  resumeActiveBreak,
  adjustActiveBreakDuration,
} from "./breaks";
import {
  getSettings,
  setSettings,
  getAppInitialized,
  setAppInitialized,
} from "./store";
import { getWindows } from "./windows";

const USE_SCREEN_SAVER_LEVEL =
  process.platform === "win32" || process.platform === "darwin";

const requestScreenSaverAlwaysOnTop = (target: BrowserWindow): void => {
  if (target.isDestroyed()) {
    return;
  }
  if (USE_SCREEN_SAVER_LEVEL) {
    target.setAlwaysOnTop(true, "screen-saver");
  } else {
    target.setAlwaysOnTop(true);
  }
};

const ensureTaskbarHidden = (target: BrowserWindow): void => {
  if (!target.isDestroyed()) {
    target.setSkipTaskbar(true);
  }
};

const elevateBreakWindow = (target: BrowserWindow): void => {
  if (target.isDestroyed()) {
    return;
  }
  requestScreenSaverAlwaysOnTop(target);
  ensureTaskbarHidden(target);
  target.moveTop();
};

export function sendIpc(channel: IpcChannel, ...args: unknown[]): void {
  const windows: BrowserWindow[] = getWindows();

  log.info(`Send event ${channel}`, args);

  for (const window of windows) {
    if (!window) {
      continue;
    }

    window.webContents.send(channel, ...args);
  }
}

ipcMain.handle(
  IpcChannel.AttachmentSave,
  (
    _event: IpcMainInvokeEvent,
    payload: {
      dataUrl: string;
      mimeType?: string;
      name?: string;
      sizeBytes?: number;
    },
  ) => {
    log.info(IpcChannel.AttachmentSave);
    const { dataUrl, mimeType, name, sizeBytes } = payload;
    const attachment = saveAttachmentFromDataUrl(dataUrl, {
      mimeType,
      name,
      sizeBytes,
    });
    return attachment;
  },
);

ipcMain.handle(IpcChannel.AllowPostponeGet, (): boolean => {
  log.info(IpcChannel.AllowPostponeGet);
  return getAllowPostpone();
});

ipcMain.handle(
  IpcChannel.BreakPostpone,
  (_event: IpcMainInvokeEvent, action?: string): void => {
    log.info(IpcChannel.BreakPostpone);
    postponeBreak(action);
  },
);

ipcMain.handle(IpcChannel.BreakStart, (): void => {
  log.info(IpcChannel.BreakStart);
  const state = beginBreakCountdown();
  if (!state) {
    log.warn("No active break when attempting to start countdown");
    return;
  }
  sendIpc(IpcChannel.BreakStart, state);
});

ipcMain.handle(IpcChannel.BreakPause, (): void => {
  log.info(IpcChannel.BreakPause);
  const state = pauseActiveBreak();
  if (!state) {
    log.warn("No active break when attempting to pause");
    return;
  }
  sendIpc(IpcChannel.BreakPause, state);
});

ipcMain.handle(IpcChannel.BreakResume, (): void => {
  log.info(IpcChannel.BreakResume);
  const state = resumeActiveBreak();
  if (!state) {
    log.warn("No active break when attempting to resume");
    return;
  }
  sendIpc(IpcChannel.BreakStart, state);
});

ipcMain.handle(
  IpcChannel.BreakAdjustDuration,
  (_event: IpcMainInvokeEvent, deltaMs: number): void => {
    log.info(IpcChannel.BreakAdjustDuration, deltaMs);
    const result = adjustActiveBreakDuration(deltaMs);
    if (!result) {
      log.warn("Failed to adjust break duration");
      return;
    }
    sendIpc(result.channel, result.payload);
  },
);

ipcMain.handle(IpcChannel.BreakEnd, (): void => {
  log.info(IpcChannel.BreakEnd);
  sendIpc(IpcChannel.BreakEnd);
});

ipcMain.handle(
  IpcChannel.SoundStartPlay,
  (_event: IpcMainInvokeEvent, type: SoundType, volume: number = 1): void => {
    sendIpc(IpcChannel.SoundStartPlay, type, volume);
  },
);

ipcMain.handle(
  IpcChannel.SoundEndPlay,
  (_event: IpcMainInvokeEvent, type: SoundType, volume: number = 1): void => {
    sendIpc(IpcChannel.SoundEndPlay, type, volume);
  },
);

ipcMain.handle(IpcChannel.SettingsGet, (): Settings => {
  log.info(IpcChannel.SettingsGet);
  return getSettings();
});

ipcMain.handle(
  IpcChannel.CurrentBreakMessageGet,
  (): BreakMessageSwitchResult => {
    log.info(IpcChannel.CurrentBreakMessageGet);
    return getCurrentBreakMessageSnapshot();
  },
);

ipcMain.handle(
  IpcChannel.SettingsSet,
  async (_event: IpcMainInvokeEvent, settings: Settings): Promise<void> => {
    log.info(IpcChannel.SettingsSet);
    await setSettings(settings);
  },
);

ipcMain.handle(IpcChannel.BreakLengthGet, (): number => {
  log.info(IpcChannel.BreakLengthGet);
  return getBreakLengthSeconds();
});

ipcMain.handle(
  IpcChannel.BreakWindowResize,
  (event: IpcMainInvokeEvent): void => {
    log.info(IpcChannel.BreakWindowResize);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (window.isDestroyed()) {
        log.warn("Break window already destroyed during resize handling");
        return;
      }
      const display = screen.getDisplayNearestPoint(window.getBounds());
      const settings = getSettings();

      if (settings.showBackdrop) {
        // Fullscreen for backdrop mode
        window.setBounds({
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        });
      } else {
        // Centered window for no backdrop mode
        const windowWidth = 500;
        const windowHeight = 300;
        const centerX =
          display.bounds.x + display.bounds.width / 2 - windowWidth / 2;
        const centerY =
          display.bounds.y + display.bounds.height / 2 - windowHeight / 2;

        window.setBounds({
          x: Math.round(centerX),
          y: Math.round(centerY),
          width: windowWidth,
          height: windowHeight,
        });
      }

      elevateBreakWindow(window);
      // Allow interaction (scrolling) once break phase begins
      try {
        if (!window.isFocusable()) {
          window.setFocusable(true);
        }
        const breakWindowRef = window;
        const requestWindowsFocusSteal = (): void => {
          const focusFn =
            typeof (breakWindowRef as { focus?: unknown }).focus === "function"
              ? ((breakWindowRef as { focus?: unknown }).focus as (options?: {
                  steal?: boolean;
                }) => void)
              : undefined;
          if (focusFn) {
            focusFn.call(breakWindowRef, { steal: true });
          } else {
            breakWindowRef.focus();
          }
        };

        const WINDOWS_FOCUS_RECHECK_DELAY_MS = 150;
        const WINDOWS_FALLBACK_STATUS_DELAY_MS = 200;

        let windowsFallbackAttempted = false;

        function runWindowsFocusFallback(stage: string): void {
          if (windowsFallbackAttempted) {
            log.warn(`Skipping duplicate Windows focus fallback (${stage})`);
            return;
          }

          windowsFallbackAttempted = true;
          log.warn(
            `Break window focus rejected by OS during ${stage}, applying Windows fallback`,
          );

          const wasAlwaysOnTop = breakWindowRef.isAlwaysOnTop();
          try {
            requestScreenSaverAlwaysOnTop(breakWindowRef);
            ensureTaskbarHidden(breakWindowRef);
            breakWindowRef.show();
            requestWindowsFocusSteal();
            elevateBreakWindow(breakWindowRef);
          } catch (fallbackErr) {
            log.error("Windows fallback focus sequence failed", fallbackErr);
          } finally {
            if (!breakWindowRef.isDestroyed()) {
              if (wasAlwaysOnTop) {
                requestScreenSaverAlwaysOnTop(breakWindowRef);
              } else {
                breakWindowRef.setAlwaysOnTop(false);
              }
              ensureTaskbarHidden(breakWindowRef);
            }
          }

          if (!breakWindowRef.isDestroyed()) {
            const immediateStatus = {
              isVisible: breakWindowRef.isVisible(),
              isFocused: breakWindowRef.isFocused(),
            };
            log.info(
              "Windows fallback focus status (immediate)",
              immediateStatus,
            );
            setTimeout(() => {
              if (breakWindowRef.isDestroyed()) {
                return;
              }

              log.info("Windows fallback focus status (delayed)", {
                isVisible: breakWindowRef.isVisible(),
                isFocused: breakWindowRef.isFocused(),
              });
            }, WINDOWS_FALLBACK_STATUS_DELAY_MS);
          }
        }

        function scheduleWindowsFocusVerification(
          stage: string,
          delayMs: number,
        ): void {
          setTimeout(() => {
            if (breakWindowRef.isDestroyed()) {
              log.warn(
                `Skipping focus verification (${stage}) because break window was destroyed`,
              );
              return;
            }

            const focusBlocked =
              !breakWindowRef.isVisible() || !breakWindowRef.isFocused();
            if (!focusBlocked) {
              log.info(`Break window focus verified (${stage})`, {
                isVisible: breakWindowRef.isVisible(),
                isFocused: breakWindowRef.isFocused(),
              });
              return;
            }

            runWindowsFocusFallback(stage);
          }, delayMs);
        }

        if (process.platform === "win32") {
          requestWindowsFocusSteal();
          scheduleWindowsFocusVerification(
            "initial focus request",
            WINDOWS_FOCUS_RECHECK_DELAY_MS,
          );
        } else {
          breakWindowRef.focus();
        }
      } catch (err) {
        log.warn("Could not set focusable/focus break window", err);
      }
    }
  },
);

ipcMain.handle(
  IpcChannel.BreakWindowReady,
  (event: IpcMainInvokeEvent): void => {
    log.info(IpcChannel.BreakWindowReady);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.showInactive();
      elevateBreakWindow(window);
    }
  },
);

ipcMain.handle(IpcChannel.TimeSinceLastBreakGet, (): number | null => {
  log.info(IpcChannel.TimeSinceLastBreakGet);
  return getTimeSinceLastBreak();
});

ipcMain.handle(
  IpcChannel.BreakTrackingComplete,
  (event: IpcMainInvokeEvent, breakDurationMs: number): void => {
    log.info(IpcChannel.BreakTrackingComplete, breakDurationMs);
    completeBreakTracking(breakDurationMs);
  },
);

ipcMain.handle(IpcChannel.WasStartedFromTrayGet, (): boolean => {
  log.info(IpcChannel.WasStartedFromTrayGet);
  return wasStartedFromTray();
});

ipcMain.handle(
  IpcChannel.BreakMessageNext,
  async (): Promise<BreakMessageSwitchResult> => {
    log.info(IpcChannel.BreakMessageNext);
    return await skipCurrentBreakMessage();
  },
);

ipcMain.handle(
  IpcChannel.BreakMessagePrevious,
  (): BreakMessageSwitchResult => {
    log.info(IpcChannel.BreakMessagePrevious);
    return goToPreviousBreakMessage();
  },
);

ipcMain.handle(IpcChannel.AppInitializedGet, (): boolean => {
  log.info(IpcChannel.AppInitializedGet);
  return getAppInitialized();
});

ipcMain.handle(IpcChannel.AppInitializedSet, (): void => {
  log.info(IpcChannel.AppInitializedSet);
  setAppInitialized();
});
