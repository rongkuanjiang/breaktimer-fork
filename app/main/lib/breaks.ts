import { PowerMonitor } from "electron";
import log from "electron-log";
import moment from "moment";
import {
  BreakMessageNavigationState,
  BreakMessageSwitchResult,
  BreakMessageUpdatePayload,
  BreakTime,
} from "../../types/breaks";
import { IpcChannel } from "../../types/ipc";
import {
  DayConfig,
  NotificationType,
  Settings,
  SoundType,
  BreakMessagesMode,
  BreakMessageContent,
  normalizeBreakMessage,
  normalizeBreakMessages,
} from "../../types/settings";
import { sendIpc } from "./ipc";
import { showNotification } from "./notifications";
import { getSettings } from "./store";
import { buildTray } from "./tray";
import { createBreakWindows } from "./windows";
import {
  generateSequentialOrder,
  sanitizeSequentialOrder,
} from "./break-rotation";

// Helper function to strip HTML tags from text
function stripHtml(html: string): string {
  // First convert <br> tags to spaces
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

interface NextBreakMessageResult {
  message: BreakMessageContent;
  updatedSettings?: Settings | null;
}

async function determineNextBreakMessage(
  settings: Settings,
): Promise<NextBreakMessageResult> {
  const availableMessages = normalizeBreakMessages(settings.breakMessages);

  if (availableMessages.length > 0) {
    if (settings.breakMessagesMode === BreakMessagesMode.Sequential) {
      const totalMessages = availableMessages.length;
      const idxRaw =
        typeof settings.breakMessagesNextIndex === "number"
          ? settings.breakMessagesNextIndex
          : 0;
      const currentIndex =
        ((idxRaw % totalMessages) + totalMessages) % totalMessages;

      let order = sanitizeSequentialOrder(
        settings.breakMessagesOrder,
        totalMessages,
      );
      if (!order) {
        order = generateSequentialOrder(totalMessages);
      }

      const messageIndex = order[currentIndex] ?? 0;
      const message = availableMessages[messageIndex] ?? availableMessages[0];

      let nextIndex = currentIndex + 1;
      if (nextIndex >= totalMessages) {
        nextIndex = 0;
        order = generateSequentialOrder(totalMessages);
      }

      const updated: Settings = {
        ...settings,
        breakMessagesNextIndex: nextIndex,
        breakMessagesOrder: order,
        breakMessages: availableMessages,
      };

      return {
        message,
        updatedSettings: updated,
      };
    }

    const idx = Math.floor(Math.random() * availableMessages.length);
    return {
      message: availableMessages[idx],
    };
  }

  return {
    message: normalizeBreakMessage(settings.breakMessage),
  };
}

async function updateCurrentBreakMessageFromSettings(
  settings: Settings,
): Promise<BreakMessageContent> {
  const { message, updatedSettings } =
    await determineNextBreakMessage(settings);
  currentBreakMessage = message;

  if (updatedSettings) {
    // Persist next index and current order. We update settings silently without resetting breaks
    try {
      const { setSettings } = require("./store");
      await setSettings(updatedSettings, false);
    } catch (err) {
      log.warn("Failed to persist break message rotation state", err);
    }
  }

  return message;
}

function resolveMessageDurationMs(
  settings: Settings,
  message: BreakMessageContent | null,
): number {
  const fallbackSecondsRaw = Number(settings.breakLengthSeconds);
  const fallbackSeconds = Number.isFinite(fallbackSecondsRaw)
    ? Math.max(1, Math.round(fallbackSecondsRaw))
    : 1;

  if (!message) {
    return fallbackSeconds * 1000;
  }

  const overrideSecondsRaw = message.durationSeconds;
  if (
    typeof overrideSecondsRaw === "number" &&
    Number.isFinite(overrideSecondsRaw) &&
    overrideSecondsRaw > 0
  ) {
    const normalized = Math.max(1, Math.round(overrideSecondsRaw));
    return normalized * 1000;
  }

  return fallbackSeconds * 1000;
}

function cloneBreakMessageContent(
  message: BreakMessageContent | null,
): BreakMessageContent | null {
  if (!message) {
    return null;
  }

  const cloned: BreakMessageContent = {
    text: message.text,
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
    })),
  };

  if (message.durationSeconds !== undefined) {
    cloned.durationSeconds = message.durationSeconds;
  }

  return cloned;
}

