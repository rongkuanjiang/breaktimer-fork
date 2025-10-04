import { PowerMonitor } from "electron";
import log from "electron-log";
import moment from "moment";
import { BreakTime } from "../../types/breaks";
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

// Helper function to strip HTML tags from text
function stripHtml(html: string): string {
  // First convert <br> tags to spaces
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function generateShuffledIndexes(length: number): number[] {
  const indexes = Array.from({ length }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
}

function sanitizeOrder(
  order: number[] | undefined,
  length: number,
): number[] | null {
  if (!Array.isArray(order) || order.length !== length) {
    return null;
  }

  const seen = new Set<number>();
  for (const value of order) {
    if (!Number.isInteger(value) || value < 0 || value >= length || seen.has(value)) {
      return null;
    }
    seen.add(value);
  }

  return order.slice();
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

export function getBreakTime(): BreakTime {
  return breakTime;
}

export function getBreakLengthSeconds(): number {
  const settings: Settings = getSettings();

  if (havingBreak) {
    const override = currentBreakMessage?.durationSeconds;
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
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
    log.info(
      `Break too short [duration=${durationSeconds}s] [required=${requiredSeconds}s]`,
    );
  }

  currentBreakStartTime = null;
}

function zeroPad(n: number) {
  const nStr = String(n);
  return nStr.length === 1 ? `0${nStr}` : nStr;
}

function getSecondsFromSettings(seconds: number): number {
  return seconds || 1; // can't be 0
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

  if (idleSeconds > 60) {
    idleMinutes = Math.floor(idleSeconds / 60);
    idleSeconds -= idleMinutes * 60;
  }

  if (idleMinutes > 60) {
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

  if (idleStart) {
    createIdleNotification();
    idleStart = null;
    postponedCount = 0;

    lastCompletedBreakTime = new Date();
    hasSkippedOrSnoozedSinceLastBreak = false;
    log.info("Break auto-detected via idle reset");
  }

  const seconds = isPostpone
    ? settings.postponeLengthSeconds
    : settings.breakFrequencySeconds;

  breakTime = moment().add(seconds, "seconds");

  log.info(
    `Scheduling next break [isPostpone=${isPostpone}] [seconds=${seconds}] [postponeLength=${settings.postponeLengthSeconds}] [frequency=${settings.breakFrequencySeconds}] [scheduledFor=${breakTime.format("HH:mm:ss")}]`,
  );

  buildTray();
}

export function endPopupBreak(): void {
  log.info("Break ended");
  const existingBreakTime = breakTime;
  const now = moment();
  havingBreak = false;
  startedFromTray = false;

  // If there's no future break scheduled, create a normal break
  if (!existingBreakTime || existingBreakTime <= now) {
    postponedCount = 0;
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
  postponedCount++;
  havingBreak = false;
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

function doBreak(): void {
  havingBreak = true;
  startBreakTracking();

  const settings: Settings = getSettings();
  // Choose a break message according to mode
  const availableMessages = normalizeBreakMessages(settings.breakMessages);
  if (availableMessages.length > 0) {
    if (settings.breakMessagesMode === BreakMessagesMode.Sequential) {
      const totalMessages = availableMessages.length;
      const idxRaw =
        typeof settings.breakMessagesNextIndex === "number"
          ? settings.breakMessagesNextIndex
          : 0;
      const currentIndex = ((idxRaw % totalMessages) + totalMessages) % totalMessages;

      let order = sanitizeOrder(settings.breakMessagesOrder, totalMessages);
      if (!order) {
        order = generateShuffledIndexes(totalMessages);
      }

      const messageIndex = order[currentIndex] ?? 0;
      currentBreakMessage = availableMessages[messageIndex] ?? availableMessages[0];

      let nextIndex = currentIndex + 1;
      if (nextIndex >= totalMessages) {
        nextIndex = 0;
        order = generateShuffledIndexes(totalMessages);
      }

      // Persist next index and current order. We update settings silently without resetting breaks
      try {
        const updated: Settings = {
          ...settings,
          breakMessagesNextIndex: nextIndex,
          breakMessagesOrder: order,
          breakMessages: availableMessages,
        };
        const { setSettings } = require("./store");
        setSettings(updated, false);
      } catch (err) {
        log.warn("Failed to persist break message rotation state", err);
      }
    } else {
      // Random
      const idx = Math.floor(Math.random() * availableMessages.length);
      currentBreakMessage = availableMessages[idx];
    }
  } else {
    currentBreakMessage = normalizeBreakMessage(settings.breakMessage);
  }
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
    havingBreak = false;
    scheduleNextBreak();
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

function checkBreak(): void {
  const now = moment();

  if (breakTime !== null && now > breakTime) {
    doBreak();
  }
}

export function startBreakNow(): void {
  startedFromTray = true;
  breakTime = moment();
}

export function wasStartedFromTray(): boolean {
  return startedFromTray;
}

function tick(): void {
  try {
    const shouldHaveBreak = checkShouldHaveBreak();

    // This can happen if the computer is put to sleep. In this case, we want
    // to skip the break if the time the computer was unresponsive was greater
    // than the idle reset.
    const secondsSinceLastTick = lastTick
      ? Math.abs(+new Date() - +lastTick) / 1000
      : 0;
    const breakSeconds = getBreakSeconds();
    const lockSeconds = lockStart && Math.abs(+new Date() - +lockStart) / 1000;

    if (lockStart && lockSeconds !== null && lockSeconds > breakSeconds) {
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
    } else if (secondsSinceLastTick > getIdleResetSeconds()) {
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
        const idleResetSeconds = getIdleResetSeconds();
        // Calculate when idle actually started by subtracting idle duration
        idleStart = new Date(Date.now() - idleResetSeconds * 1000);
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

let tickInterval: NodeJS.Timeout;

export function initBreaks(): void {
  powerMonitor = require("electron").powerMonitor;

  const settings: Settings = getSettings();

  if (settings.breaksEnabled) {
    scheduleNextBreak();
  }

  if (tickInterval) {
    clearInterval(tickInterval);
  }

  tickInterval = setInterval(tick, 1000);
}

// Helper to expose the current break message to renderers (polled via settings get)
export function getCurrentBreakMessage(): BreakMessageContent | null {
  if (!currentBreakMessage) {
    return null;
  }

  const cloned: BreakMessageContent = {
    text: currentBreakMessage.text,
    attachments: currentBreakMessage.attachments.map((attachment) => ({
      ...attachment,
    })),
  };

  if (currentBreakMessage.durationSeconds !== undefined) {
    cloned.durationSeconds = currentBreakMessage.durationSeconds;
  }

  return cloned;
}
