import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useEffect, useMemo, useState } from "react";
import { MessageColorEffect, NotificationType, Settings, SoundType } from "../../types/settings";
import { toast } from "../toaster";
import AdvancedCard from "./settings/advanced-card";
import AudioCard from "./settings/audio-card";
import BackdropCard from "./settings/backdrop-card";
import BreaksCard from "./settings/breaks-card";
import MessagesCard from "./settings/messages-card";
import SettingsCard from "./settings/settings-card";
import SettingsHeader from "./settings/settings-header";
import SkipCard from "./settings/skip-card";
import SmartBreaksCard from "./settings/smart-breaks-card";
import SnoozeCard from "./settings/snooze-card";
import StartupCard from "./settings/startup-card";
import ThemeCard from "./settings/theme-card";
import WorkingHoursSettings from "./settings/working-hours";
import WelcomeModal from "./welcome-modal";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }

  if (a === null || b === null) {
    return false;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }

    for (let index = 0; index < a.length; index += 1) {
      if (!deepEqual(a[index], b[index])) {
        return false;
      }
    }

    return true;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return false;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (typeof a === "object" && typeof b === "object") {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(aRecord), ...Object.keys(bRecord)]);

    for (const key of keys) {
      if (!deepEqual(aRecord[key], bRecord[key])) {
        return false;
      }
    }

    return true;
  }

  return false;
}

function areSettingsEqual(a: Settings | null, b: Settings | null): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null) {
    return false;
  }

  return deepEqual(a, b);
}