let powerMonitor: PowerMonitor;
let breakTime: BreakTime = null;
let havingBreak = false;
let postponedCount = 0;
let idleStart: Date | null = null;
let lockStart: Date | null = null;
let lastTick: Date | null = null;
let startedFromTray = false;

let lastCompletedBreakTime: Date = new Date();
let currentBreakStartTime: Date | null = null;
let hasSkippedOrSnoozedSinceLastBreak = false;
let currentBreakMessage: BreakMessageContent | null = null;
let currentBreakEndTimestamp: number | null = null;
let currentBreakRemainingMs: number | null = null;
let currentBreakTotalDurationMs: number | null = null;
let breakCountdownPaused = false;

interface BreakMessageHistoryEntry {
  message: BreakMessageContent;
  durationMs: number;
}

let breakMessageHistory: BreakMessageHistoryEntry[] = [];
let breakMessageHistoryIndex = -1;

function clearBreakMessageHistory(): void {
  breakMessageHistory = [];
  breakMessageHistoryIndex = -1;
}

function recordBreakMessageInHistory(
  message: BreakMessageContent | null,
  durationMs: number,
): void {
  const clone = cloneBreakMessageContent(message);
  if (!clone) {
    return;
  }

  const normalizedDuration = Math.max(1, Math.round(durationMs));

  if (breakMessageHistoryIndex < breakMessageHistory.length - 1) {
    breakMessageHistory = breakMessageHistory.slice(
      0,
      Math.max(0, breakMessageHistoryIndex + 1),
    );
  }

  breakMessageHistory.push({
    message: clone,
    durationMs: normalizedDuration,
  });
  breakMessageHistoryIndex = breakMessageHistory.length - 1;
}

function updateCurrentHistoryEntryDuration(durationMs: number): void {
  if (
    breakMessageHistoryIndex < 0 ||
    breakMessageHistoryIndex >= breakMessageHistory.length
  ) {
    return;
  }

  const normalizedDuration = Math.max(1, Math.round(durationMs));
  const currentEntry = breakMessageHistory[breakMessageHistoryIndex];

  breakMessageHistory[breakMessageHistoryIndex] = {
    ...currentEntry,
    durationMs: normalizedDuration,
  };
}

function getHistoryEntry(index: number): BreakMessageHistoryEntry | null {
  if (index < 0 || index >= breakMessageHistory.length) {
    return null;
  }
  return breakMessageHistory[index];
}

function getCurrentHistoryEntry(): BreakMessageHistoryEntry | null {
  return getHistoryEntry(breakMessageHistoryIndex);
}

function getBreakMessageNavigationState(
  settings: Settings,
): BreakMessageNavigationState {
  const hasPrevious = breakMessageHistoryIndex > 0;
  const hasFutureHistory =
    breakMessageHistoryIndex >= 0 &&
    breakMessageHistoryIndex < breakMessageHistory.length - 1;
  const availableMessages = normalizeBreakMessages(settings.breakMessages);
  const hasMultipleMessages = availableMessages.length > 1;

  return {
    hasPrevious,
    hasNext: hasFutureHistory || hasMultipleMessages,
  };
}

function createBreakMessageSwitchResult(
  durationMs: number,
  settings: Settings,
): BreakMessageSwitchResult {
  return {
    message: getCurrentBreakMessage(),
    durationMs,
    ...getBreakMessageNavigationState(settings),
  };
}

function broadcastBreakMessageUpdate(settings: Settings): void {
  const payload: BreakMessageUpdatePayload = {
    message: getCurrentBreakMessage(),
    ...getBreakMessageNavigationState(settings),
  };
  sendIpc(IpcChannel.BreakMessageUpdate, payload);
}

