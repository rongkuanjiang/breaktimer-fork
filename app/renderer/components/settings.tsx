import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import equal from "fast-deep-equal";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from "react";
import {
  MessageColorEffect,
  NotificationType,
  Settings,
  SoundType,
  defaultSettings,
} from "../../types/settings";
import { SettingsSchema } from "../../types/settings-schema";
import { useIpc } from "../contexts/ipc-context";
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

function areSettingsEqual(a: Settings | null, b: Settings | null): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null) {
    return false;
  }

  return equal(a, b);
}

export default function SettingsEl() {
  const ipc = useIpc();
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    (async () => {
      try {
        const rawSettings = await ipc.invokeGetSettings();
        const result = SettingsSchema.safeParse(rawSettings);

        if (result.success) {
          if (isMounted.current) {
            setSettingsDraft(result.data);
            setSettings(result.data);
          }
        } else {
          console.error("Settings validation failed:", result.error);
          toast("Failed to load settings. Using defaults.");
          if (isMounted.current) {
            setSettingsDraft(defaultSettings);
            setSettings(defaultSettings);
          }
        }

        // Check if this is the first time running the app
        const appInitialized = await ipc.invokeGetAppInitialized();
        if (isMounted.current) {
          setShowWelcomeModal(!appInitialized);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
        toast("Failed to load settings.");
        if (isMounted.current) {
          setSettingsDraft(defaultSettings);
          setSettings(defaultSettings);
        }
      }
    })();

    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const MIN_ZOOM = 0.8;
    const MAX_ZOOM = 1.5;
    const increaseKeys = new Set(["=", "+", "Add"]);
    const decreaseKeys = new Set(["-", "_", "Subtract"]);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      if (increaseKeys.has(event.key)) {
        event.preventDefault();
        setZoomLevel((current) => {
          // Use integer arithmetic to avoid floating point errors
          const currentSteps = Math.round(current * 10);
          const newSteps = Math.min(
            Math.round(MAX_ZOOM * 10),
            currentSteps + 1
          );
          return newSteps / 10;
        });
        return;
      }

      if (decreaseKeys.has(event.key)) {
        event.preventDefault();
        setZoomLevel((current) => {
          // Use integer arithmetic to avoid floating point errors
          const currentSteps = Math.round(current * 10);
          const newSteps = Math.max(
            Math.round(MIN_ZOOM * 10),
            currentSteps - 1
          );
          return newSteps / 10;
        });
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

      return () => {
        if (previousZoom) {
          body.style.zoom = previousZoom;
        } else {
          body.style.removeProperty("zoom");
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
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Spinner size={48} />
      </div>
    );
  }

  const handleNotificationTypeChange = useCallback((value: string): void => {
    const notificationType = value as NotificationType;
    setSettingsDraft((current) =>
      current ? { ...current, notificationType } : null
    );
  }, []);

  const handleDateChange = useCallback(
    (fieldName: string, newVal: Date): void => {
      const seconds =
        newVal.getHours() * 3600 +
        newVal.getMinutes() * 60 +
        newVal.getSeconds();

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

      setSettingsDraft((current) =>
        current
          ? {
              ...current,
              [secondsField]: seconds,
            }
          : null
      );
    },
    []
  );

  const handlePostponeLimitChange = useCallback((value: string): void => {
    const postponeLimit = Number(value);
    setSettingsDraft((current) =>
      current ? { ...current, postponeLimit } : null
    );
  }, []);

  const handleTextChange = useCallback(
    (
      field: string,
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ): void => {
      const value = e.target.value;
      setSettingsDraft((current) =>
        current
          ? {
              ...current,
              [field as keyof Settings]: value,
            }
          : null
      );
    },
    []
  );

  const handleValueChange = useCallback(
    <K extends keyof Settings>(field: K, value: Settings[K]): void => {
      setSettingsDraft((current) =>
        current
          ? {
              ...current,
              [field]: value,
            }
          : null
      );
    },
    []
  );

  const handleSwitchChange = useCallback(
    (field: string, checked: boolean): void => {
      setSettingsDraft((current) =>
        current
          ? {
              ...current,
              [field]: checked,
            }
          : null
      );
    },
    []
  );

  const handleResetColors = useCallback((): void => {
    setSettingsDraft((current) =>
      current
        ? {
            ...current,
            textColor: "#ffffff",
            backgroundColor: "#16a085",
            backgroundImage: null,
            backdropOpacity: 0.7,
            titleTextColor: "#ffffff",
            messageTextColor: "#ffffff",
            messageColorEffect: MessageColorEffect.Static,
            applyMessageColorEffectToTitle: false,
            applyMessageColorEffectToButtons: false,
          }
        : null
    );
  }, []);

  const handleSliderChange = useCallback(
    (field: keyof Settings, values: number[]): void => {
      setSettingsDraft((current) =>
        current
          ? {
              ...current,
              [field]: values[0],
            }
          : null
      );
    },
    []
  );

  const handleSoundTypeChange = useCallback((soundType: SoundType): void => {
    setSettingsDraft((current) =>
      current
        ? {
            ...current,
            soundType,
          }
        : null
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!settingsDraft) {
      return;
    }

    try {
      await ipc.invokeSetSettings(settingsDraft);

      if (!isMounted.current) {
        return;
      }

      const updatedSettings = (await ipc.invokeGetSettings()) as Settings;

      if (!isMounted.current) {
        return;
      }

      toast("Settings saved");
      setSettingsDraft(updatedSettings);
      setSettings(updatedSettings);
    } catch (error) {
      if (!isMounted.current) {
        return;
      }
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
  }, [ipc, settingsDraft]);

  const handleWorkingHoursEnabledChange = useCallback(
    (checked: boolean) => {
      handleSwitchChange("workingHoursEnabled", checked);
    },
    [handleSwitchChange]
  );

  const handleWelcomeModalClose = useCallback(() => {
    setShowWelcomeModal(false);
  }, []);

  const scrollAreaStyle: CSSProperties & Record<string, string | number> = {
    "--settings-scroll-padding-top": "1.5rem",
  };

  return (
    <div className="h-screen w-full flex flex-col bg-background">
      <Tabs
        defaultValue="break-behavior"
        className="w-full h-full flex flex-col"
      >
        <SettingsHeader handleSave={handleSave} showSave={dirty} />
        <div
          className="flex-1 overflow-auto p-6 min-h-0"
          style={scrollAreaStyle}
        >
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
                onCheckedChange: handleWorkingHoursEnabledChange,
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
              onMessagesChange={handleValueChange}
            />
          </TabsContent>

          <TabsContent value="customization" className="m-0 space-y-8">
            <ThemeCard
              settingsDraft={settingsDraft}
              onTextChange={handleTextChange}
              onValueChange={handleValueChange}
              onSwitchChange={handleSwitchChange}
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

          {window.process?.env?.SNAP === undefined && (
            <TabsContent value="system" className="m-0 space-y-6">
              <StartupCard
                settingsDraft={settingsDraft}
                onSwitchChange={handleSwitchChange}
              />
            </TabsContent>
          )}
        </div>
      </Tabs>
      <WelcomeModal open={showWelcomeModal} onClose={handleWelcomeModalClose} />
    </div>
  );
}
