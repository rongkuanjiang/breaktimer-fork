import Store from "electron-store";
import log from "electron-log";
import {
  defaultSettings,
  Settings,
  normalizeBreakMessage,
  normalizeBreakMessages,
  BreakMessageAttachment,
  BreakMessageContent,
  MessageColorEffect,
  BreakMessagesMode,
  validateWorkingHoursRanges,
  daysConfig,
} from "../../types/settings";
import { setAutoLaunch } from "./auto-launch";
import { initBreaks } from "./breaks";
import {
  attachmentExists,
  deleteAttachment,
  saveAttachmentFromDataUrl,
} from "./attachments";
import {
  generateSequentialOrder,
  sanitizeSequentialOrder,
} from "./break-rotation";

class AttachmentPersistenceError extends Error {
  attachmentName?: string;
  messageIndex?: number;
  details?: string;
  cause?: unknown;

  constructor(
    message: string,
    options?: {
      attachmentName?: string;
      messageIndex?: number;
      details?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "AttachmentPersistenceError";
    this.attachmentName = options?.attachmentName;
    this.messageIndex = options?.messageIndex;
    this.details = options?.details;
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}

type MigrationSettings = Partial<Settings> & Record<string, unknown>;

interface Migration {
  version: number;
  migrate: (settings: MigrationSettings) => MigrationSettings;
}

const migrations: Migration[] = [
  {
    version: 1,
    migrate: (settings: MigrationSettings) => {
      // Working hours migration
      if (
        settings.workingHoursMonday &&
        typeof settings.workingHoursMonday === "boolean"
      ) {
        console.log("Migrating working hours settings to new format");

        const oldToNew = (from: Date, to: Date) => ({
          fromMinutes: from.getHours() * 60 + from.getMinutes(),
          toMinutes: to.getHours() * 60 + to.getMinutes(),
        });

        const defaultRange = oldToNew(
          new Date(settings.workingHoursFrom as string | number | Date),
          new Date(settings.workingHoursTo as string | number | Date),
        );

        [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ].forEach((day) => {
          const key = `workingHours${day}`;
          settings[key] = {
            enabled: settings[key],
            ranges: [defaultRange],
          };
        });

        delete settings.workingHoursFrom;
        delete settings.workingHoursTo;
      }
      return settings;
    },
  },
  {
    version: 2,
    migrate: (settings: MigrationSettings) => {
      // Date to seconds migration
      if (settings.breakFrequency && !settings.breakFrequencySeconds) {
        console.log("Migrating date-based settings to seconds");

        const extractSeconds = (dateValue: string | Date): number => {
          const date = new Date(dateValue);
          const hours = date.getHours();
          const minutes = date.getMinutes();
          const seconds = date.getSeconds();
          return hours * 3600 + minutes * 60 + seconds;
        };

        // Convert Date objects to seconds
        if (settings.breakFrequency) {
          settings.breakFrequencySeconds = extractSeconds(
            settings.breakFrequency as string | Date,
          );
          delete settings.breakFrequency;
        }

        if (settings.breakLength) {
          settings.breakLengthSeconds = extractSeconds(
            settings.breakLength as string | Date,
          );
          delete settings.breakLength;
        }

        if (settings.postponeLength) {
          settings.postponeLengthSeconds = extractSeconds(
            settings.postponeLength as string | Date,
          );
          delete settings.postponeLength;
        }

        if (settings.idleResetLength) {
          settings.idleResetLengthSeconds = extractSeconds(
            settings.idleResetLength as string | Date,
          );
          delete settings.idleResetLength;
        }
      }
      return settings;
    },
  },
  {
    version: 3,
    migrate: (settings: MigrationSettings) => {
      // Introduce breakMessages array; migrate existing breakMessage if present
      if (!settings.breakMessages) {
        if (settings.breakMessage) {
          settings.breakMessages = [
            normalizeBreakMessage(settings.breakMessage as string),
          ];
        } else if (defaultSettings.breakMessage) {
          settings.breakMessages = [
            normalizeBreakMessage(defaultSettings.breakMessage),
          ];
        } else {
          settings.breakMessages = [];
        }
      }
      return settings;
    },
  },
  {
    version: 4,
    migrate: (settings: MigrationSettings) => {
      if (!settings.breakMessagesMode) {
        settings.breakMessagesMode = BreakMessagesMode.Random;
      }
      if (typeof settings.breakMessagesNextIndex !== "number") {
        settings.breakMessagesNextIndex = 0;
      }
      return settings;
    },
  },
  {
    version: 5,
    migrate: (settings: MigrationSettings) => {
      if (!Array.isArray(settings.breakMessagesOrder)) {
        settings.breakMessagesOrder = [];
      }
      return settings;
    },
  },

  {
    version: 6,
    migrate: (settings: MigrationSettings) => {
      const messages = normalizeBreakMessages(settings.breakMessages);

      if (messages.length > 0) {
        settings.breakMessages = messages;
      } else if (
        typeof settings.breakMessage === "string" &&
        settings.breakMessage.length > 0
      ) {
        settings.breakMessages = normalizeBreakMessages([
          settings.breakMessage,
        ]);
      } else {
        settings.breakMessages = [];
      }

      return settings;
    },
  },
  {
    version: 7,
    migrate: (settings: MigrationSettings) => {
      if (Array.isArray(settings.breakMessages)) {
        settings.breakMessages = persistAttachments(settings.breakMessages);
      }
      return settings;
    },
  },
  {
    version: 8,
    migrate: (settings: MigrationSettings) => {
      if (!settings.titleTextColor) {
        settings.titleTextColor =
          settings.textColor || defaultSettings.textColor;
      }
      if (!settings.messageTextColor) {
        settings.messageTextColor =
          settings.textColor || defaultSettings.textColor;
      }
      if (!settings.messageColorEffect) {
        settings.messageColorEffect = MessageColorEffect.Static;
      }
      return settings;
    },
  },
  {
    version: 9,
    migrate: (settings: MigrationSettings) => {
      if (typeof settings.backgroundImage === "undefined") {
        settings.backgroundImage = null;
      }
      return settings;
    },
  },
];

function collectAttachmentIds(
  messages: BreakMessageContent[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(messages)) {
    return ids;
  }

  for (const message of messages) {
    for (const attachment of message.attachments || []) {
      if (attachment && attachment.type === "image" && attachment.id) {
        ids.add(attachment.id);
      }
    }
  }

  return ids;
}

interface PersistAttachmentsOptions {
  onPersist?: (attachment: BreakMessageAttachment) => void;
}

function persistAttachments(
  messages: BreakMessageContent[] | undefined,
  options: PersistAttachmentsOptions = {},
): BreakMessageContent[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  const newAttachmentIds: string[] = [];

  const persistMessage = (
    message: BreakMessageContent,
    messageIndex: number,
  ): BreakMessageContent => {
    const persisted: BreakMessageAttachment[] = [];

    for (const attachment of message.attachments || []) {
      if (!attachment || attachment.type !== "image") {
        continue;
      }

      if (attachment.dataUrl) {
        try {
          const saved = saveAttachmentFromDataUrl(attachment.dataUrl, {
            mimeType: attachment.mimeType,
            name: attachment.name,
            sizeBytes: attachment.sizeBytes,
          });
          options.onPersist?.(saved);
          persisted.push(saved);
          newAttachmentIds.push(saved.id);
        } catch (error) {
          log.error(
            "Failed to persist attachment from dataUrl",
            attachment.name ?? "<unnamed>",
            error,
          );
          throw new AttachmentPersistenceError(
            `Failed to save attachment${attachment.name ? ` "${attachment.name}"` : ""}.`,
            {
              attachmentName: attachment.name,
              messageIndex,
              details: error instanceof Error ? error.message : String(error),
              cause: error,
            },
          );
        }
        continue;
      }

      if (attachment.uri && attachment.id) {
        if (attachmentExists(attachment.id)) {
          persisted.push({
            id: attachment.id,
            type: "image",
            uri: attachment.uri,
            mimeType: attachment.mimeType,
            name: attachment.name,
            sizeBytes: attachment.sizeBytes,
          });
        } else {
          log.warn("Skipping attachment with missing file", attachment.id);
        }
      }
    }

    return {
      ...message,
      attachments: persisted,
    };
  };

  try {
    return messages.map(persistMessage);
  } catch (error) {
    for (const id of newAttachmentIds) {
      try {
        deleteAttachment(id);
      } catch (cleanupError) {
        log.warn(
          "Failed to clean up attachment after persistence error",
          id,
          cleanupError,
        );
      }
    }
    throw error;
  }
}

function persistBackgroundImage(
  attachment: BreakMessageAttachment | null | undefined,
  options: PersistAttachmentsOptions = {},
): BreakMessageAttachment | null {
  if (!attachment || attachment.type !== "image") {
    return null;
  }

  if (attachment.dataUrl) {
    try {
      const saved = saveAttachmentFromDataUrl(attachment.dataUrl, {
        mimeType: attachment.mimeType,
        name: attachment.name,
        sizeBytes: attachment.sizeBytes,
      });
      options.onPersist?.(saved);
      return saved;
    } catch (error) {
      log.error(
        "Failed to persist background image from dataUrl",
        attachment.name ?? "<unnamed>",
        error,
      );
      throw new AttachmentPersistenceError(
        `Failed to save background image${attachment.name ? ` "${attachment.name}"` : ""}.`,
        {
          attachmentName: attachment.name,
          details: error instanceof Error ? error.message : String(error),
          cause: error,
        },
      );
    }
  }

  if (attachment.uri && attachment.id) {
    if (attachmentExists(attachment.id)) {
      return {
        id: attachment.id,
        type: "image",
        uri: attachment.uri,
        mimeType: attachment.mimeType,
        name: attachment.name,
        sizeBytes: attachment.sizeBytes,
      };
    }

    log.error("Failed to locate background image file on disk", attachment.id);
    throw new AttachmentPersistenceError(
      `Failed to save background image${attachment.name ? ` "${attachment.name}"` : ""}.`,
      {
        attachmentName: attachment.name,
        details: "File was not found after persistence attempt.",
      },
    );
  }

  return null;
}

function normalizeSequentialIndex(value: unknown, orderLength: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    orderLength <= 0
  ) {
    return 0;
  }

  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = ((value % orderLength) + orderLength) % orderLength;
  return normalized;
}

function resolveSequentialRotationState(
  currentSettings: Settings,
  incomingSettings: Settings,
  messageCount: number,
): { nextIndex: number; order: number[] } {
  if (messageCount <= 0) {
    return { nextIndex: 0, order: [] };
  }

  const currentOrder = sanitizeSequentialOrder(
    currentSettings.breakMessagesOrder,
    messageCount,
  );
  if (currentOrder) {
    const nextIndex = normalizeSequentialIndex(
      currentSettings.breakMessagesNextIndex,
      currentOrder.length,
    );
    return { nextIndex, order: currentOrder };
  }

  const incomingOrder = sanitizeSequentialOrder(
    incomingSettings.breakMessagesOrder,
    messageCount,
  );
  if (incomingOrder) {
    const nextIndex = normalizeSequentialIndex(
      incomingSettings.breakMessagesNextIndex,
      incomingOrder.length,
    );
    return { nextIndex, order: incomingOrder };
  }

  return {
    nextIndex: 0,
    order: generateSequentialOrder(messageCount),
  };
}

const store = new Store({
  defaults: {
    settings: defaultSettings,
    appInitialized: false,
    settingsVersion: 0,
    disableEndTime: null,
  },
});

function migrateSettings(settings: MigrationSettings): Settings {
  let currentVersion = store.get("settingsVersion") as number;
  const pendingMigrations = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  if (pendingMigrations.length > 0) {
    console.log(
      `Running migrations from version ${currentVersion} to ${
        pendingMigrations[pendingMigrations.length - 1].version
      }`,
    );

    let migratedSettings = { ...settings };
    let targetVersion = currentVersion;

    for (const migration of pendingMigrations) {
      try {
        console.log(`Applying migration version ${migration.version}`);
        migratedSettings = migration.migrate(migratedSettings);
        targetVersion = migration.version;
      } catch (error) {
        console.error(
          `Failed to apply migration version ${migration.version}:`,
          error,
        );
        log.error(
          `Migration ${migration.version} failed. Aborting migration process and keeping settings at version ${currentVersion}.`,
          error,
        );
        // Rollback: do not save partial migration state
        return settings as Settings;
      }
    }

    // Only save if all migrations succeeded
    store.set("settings", migratedSettings);
    store.set("settingsVersion", targetVersion);

    console.log(`Migrations completed. New version: ${targetVersion}`);
    return migratedSettings as Settings;
  }

  return settings as Settings;
}

export function getSettings(): Settings {
  const settings = store.get("settings") as MigrationSettings;
  const migratedSettings = migrateSettings(settings);
  const merged = Object.assign(
    {},
    defaultSettings,
    migratedSettings,
  ) as Settings;
  merged.breakMessages = normalizeBreakMessages(merged.breakMessages);
  return merged;
}

export async function setSettings(
  settings: Settings,
  resetBreaks = true,
): Promise<void> {
  const currentSettings = getSettings();
  const cleanupAttachmentIds: string[] = [];

  try {
    if (currentSettings.autoLaunch !== settings.autoLaunch) {
      await setAutoLaunch(settings.autoLaunch);
    }

    // Validate working hours ranges don't overlap
    for (const dayConfig of daysConfig) {
      const daySettings = settings[dayConfig.key];
      if (daySettings.enabled && daySettings.ranges.length > 1) {
        const validationError = validateWorkingHoursRanges(daySettings.ranges);
        if (validationError) {
          throw new Error(`${dayConfig.label}: ${validationError}`);
        }
      }
    }

    const normalizedMessages = normalizeBreakMessages(settings.breakMessages);
    const persistedMessages = persistAttachments(normalizedMessages, {
      onPersist: (attachment) => cleanupAttachmentIds.push(attachment.id),
    });
    const persistedBackgroundImage = persistBackgroundImage(
      settings.backgroundImage,
      {
        onPersist: (attachment) => cleanupAttachmentIds.push(attachment.id),
      },
    );

    const titleTextColor = settings.titleTextColor || settings.textColor;
    const messageTextColor = settings.messageTextColor || settings.textColor;
    const messageColorEffect =
      settings.messageColorEffect || MessageColorEffect.Static;
    const applyMessageColorEffectToTitle =
      settings.applyMessageColorEffectToTitle ?? false;
    const applyMessageColorEffectToButtons =
      settings.applyMessageColorEffectToButtons ?? false;

    const breakMessagesMode =
      settings.breakMessagesMode ??
      currentSettings.breakMessagesMode ??
      BreakMessagesMode.Random;

    const nextSettings: Settings = {
      ...settings,
      titleTextColor,
      messageTextColor,
      messageColorEffect,
      applyMessageColorEffectToTitle,
      applyMessageColorEffectToButtons,
      breakMessagesMode,
      breakMessages: persistedMessages,
      backgroundImage: persistedBackgroundImage,
    };

    if (resetBreaks) {
      if (nextSettings.breakMessagesMode === BreakMessagesMode.Sequential) {
        const { nextIndex, order } = resolveSequentialRotationState(
          currentSettings,
          nextSettings,
          persistedMessages.length,
        );
        nextSettings.breakMessagesNextIndex = nextIndex;
        nextSettings.breakMessagesOrder = order;
      } else {
        nextSettings.breakMessagesNextIndex = 0;
        nextSettings.breakMessagesOrder = [];
      }
    }

    const currentAttachmentIds = collectAttachmentIds(
      currentSettings.breakMessages,
    );
    if (currentSettings.backgroundImage?.id) {
      currentAttachmentIds.add(currentSettings.backgroundImage.id);
    }
    const nextAttachmentIds = collectAttachmentIds(persistedMessages);
    if (persistedBackgroundImage?.id) {
      nextAttachmentIds.add(persistedBackgroundImage.id);
    }

    for (const id of currentAttachmentIds) {
      if (!nextAttachmentIds.has(id)) {
        deleteAttachment(id);
      }
    }

    store.set({ settings: nextSettings });

    if (resetBreaks) {
      initBreaks();
    }
  } catch (error) {
    for (const id of cleanupAttachmentIds) {
      try {
        deleteAttachment(id);
      } catch (cleanupError) {
        log.warn(
          "Failed to clean up attachment after settings save error",
          id,
          cleanupError,
        );
      }
    }
    throw error;
  }
}

export function getAppInitialized(): boolean {
  return store.get("appInitialized") as boolean;
}

export function setAppInitialized(): void {
  store.set({ appInitialized: true });
}

export async function setBreaksEnabled(breaksEnabled: boolean): Promise<void> {
  const settings: Settings = getSettings();
  await setSettings({ ...settings, breaksEnabled }, false);
}

export function setDisableEndTime(endTime: number | null): void {
  store.set("disableEndTime", endTime);
}

export function getDisableEndTime(): number | null {
  return store.get("disableEndTime");
}