function applyBreakMessageEntry(
  entry: BreakMessageHistoryEntry,
  settings: Settings,
): BreakMessageSwitchResult {
  const clone = cloneBreakMessageContent(entry.message);
  currentBreakMessage = clone;

  const targetDurationMs = Math.max(1, Math.round(entry.durationMs));

  currentBreakTotalDurationMs = targetDurationMs;
  currentBreakRemainingMs = targetDurationMs;

  if (breakCountdownPaused) {
    currentBreakEndTimestamp = null;
    sendIpc(IpcChannel.BreakPause, {
      remainingMs: targetDurationMs,
      totalDurationMs: targetDurationMs,
    });
  } else {
    const breakEndTime = Date.now() + targetDurationMs;
    currentBreakEndTimestamp = breakEndTime;
    breakCountdownPaused = false;
    sendIpc(IpcChannel.BreakStart, {
      breakEndTime,
      totalDurationMs: targetDurationMs,
    });
  }

  broadcastBreakMessageUpdate(settings);

  return createBreakMessageSwitchResult(targetDurationMs, settings);
}

export function getBreakTime(): BreakTime {
  return breakTime;
}

export function getBreakLengthSeconds(): number {
  const settings: Settings = getSettings();

  if (havingBreak) {
    const override = currentBreakMessage?.durationSeconds;
    if (
      typeof override === "number" &&
      Number.isFinite(override) &&
      override > 0
    ) {
      return Math.max(1, Math.round(override));
    }
  }

  return settings.breakLengthSeconds;
}

export function getTimeSinceLastBreak(): number | null {
  if (!hasSkippedOrSnoozedSinceLastBreak) {
    return null;
  }

  const now = moment();
  const lastBreak = moment(lastCompletedBreakTime);
  return now.diff(lastBreak, "seconds");
}

export function startBreakTracking(): void {
  currentBreakStartTime = new Date();
}

export function completeBreakTracking(breakDurationMs: number): void {
  if (!currentBreakStartTime) return;

  const requiredSeconds = getBreakLengthSeconds();
  const requiredDurationMs = requiredSeconds * 1000;
  const halfRequiredDuration = requiredDurationMs / 2;
  const durationSeconds = Math.round(breakDurationMs / 1000);

  if (breakDurationMs >= halfRequiredDuration) {
    lastCompletedBreakTime = new Date();
    hasSkippedOrSnoozedSinceLastBreak = false;
    log.info(
      `Break completed [duration=${durationSeconds}s] [required=${requiredSeconds}s]`,
    );
  } else {
    hasSkippedOrSnoozedSinceLastBreak = true;
    log.info(
      `Break too short [duration=${durationSeconds}s] [required=${requiredSeconds}s]`,
    );
  }

  currentBreakStartTime = null;
}

function resetCurrentBreakTimerState(): void {
  currentBreakEndTimestamp = null;
  currentBreakRemainingMs = null;
  currentBreakTotalDurationMs = null;
  breakCountdownPaused = false;
  clearBreakMessageHistory();
}

function zeroPad(n: number) {
  const nStr = String(n);
  return nStr.length === 1 ? `0${nStr}` : nStr;
}

function getSecondsFromSettings(seconds: number): number {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return 1; // fallback guard against invalid or non-positive values
  }
  return seconds;
}

function getIdleResetSeconds(): number {
  const settings: Settings = getSettings();
  return getSecondsFromSettings(settings.idleResetLengthSeconds);
}

function getBreakSeconds(): number {
  const settings: Settings = getSettings();
  return getSecondsFromSettings(settings.breakFrequencySeconds);
}

function createIdleNotification() {
  const settings: Settings = getSettings();

  if (!settings.idleResetEnabled || idleStart === null) {
    return;
  }

  let idleSeconds = Number(((+new Date() - +idleStart) / 1000).toFixed(0));
  let idleMinutes = 0;
  let idleHours = 0;

  if (idleSeconds >= 60) {
    idleMinutes = Math.floor(idleSeconds / 60);
    idleSeconds -= idleMinutes * 60;
  }

  if (idleMinutes >= 60) {
    idleHours = Math.floor(idleMinutes / 60);
    idleMinutes -= idleHours * 60;
  }

  if (settings.idleResetNotification) {
    showNotification(
      "Break automatically detected",
      `Away for ${zeroPad(idleHours)}:${zeroPad(idleMinutes)}:${zeroPad(
        idleSeconds,
      )}`,
    );
  }
}