export default function SettingsEl() {
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    (async () => {
      const settings = (await ipcRenderer.invokeGetSettings()) as Settings;
      setSettingsDraft(settings);
      setSettings(settings);

      // Check if this is the first time running the app
      const appInitialized = await ipcRenderer.invokeGetAppInitialized();
      setShowWelcomeModal(!appInitialized);
    })();
  }, []);

  useEffect(() => {
    const MIN_ZOOM = 0.8;
    const MAX_ZOOM = 1.5;
    const ZOOM_STEP = 0.1;
    const increaseKeys = new Set(["=", "+", "Add"]);
    const decreaseKeys = new Set(["-", "_", "Subtract"]);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (increaseKeys.has(event.key)) {
        event.preventDefault();
        setZoomLevel((current) =>
          Math.min(MAX_ZOOM, parseFloat((current + ZOOM_STEP).toFixed(2))),
        );
        return;
      }

      if (decreaseKeys.has(event.key)) {
        event.preventDefault();
        setZoomLevel((current) =>
          Math.max(MIN_ZOOM, parseFloat((current - ZOOM_STEP).toFixed(2))),
        );
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        setZoomLevel(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const hasWebFrame =
      typeof webFrame !== "undefined" &&
      typeof webFrame.getZoomFactor === "function" &&
      typeof webFrame.setZoomFactor === "function";

    if (!hasWebFrame) {
      const body = document.body;
      if (!body) {
        return;
      }

      const previousZoom = body.style.zoom;
      const previousBackground = body.style.backgroundColor;
      body.style.backgroundColor = "var(--background)";

      return () => {
        if (previousZoom) {
          body.style.zoom = previousZoom;
        } else {
          body.style.removeProperty("zoom");
        }

        if (previousBackground) {
          body.style.backgroundColor = previousBackground;
        } else {
          body.style.removeProperty("background-color");
        }
      };
    }

    const setZoom = webFrame.setZoomFactor!;
    const getZoom = webFrame.getZoomFactor!;
    const initialZoom = getZoom();
    setZoomLevel(initialZoom);

    return () => {
      setZoom(initialZoom);
    };
  }, []);

  useEffect(() => {
    const hasWebFrame =
      typeof webFrame !== "undefined" &&
      typeof webFrame.setZoomFactor === "function" &&
      typeof webFrame.getZoomFactor === "function";

    if (hasWebFrame) {
      const setZoom = webFrame.setZoomFactor!;
      setZoom(zoomLevel);
      return;
    }

    const body = document.body;
    if (!body) {
      return;
    }

    body.style.setProperty("zoom", zoomLevel.toString());
    return () => {
      body.style.removeProperty("zoom");
    };
  }, [zoomLevel]);

  const dirty = useMemo(() => {
    return !areSettingsEqual(settingsDraft, settings);
  }, [settings, settingsDraft]);

  if (settings === null || settingsDraft === null) {
    return null;
  }

  const handleNotificationTypeChange = (value: string): void => {
    const notificationType = value as NotificationType;
    setSettingsDraft({ ...settingsDraft, notificationType });
  };

  const handleDateChange = (fieldName: string, newVal: Date): void => {
    const seconds =
      newVal.getHours() * 3600 + newVal.getMinutes() * 60 + newVal.getSeconds();

    let secondsField: keyof Settings;
    if (fieldName === "breakFrequency") {
      secondsField = "breakFrequencySeconds";
    } else if (fieldName === "breakLength") {
      secondsField = "breakLengthSeconds";
    } else if (fieldName === "postponeLength") {
      secondsField = "postponeLengthSeconds";
    } else if (fieldName === "idleResetLength") {
      secondsField = "idleResetLengthSeconds";
    } else {
      return;
    }

    setSettingsDraft({
      ...settingsDraft,
      [secondsField]: seconds,
    });
  };

  const handlePostponeLimitChange = (value: string): void => {
    const postponeLimit = Number(value);
    setSettingsDraft({ ...settingsDraft, postponeLimit });
  };

  const handleTextChange = (
    field: string,
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    // Allow passing arrays via synthetic events (for breakMessages)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const value = (e.target as any).value;
    setSettingsDraft({
      ...settingsDraft,
      [field]: value,
    });
  };

  const handleSwitchChange = (field: string, checked: boolean): void => {
    setSettingsDraft({
      ...settingsDraft,
      [field]: checked,
    });
  };

  const handleResetColors = (): void => {
    setSettingsDraft({
      ...settingsDraft,
      textColor: "#ffffff",
      backgroundColor: "#16a085",
      backgroundImage: null,
      backdropOpacity: 0.7,
      titleTextColor: "#ffffff",
      messageTextColor: "#ffffff",
      messageColorEffect: MessageColorEffect.Static,
    });
  };

  const handleSliderChange = (
    field: keyof Settings,
    values: number[],
  ): void => {
    setSettingsDraft({
      ...settingsDraft,
      [field]: values[0],
    });
  };

  const handleSoundTypeChange = (soundType: SoundType): void => {
    setSettingsDraft({
      ...settingsDraft,
      soundType,
    });
  };

  const handleSave = async () => {
    if (!settingsDraft) {
      return;
    }

    try {
      await ipcRenderer.invokeSetSettings(settingsDraft);
      const updatedSettings = (await ipcRenderer.invokeGetSettings()) as Settings;
      toast("Settings saved");
      setSettingsDraft(updatedSettings);
      setSettings(updatedSettings);
    } catch (error) {
      // Log to devtools for debugging while keeping UI feedback user-friendly
      console.error("Failed to save settings", error);
      const baseMessage =
        error instanceof Error && error.message
          ? error.message
          : "Failed to save settings.";
      const details =
        typeof (error as { details?: string }).details === "string"
          ? (error as { details: string }).details
          : null;
      toast(details ? `${baseMessage} (${details})` : baseMessage);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      <Tabs
        defaultValue="break-behavior"
        className="w-full h-full flex flex-col"
      >
        <SettingsHeader handleSave={handleSave} showSave={dirty} />
        <div className="flex-1 overflow-auto p-6 min-h-0">
          <TabsContent value="break-behavior" className="m-0 space-y-8">
            <BreaksCard
              settingsDraft={settingsDraft}
              onNotificationTypeChange={handleNotificationTypeChange}
              onDateChange={handleDateChange}
              onTextChange={handleTextChange}
              onSwitchChange={handleSwitchChange}
            />

            <SmartBreaksCard
              settingsDraft={settingsDraft}
              onSwitchChange={handleSwitchChange}
              onDateChange={handleDateChange}
            />

            <SnoozeCard
              settingsDraft={settingsDraft}
              onSwitchChange={handleSwitchChange}
              onDateChange={handleDateChange}
              onPostponeLimitChange={handlePostponeLimitChange}
            />

            <SkipCard
              settingsDraft={settingsDraft}
              onSwitchChange={handleSwitchChange}
            />

            <AdvancedCard
              settingsDraft={settingsDraft}
              onSwitchChange={handleSwitchChange}
            />
            <SettingsCard
              title="Working Hours"
              helperText="Only show breaks during your configured work schedule."
              toggle={{
                checked: settingsDraft.workingHoursEnabled,
                onCheckedChange: (checked) =>
                  handleSwitchChange("workingHoursEnabled", checked),
                disabled: !settingsDraft.breaksEnabled,
              }}
            >
              <WorkingHoursSettings
                settingsDraft={settingsDraft}
                setSettingsDraft={setSettingsDraft}
              />
            </SettingsCard>
          </TabsContent>

          <TabsContent value="messages" className="m-0 space-y-8">
            <MessagesCard
              settingsDraft={settingsDraft}
              onTextChange={handleTextChange}
            />
          </TabsContent>

          <TabsContent value="customization" className="m-0 space-y-8">
            <ThemeCard
              settingsDraft={settingsDraft}
              onTextChange={handleTextChange}
              onResetColors={handleResetColors}
            />

            <AudioCard
              settingsDraft={settingsDraft}
              onSoundTypeChange={handleSoundTypeChange}
              onSliderChange={handleSliderChange}
            />

            <BackdropCard
              settingsDraft={settingsDraft}
              onSwitchChange={handleSwitchChange}
              onSliderChange={handleSliderChange}
            />
          </TabsContent>

          {processEnv.SNAP === undefined && (
            <TabsContent value="system" className="m-0 space-y-6">
              <StartupCard
                settingsDraft={settingsDraft}
                onSwitchChange={handleSwitchChange}
              />
            </TabsContent>
          )}
        </div>
      </Tabs>
      <WelcomeModal
        open={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
      />
    </div>
  );
}
