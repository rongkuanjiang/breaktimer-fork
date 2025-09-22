import Store from "electron-store";
import { defaultSettings, Settings, normalizeBreakMessages } from "../../types/settings";
import { setAutoLauch } from "./auto-launch";
import { initBreaks } from "./breaks";

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
];

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

  if (currentSettings.autoLaunch !== settings.autoLaunch) {
    setAutoLauch(settings.autoLaunch);
  }

  const nextSettings: Settings = {
    ...settings,
    breakMessages: normalizeBreakMessages(settings.breakMessages),
  };

  store.set({ settings: nextSettings });

  if (resetBreaks) {
    initBreaks();
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