export function scheduleNextBreak(isPostpone = false): void {
  const settings: Settings = getSettings();

  // Always reset the tray flag when scheduling a new break so future breaks
  // don't inherit a manual trigger state.
  startedFromTray = false;

  if (idleStart) {
    createIdleNotification();
    idleStart = null;
    postponedCount = 0;

    lastCompletedBreakTime = new Date();
    hasSkippedOrSnoozedSinceLastBreak = false;
    log.info("Break auto-detected via idle reset");
  }

  const rawSeconds = isPostpone
    ? settings.postponeLengthSeconds
    : settings.breakFrequencySeconds;
  const seconds = getSecondsFromSettings(rawSeconds);

  breakTime = moment().add(seconds, "seconds");

  log.info(
    `Scheduling next break [isPostpone=${isPostpone}] [seconds=${seconds}] [postponeLength=${settings.postponeLengthSeconds}] [frequency=${settings.breakFrequencySeconds}] [scheduledFor=${breakTime.format("HH:mm:ss")}]`,
  );

  buildTray();
}

export function endPopupBreak(): void {
  log.info("Break ended");
  resetCurrentBreakTimerState();
  const existingBreakTime = breakTime;
  const now = moment();
  havingBreak = false;
  startedFromTray = false;

  // Reset postpone count whenever a break ends, since the user completed it
  postponedCount = 0;

  // If there's no future break scheduled, create a normal break
  if (!existingBreakTime || existingBreakTime <= now) {
    breakTime = null;
    scheduleNextBreak();
  }
  // If there's already a future break scheduled (from snooze/skip), keep it

  buildTray();
}

export function getAllowPostpone(): boolean {
  const settings = getSettings();
  return !settings.postponeLimit || postponedCount < settings.postponeLimit;
}

export function postponeBreak(action = "snoozed"): void {
  const settings = getSettings();

  if (settings.postponeLimit && postponedCount >= settings.postponeLimit) {
    log.warn(
      `Ignoring postponeBreak; postpone limit reached [limit=${settings.postponeLimit}] [count=${postponedCount}] [action=${action}]`,
    );
    return;
  }

  postponedCount++;
  havingBreak = false;
  resetCurrentBreakTimerState();
  hasSkippedOrSnoozedSinceLastBreak = true;
  log.info(`Break ${action} [count=${postponedCount}]`);

  if (action === "skipped") {
    log.info("Creating break with normal frequency");
    scheduleNextBreak();
  } else {
    log.info("Creating break with postpone length");
    scheduleNextBreak(true);
  }
}

async function doBreak(): Promise<void> {
  havingBreak = true;
  startBreakTracking();

  const settings: Settings = getSettings();
  clearBreakMessageHistory();
  const initialMessage = await updateCurrentBreakMessageFromSettings(settings);

  // Guard: Check if break is still active after async operation
  // User could have snoozed/skipped during the await
  if (!havingBreak) {
    log.warn(
      "Break was cancelled during message determination, aborting doBreak",
    );
    currentBreakStartTime = null; // Clean up tracking state
    return;
  }

  const breakLengthSeconds = Math.max(1, Math.round(getBreakLengthSeconds()));
  const breakDurationMs = breakLengthSeconds * 1000;
  currentBreakTotalDurationMs = breakDurationMs;
  currentBreakRemainingMs = breakDurationMs;
  currentBreakEndTimestamp = null;
  breakCountdownPaused = false;
  recordBreakMessageInHistory(initialMessage, breakDurationMs);

  log.info(`Break started [type=${settings.notificationType}]`);

  if (settings.notificationType === NotificationType.Notification) {
    const messageToShow =
      currentBreakMessage && currentBreakMessage.text.trim().length > 0
        ? currentBreakMessage.text
        : settings.breakMessage;
    showNotification("Time for a break!", stripHtml(messageToShow));
    if (settings.soundType !== SoundType.None) {
      sendIpc(
        IpcChannel.SoundStartPlay,
        settings.soundType,
        settings.breakSoundVolume,
      );
    }
    completeBreakTracking(breakDurationMs);
    resetCurrentBreakTimerState();
    const existingBreakTime = breakTime;
    const now = moment();
    havingBreak = false;
    startedFromTray = false;

    if (!existingBreakTime || existingBreakTime <= now) {
      postponedCount = 0;
      breakTime = null;
      scheduleNextBreak();
    }

    buildTray();
    return;
  }

  if (settings.notificationType === NotificationType.Popup) {
    createBreakWindows();
  }

  buildTray();
}

