import Store from "electron-store";
import log from "electron-log";
import {
  defaultSettings,
  Settings,
  normalizeBreakMessages,
  BreakMessageAttachment,
  BreakMessageContent,
  MessageColorEffect,
} from "../../types/settings";
import { setAutoLauch } from "./auto-launch";
import { initBreaks } from "./breaks";
import {
  attachmentExists,
  deleteAttachment,
  saveAttachmentFromDataUrl,
} from "./attachments";

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

interface Migration {
  version: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  migrate: (settings: any) => any;
}

const migrations: Migration[] = [
  {
    version: 1,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
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
          new Date(settings.workingHoursFrom),
          new Date(settings.workingHoursTo),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
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
            settings.breakFrequency,
          );
          delete settings.breakFrequency;
        }

        if (settings.breakLength) {
          settings.breakLengthSeconds = extractSeconds(settings.breakLength);
          delete settings.breakLength;
        }

        if (settings.postponeLength) {
          settings.postponeLengthSeconds = extractSeconds(
            settings.postponeLength,
          );
          delete settings.postponeLength;
        }

        if (settings.idleResetLength) {
          settings.idleResetLengthSeconds = extractSeconds(
            settings.idleResetLength,
          );
          delete settings.idleResetLength;
        }
      }
      return settings;
    },
  },
  {
    version: 3,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      // Introduce breakMessages array; migrate existing breakMessage if present
      if (!settings.breakMessages) {
        if (settings.breakMessage) {
          settings.breakMessages = [settings.breakMessage];
        } else if (defaultSettings.breakMessage) {
          settings.breakMessages = [defaultSettings.breakMessage];
        } else {
          settings.breakMessages = [];
        }
      }
      return settings;
    },
  },
  {
    version: 3,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      // Initialize breakMessages array if not present
      if (!settings.breakMessages) {
        if (settings.breakMessage) {
          settings.breakMessages = [settings.breakMessage];
        } else {
          settings.breakMessages = [];
        }
      }
      return settings;
    },
  },
  {
    version: 4,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      if (!settings.breakMessagesMode) {
        settings.breakMessagesMode = "RANDOM";
      }
      if (typeof settings.breakMessagesNextIndex !== "number") {
        settings.breakMessagesNextIndex = 0;
      }
      return settings;
    },
  },
  {
    version: 5,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      if (!Array.isArray(settings.breakMessagesOrder)) {
        settings.breakMessagesOrder = [];
      }
      return settings;
    },
  },

  {
    version: 6,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      const messages = normalizeBreakMessages(settings.breakMessages);

      if (messages.length > 0) {
        settings.breakMessages = messages;
      } else if (typeof settings.breakMessage === "string" && settings.breakMessage.length > 0) {
        settings.breakMessages = normalizeBreakMessages([settings.breakMessage]);
      } else {
        settings.breakMessages = [];
      }

      return settings;
    },
  },
  {
    version: 7,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      if (Array.isArray(settings.breakMessages)) {
        settings.breakMessages = persistAttachments(settings.breakMessages);
      }
      return settings;
    },
  },
  {
    version: 8,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      if (!settings.titleTextColor) {
        settings.titleTextColor = settings.textColor || defaultSettings.textColor;
      }
      if (!settings.messageTextColor) {
        settings.messageTextColor = settings.textColor || defaultSettings.textColor;
      }
      if (!settings.messageColorEffect) {
        settings.messageColorEffect = MessageColorEffect.Static;
      }
      return settings;
    },
  },
  {
    version: 9,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    migrate: (settings: any) => {
      if (typeof settings.backgroundImage === "undefined") {
        settings.backgroundImage = null;
      }
      return settings;
    },
  },
];

function collectAttachmentIds(messages: BreakMessageContent[] | undefined): Set<string> {
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

  const persistMessage = (message: BreakMessageContent, messageIndex: number): BreakMessageContent => {
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
        log.warn("Failed to clean up attachment after persistence error", id, cleanupError);
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

const store = new Store({
  defaults: {
    settings: defaultSettings,
    appInitialized: false,
    settingsVersion: 0,
    disableEndTime: null,
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateSettings(settings: any): Settings {
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

    for (const migration of pendingMigrations) {
      try {
        console.log(`Applying migration version ${migration.version}`);
        migratedSettings = migration.migrate(migratedSettings);
        currentVersion = migration.version;
      } catch (error) {
        console.error(
          `Failed to apply migration version ${migration.version}:`,
          error,
        );
        break;
      }
    }

    // Save migrated settings and update version
    store.set("settings", migratedSettings);
    store.set("settingsVersion", currentVersion);

    console.log(`Migrations completed. New version: ${currentVersion}`);
    return migratedSettings;
  }

  return settings;
}

export function getSettings(): Settings {
  const settings = store.get("settings");
  const migratedSettings = migrateSettings(settings);
  const merged = Object.assign({}, defaultSettings, migratedSettings) as Settings;
  merged.breakMessages = normalizeBreakMessages(merged.breakMessages);
  return merged;
}

export function setSettings(settings: Settings, resetBreaks = true): void {
  const currentSettings = getSettings();
  const cleanupAttachmentIds: string[] = [];

  try {
    if (currentSettings.autoLaunch !== settings.autoLaunch) {
      setAutoLauch(settings.autoLaunch);
    }

    const normalizedMessages = normalizeBreakMessages(settings.breakMessages);
    const persistedMessages = persistAttachments(normalizedMessages, {
      onPersist: (attachment) => cleanupAttachmentIds.push(attachment.id),
    });
    const persistedBackgroundImage = persistBackgroundImage(settings.backgroundImage, {
      onPersist: (attachment) => cleanupAttachmentIds.push(attachment.id),
    });

    const titleTextColor = settings.titleTextColor || settings.textColor;
    const messageTextColor = settings.messageTextColor || settings.textColor;
    const messageColorEffect =
      settings.messageColorEffect || MessageColorEffect.Static;

    const nextSettings: Settings = {
      ...settings,
      titleTextColor,
      messageTextColor,
      messageColorEffect,
      breakMessages: persistedMessages,
      backgroundImage: persistedBackgroundImage,
    };

    const currentAttachmentIds = collectAttachmentIds(currentSettings.breakMessages);
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
        log.warn("Failed to clean up attachment after settings save error", id, cleanupError);
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

export function setBreaksEnabled(breaksEnabled: boolean): void {
  const settings: Settings = getSettings();
  setSettings({ ...settings, breaksEnabled }, false);
}

export function setDisableEndTime(endTime: number | null): void {
  store.set("disableEndTime", endTime);
}

export function getDisableEndTime(): number | null {
  return store.get("disableEndTime");
}