export function checkInWorkingHours(): boolean {
  const settings: Settings = getSettings();

  if (!settings.workingHoursEnabled) {
    return true;
  }

  const now = moment();
  const currentMinutes = now.hours() * 60 + now.minutes();
  const dayOfWeek = now.day();

  const dayMap: { [key: number]: DayConfig["key"] } = {
    0: "workingHoursSunday",
    1: "workingHoursMonday",
    2: "workingHoursTuesday",
    3: "workingHoursWednesday",
    4: "workingHoursThursday",
    5: "workingHoursFriday",
    6: "workingHoursSaturday",
  };

  const todaySettings = settings[dayMap[dayOfWeek]];

  if (!todaySettings.enabled) {
    return false;
  }

  return todaySettings.ranges.some(
    (range) =>
      currentMinutes >= range.fromMinutes && currentMinutes <= range.toMinutes,
  );
}

enum IdleState {
  Active = "active",
  Idle = "idle",
  Locked = "locked",
  Unknown = "unknown",
}

export function checkIdle(): boolean {
  const settings: Settings = getSettings();

  const state: IdleState = powerMonitor.getSystemIdleState(
    getIdleResetSeconds(),
  ) as IdleState;

  if (state === IdleState.Locked) {
    if (!settings.idleResetEnabled) {
      lockStart = null;
      return false;
    }

    if (!lockStart) {
      lockStart = new Date();
      return false;
    } else {
      const lockSeconds = Number(
        ((+new Date() - +lockStart) / 1000).toFixed(0),
      );
      return lockSeconds > getIdleResetSeconds();
    }
  }

  lockStart = null;

  if (!settings.idleResetEnabled) {
    return false;
  }

  return state === IdleState.Idle;
}

export function isHavingBreak(): boolean {
  return havingBreak;
}

function checkShouldHaveBreak(): boolean {
  const settings: Settings = getSettings();
  const inWorkingHours = checkInWorkingHours();
  const idle = checkIdle();

  return !havingBreak && settings.breaksEnabled && inWorkingHours && !idle;
}

async function checkBreak(): Promise<void> {
  const now = moment();

  if (breakTime !== null && now > breakTime) {
    await doBreak();
  }
}

export function startBreakNow(): void {
  startedFromTray = true;
  breakTime = moment();
}

export function wasStartedFromTray(): boolean {
  return startedFromTray;
}

async function tick(): Promise<void> {
  try {
    const settings: Settings = getSettings();
    const idleResetSeconds = getSecondsFromSettings(
      settings.idleResetLengthSeconds,
    );
    const shouldHaveBreak = checkShouldHaveBreak();

    // This can happen if the computer is put to sleep. In this case, we want
    // to skip the break if the time the computer was unresponsive was greater
    // than the idle reset.
    const secondsSinceLastTick = lastTick
      ? Math.abs(+new Date() - +lastTick) / 1000
      : 0;
    const breakSeconds = getBreakSeconds();
    const lockSeconds = lockStart
      ? Math.abs(+new Date() - +lockStart) / 1000
      : null;

    if (lockSeconds !== null && lockSeconds > breakSeconds) {
      // The computer has been locked for longer than the break period. In this
      // case, it's not particularly helpful to show an idle reset
      // notification, so unset idle start
      idleStart = null;
      lockStart = null;
    } else if (secondsSinceLastTick > breakSeconds) {
      // The computer has been slept for longer than the break period. In this
      // case, it's not particularly helpful to show an idle reset
      // notification, so just reset the break
      lockStart = null;
      breakTime = null;
    } else if (
      settings.idleResetEnabled &&
      secondsSinceLastTick > idleResetSeconds
    ) {
      //  If idleStart exists, it means we were idle before the computer slept.
      //  If it doesn't exist, count the computer going unresponsive as the
      //  start of the idle period.
      if (!idleStart) {
        lockStart = null;
        idleStart = lastTick;
      }
      scheduleNextBreak();
    }

    if (!shouldHaveBreak && !havingBreak && breakTime) {
      if (checkIdle()) {
        // Get actual system idle time and calculate when idle started
        const actualIdleSeconds = powerMonitor.getSystemIdleTime();
        idleStart = new Date(Date.now() - actualIdleSeconds * 1000);
      }
      breakTime = null;
      buildTray();
      return;
    }

    if (shouldHaveBreak && !breakTime) {
      scheduleNextBreak();
      return;
    }

    if (shouldHaveBreak) {
      checkBreak();
    }
  } finally {
    lastTick = new Date();
  }
}

let tickInterval: NodeJS.Timeout | undefined;

export function cleanupBreaks(): void {
  if (tickInterval !== undefined) {
    clearInterval(tickInterval);
    tickInterval = undefined;
  }
}

export function initBreaks(): void {
  powerMonitor = require("electron").powerMonitor;

  const settings: Settings = getSettings();

  if (settings.breaksEnabled) {
    scheduleNextBreak();
  }

  cleanupBreaks();

  tickInterval = setInterval(tick, 1000);
}

export function beginBreakCountdown(): {
  breakEndTime: number;
  totalDurationMs: number;
} | null {
  if (!havingBreak) {
    log.warn("Ignoring beginBreakCountdown because no break is active");
    return null;
  }

  const now = Date.now();
  const totalMs =
    currentBreakTotalDurationMs ??
    Math.max(1, Math.round(getBreakLengthSeconds())) * 1000;

  currentBreakTotalDurationMs = totalMs;

  if (breakCountdownPaused) {
    const remaining = currentBreakRemainingMs ?? totalMs;
    const breakEndTime = now + remaining;
    currentBreakRemainingMs = remaining;
    currentBreakEndTimestamp = breakEndTime;
    breakCountdownPaused = false;
    return {
      breakEndTime,
      totalDurationMs: currentBreakTotalDurationMs ?? totalMs,
    };
  }

  if (currentBreakEndTimestamp) {
    const remaining = Math.max(0, currentBreakEndTimestamp - now);
    currentBreakRemainingMs = remaining;
    return {
      breakEndTime: currentBreakEndTimestamp,
      totalDurationMs: currentBreakTotalDurationMs ?? totalMs,
    };
  }

  const breakEndTime = now + totalMs;
  currentBreakRemainingMs = totalMs;
  currentBreakEndTimestamp = breakEndTime;
  breakCountdownPaused = false;

  return {
    breakEndTime,
    totalDurationMs: currentBreakTotalDurationMs ?? totalMs,
  };
}

export function pauseActiveBreak(): {
  remainingMs: number;
  totalDurationMs: number;
} | null {
  if (!havingBreak) {
    log.warn("Ignoring pauseActiveBreak because no break is active");
    return null;
  }

  if (breakCountdownPaused) {
    log.info("Break countdown already paused");
    return {
      remainingMs: currentBreakRemainingMs ?? 0,
      totalDurationMs: currentBreakTotalDurationMs ?? 0,
    };
  }

  const now = Date.now();
  const remainingMs = currentBreakEndTimestamp
    ? Math.max(0, currentBreakEndTimestamp - now)
    : (currentBreakRemainingMs ?? 0);

  currentBreakRemainingMs = remainingMs;
  currentBreakEndTimestamp = null;
  breakCountdownPaused = true;

  return {
    remainingMs,
    totalDurationMs: currentBreakTotalDurationMs ?? remainingMs,
  };
}

export function resumeActiveBreak(): {
  breakEndTime: number;
  totalDurationMs: number;
} | null {
  if (!havingBreak) {
    log.warn("Ignoring resumeActiveBreak because no break is active");
    return null;
  }

  if (!breakCountdownPaused) {
    log.info("Break countdown already running");
    const endTimestamp =
      currentBreakEndTimestamp ?? Date.now() + (currentBreakRemainingMs ?? 0);
    currentBreakEndTimestamp = endTimestamp;
    return {
      breakEndTime: endTimestamp,
      totalDurationMs:
        currentBreakTotalDurationMs ?? currentBreakRemainingMs ?? 0,
    };
  }

  const remainingMs =
    currentBreakRemainingMs ?? currentBreakTotalDurationMs ?? 0;

  if (remainingMs <= 0) {
    log.warn("Cannot resume break countdown because remaining time is zero");
    return null;
  }

  const breakEndTime = Date.now() + remainingMs;
  currentBreakEndTimestamp = breakEndTime;
  breakCountdownPaused = false;

  return {
    breakEndTime,
    totalDurationMs: currentBreakTotalDurationMs ?? remainingMs,
  };
}

export function adjustActiveBreakDuration(deltaMs: number):
  | {
      channel: IpcChannel.BreakStart;
      payload: { breakEndTime: number; totalDurationMs: number };
    }
  | {
      channel: IpcChannel.BreakPause;
      payload: { remainingMs: number; totalDurationMs: number };
    }
  | null {
  if (!havingBreak) {
    log.warn("Ignoring adjustActiveBreakDuration because no break is active");
    return null;
  }

  const isDeltaValid = typeof deltaMs === "number" && Number.isFinite(deltaMs);
  const normalizedDelta = isDeltaValid ? Math.round(deltaMs) : 0;

  if (normalizedDelta === 0) {
    log.info(
      "Skipping adjustActiveBreakDuration because delta resolved to zero",
    );
    return null;
  }

  const MIN_DURATION_MS = 1000;
  const existingTotal = Math.max(
    MIN_DURATION_MS,
    currentBreakTotalDurationMs ?? MIN_DURATION_MS,
  );
  let adjustedTotal = existingTotal + normalizedDelta;
  if (adjustedTotal < MIN_DURATION_MS) {
    adjustedTotal = MIN_DURATION_MS;
  }

  if (breakCountdownPaused) {
    const existingRemaining = Math.max(
      0,
      currentBreakRemainingMs ?? adjustedTotal,
    );
    let adjustedRemaining = existingRemaining + normalizedDelta;
    if (adjustedRemaining < 0) {
      adjustedRemaining = 0;
    }
    if (adjustedRemaining > adjustedTotal) {
      adjustedRemaining = adjustedTotal;
    }

    currentBreakTotalDurationMs = adjustedTotal;
    currentBreakRemainingMs = adjustedRemaining;
    updateCurrentHistoryEntryDuration(adjustedTotal);

    if (adjustedRemaining === 0) {
      // Resume the countdown so the usual completion flow can run.
      const now = Date.now();
      currentBreakEndTimestamp = now;
      breakCountdownPaused = false;
      return {
        channel: IpcChannel.BreakStart,
        payload: {
          breakEndTime: now,
          totalDurationMs: adjustedTotal,
        },
      };
    }

    currentBreakEndTimestamp = null;
    breakCountdownPaused = true;

    return {
      channel: IpcChannel.BreakPause,
      payload: {
        remainingMs: adjustedRemaining,
        totalDurationMs: adjustedTotal,
      },
    };
  }

  const now = Date.now();
  const derivedRemaining = currentBreakEndTimestamp
    ? Math.max(0, currentBreakEndTimestamp - now)
    : Math.max(0, currentBreakRemainingMs ?? adjustedTotal);

  let adjustedRemaining = derivedRemaining + normalizedDelta;
  if (adjustedRemaining < 0) {
    adjustedRemaining = 0;
  }
  if (adjustedRemaining > adjustedTotal) {
    adjustedRemaining = adjustedTotal;
  }

  currentBreakTotalDurationMs = adjustedTotal;
  currentBreakRemainingMs = adjustedRemaining;
  updateCurrentHistoryEntryDuration(adjustedTotal);

  if (adjustedRemaining === 0) {
    currentBreakEndTimestamp = now;
    breakCountdownPaused = false;
    return {
      channel: IpcChannel.BreakStart,
      payload: {
        breakEndTime: now,
        totalDurationMs: adjustedTotal,
      },
    };
  }

  const adjustedEnd = now + adjustedRemaining;
  currentBreakEndTimestamp = adjustedEnd;
  breakCountdownPaused = false;

  return {
    channel: IpcChannel.BreakStart,
    payload: {
      breakEndTime: adjustedEnd,
      totalDurationMs: adjustedTotal,
    },
  };
}

export function isBreakCountdownPaused(): boolean {
  return breakCountdownPaused;
}

export function getCurrentBreakRemainingMs(): number | null {
  if (breakCountdownPaused) {
    return currentBreakRemainingMs;
  }

  if (currentBreakEndTimestamp) {
    return Math.max(0, currentBreakEndTimestamp - Date.now());
  }

  return null;
}

export function getCurrentBreakTotalDurationMs(): number | null {
  return currentBreakTotalDurationMs;
}

// Helper to expose the current break message to renderers (polled via settings get)
export async function skipCurrentBreakMessage(): Promise<BreakMessageSwitchResult> {
  const settings: Settings = getSettings();

  if (!havingBreak) {
    log.warn("Ignoring skipCurrentBreakMessage because no break is active");
    const fallbackDuration = resolveMessageDurationMs(
      settings,
      currentBreakMessage,
    );
    return createBreakMessageSwitchResult(fallbackDuration, settings);
  }

  const nextHistoryIndex = breakMessageHistoryIndex + 1;
  const historyEntry = getHistoryEntry(nextHistoryIndex);

  if (historyEntry) {
    breakMessageHistoryIndex = nextHistoryIndex;
    return applyBreakMessageEntry(historyEntry, settings);
  }

  const newMessage = await updateCurrentBreakMessageFromSettings(settings);
  const targetDurationMs = resolveMessageDurationMs(settings, newMessage);
  recordBreakMessageInHistory(newMessage, targetDurationMs);

  const currentEntry = getCurrentHistoryEntry();
  if (currentEntry) {
    return applyBreakMessageEntry(currentEntry, settings);
  }

  return createBreakMessageSwitchResult(targetDurationMs, settings);
}

export function goToPreviousBreakMessage(): BreakMessageSwitchResult {
  const settings: Settings = getSettings();

  if (!havingBreak) {
    log.warn("Ignoring goToPreviousBreakMessage because no break is active");
    const fallbackDuration = resolveMessageDurationMs(
      settings,
      currentBreakMessage,
    );
    return createBreakMessageSwitchResult(fallbackDuration, settings);
  }

  const previousHistoryIndex = breakMessageHistoryIndex - 1;
  if (previousHistoryIndex < 0) {
    log.warn(
      "Ignoring goToPreviousBreakMessage because no previous message is available",
    );
    const fallbackDuration = resolveMessageDurationMs(
      settings,
      currentBreakMessage,
    );
    return createBreakMessageSwitchResult(fallbackDuration, settings);
  }

  const previousEntry = getHistoryEntry(previousHistoryIndex);
  if (!previousEntry) {
    log.warn("Previous break message history entry missing");
    const fallbackDuration = resolveMessageDurationMs(
      settings,
      currentBreakMessage,
    );
    return createBreakMessageSwitchResult(fallbackDuration, settings);
  }

  breakMessageHistoryIndex = previousHistoryIndex;
  return applyBreakMessageEntry(previousEntry, settings);
}

export function getCurrentBreakMessage(): BreakMessageContent | null {
  return cloneBreakMessageContent(currentBreakMessage);
}

export function getCurrentBreakMessageSnapshot(): BreakMessageSwitchResult {
  const settings: Settings = getSettings();
  const durationMs =
    currentBreakTotalDurationMs ??
    resolveMessageDurationMs(settings, currentBreakMessage);

  return createBreakMessageSwitchResult(durationMs, settings);
}
