import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_BREAK_ATTACHMENT_BYTES,
  MessageColorEffect,
  Settings,
  type BreakMessageAttachment,
  normalizeAttachment,
} from "../../../types/settings";
import { toast } from "../../toaster";

interface ThemeCardProps {
  settingsDraft: Settings;
  onTextChange: (field: string, e: React.ChangeEvent<HTMLInputElement>) => void;
  onResetColors: () => void;
}

const BREATHING_PREVIEWS: Record<MessageColorEffect, string[]> = {
  [MessageColorEffect.Static]: [],
  [MessageColorEffect.BreathingAurora]: ["#38ef7d", "#4facfe", "#38ef7d"],
  [MessageColorEffect.BreathingSunset]: ["#ff9966", "#ff5e62", "#ff9966"],
  [MessageColorEffect.BreathingOcean]: ["#43cea2", "#185a9d", "#43cea2"],
};

function createSyntheticInputEvent<T>(value: T): React.ChangeEvent<HTMLInputElement> {
  return {
    target: {
      value,
    },
  } as unknown as React.ChangeEvent<HTMLInputElement>;
}

const EFFECT_OPTIONS = [
  {
    value: MessageColorEffect.Static,
    label: "Static",
  },
  {
    value: MessageColorEffect.BreathingAurora,
    label: "Breathing Aurora",
  },
  {
    value: MessageColorEffect.BreathingSunset,
    label: "Breathing Sunset",
  },
  {
    value: MessageColorEffect.BreathingOcean,
    label: "Breathing Ocean",
  },
];

export default function ThemeCard({
  settingsDraft,
  onTextChange,
  onResetColors,
}: ThemeCardProps) {
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const backgroundImageSource =
    settingsDraft.backgroundImage?.uri || settingsDraft.backgroundImage?.dataUrl || null;
  const hasBackgroundImage = Boolean(backgroundImageSource);

  const customStyle: CSSProperties = useMemo(
    () => ({
      color: settingsDraft.textColor,
    }),
    [settingsDraft.textColor],
  );

  const backgroundPreviewStyle: CSSProperties | undefined = useMemo(() => {
    if (!backgroundImageSource) {
      return undefined;
    }
    return {
      backgroundImage: `url(${backgroundImageSource})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    };
  }, [backgroundImageSource]);

  const messagePreview = useMemo(() => {
    if (settingsDraft.messageColorEffect === MessageColorEffect.Static) {
      return {
        initial: { color: settingsDraft.messageTextColor },
        animate: { color: settingsDraft.messageTextColor },
        transition: undefined,
      };
    }

    const palette =
      BREATHING_PREVIEWS[settingsDraft.messageColorEffect] &&
      BREATHING_PREVIEWS[settingsDraft.messageColorEffect].length > 0
        ? BREATHING_PREVIEWS[settingsDraft.messageColorEffect]
        : [settingsDraft.messageTextColor];

    return {
      initial: { color: palette[0] },
      animate: { color: palette },
      transition: {
        duration: 4,
        repeat: Infinity,
        repeatType: "reverse" as const,
        ease: "easeInOut" as const,
      },
    };
  }, [settingsDraft.messageColorEffect, settingsDraft.messageTextColor]);

  const handleBackgroundImageRemove = useCallback(() => {
    onTextChange("backgroundImage", createSyntheticInputEvent<BreakMessageAttachment | null>(null));
  }, [onTextChange]);

  const handleBackgroundImageSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleBackgroundImageChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] || null;
      event.target.value = "";

      if (!file) {
        return;
      }

      if (!file.type.startsWith("image/")) {
        toast("Please choose an image file.");
        return;
      }

      if (file.size > MAX_BREAK_ATTACHMENT_BYTES) {
        toast("Image is too large. Please choose one under 4 MB.");
        return;
      }

      const readFileAsDataUrl = (source: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") {
              resolve(reader.result);
            } else {
              reject(new Error("Could not read file contents"));
            }
          };
          reader.onerror = () => reject(reader.error ?? new Error("Could not read file contents"));
          reader.readAsDataURL(source);
        });
      };

      setIsProcessingImage(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const normalized = normalizeAttachment({
          dataUrl,
          mimeType: file.type,
          name: file.name,
          sizeBytes: file.size,
        });

        if (!normalized) {
          toast("Could not use that image. Please try a different file.");
          return;
        }

        onTextChange("backgroundImage", createSyntheticInputEvent(normalized));
      } catch {
        toast("Failed to load the selected image. Please try again.");
      } finally {
        setIsProcessingImage(false);
      }
    },
    [onTextChange],
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-6" style={customStyle}>
      <div className="flex items-center justify-between">
        <h3
          className="text-base font-semibold"
          style={{ color: settingsDraft.textColor }}
        >
          Theme
        </h3>
        <Button
          onClick={onResetColors}
          variant="outline"
          style={{
            color: settingsDraft.textColor,
            borderColor: `${settingsDraft.textColor}4D`,
          }}
          className="!bg-transparent hover:!bg-current/10 active:!bg-current/20"
        >
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label
            className="text-sm font-medium"
            style={{ color: settingsDraft.textColor }}
          >
            Background color
          </Label>
          <input
            className="w-20 h-10 rounded cursor-pointer border appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded"
            style={{
              backgroundColor: settingsDraft.backgroundColor,
              borderColor: `${settingsDraft.textColor}4D`,
            }}
            type="color"
            value={settingsDraft.backgroundColor}
            onChange={onTextChange.bind(null, "backgroundColor")}
          />
        </div>
        <div className="space-y-2 col-span-2">
          <Label
            className="text-sm font-medium"
            style={{ color: settingsDraft.textColor }}
          >
            Background image
          </Label>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div
              className="h-[100px] w-[100px] rounded-md border border-border/60 overflow-hidden bg-black/10 shrink-0"
              style={
                backgroundPreviewStyle ?? { backgroundColor: settingsDraft.backgroundColor }
              }
            >
              {!backgroundImageSource && (
                <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs font-medium opacity-80">
                  No image
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                onClick={handleBackgroundImageSelect}
                disabled={isProcessingImage}
              >
                {hasBackgroundImage ? "Change image" : "Add image"}
              </Button>
              {hasBackgroundImage && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBackgroundImageRemove}
                  disabled={isProcessingImage}
                >
                  Remove
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleBackgroundImageChange}
              />
              <p className="text-xs text-muted-foreground max-w-xs">
                Images up to 4 MB. The background color is applied to the message card for readability.
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label
            className="text-sm font-medium"
            style={{ color: settingsDraft.textColor }}
          >
            UI text color
          </Label>
          <input
            className="w-20 h-10 rounded cursor-pointer border border-border appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded"
            style={{ backgroundColor: settingsDraft.textColor }}
            type="color"
            value={settingsDraft.textColor}
            onChange={onTextChange.bind(null, "textColor")}
          />
        </div>
        <div className="space-y-2">
          <Label
            className="text-sm font-medium"
            style={{ color: settingsDraft.textColor }}
          >
            Title color
          </Label>
          <input
            className="w-20 h-10 rounded cursor-pointer border border-border appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded"
            style={{ backgroundColor: settingsDraft.titleTextColor }}
            type="color"
            value={settingsDraft.titleTextColor}
            onChange={onTextChange.bind(null, "titleTextColor")}
          />
        </div>
        <div className="space-y-2">
          <Label
            className="text-sm font-medium"
            style={{ color: settingsDraft.textColor }}
          >
            Message base color
          </Label>
          <input
            className="w-20 h-10 rounded cursor-pointer border border-border appearance-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded"
            style={{ backgroundColor: settingsDraft.messageTextColor }}
            type="color"
            value={settingsDraft.messageTextColor}
            onChange={onTextChange.bind(null, "messageTextColor")}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label
          className="text-sm font-medium"
          style={{ color: settingsDraft.textColor }}
        >
          Message color effect
        </Label>
        <Select
          value={settingsDraft.messageColorEffect}
          onValueChange={(value) =>
            onTextChange("messageColorEffect", createSyntheticInputEvent(value))
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EFFECT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="rounded-md border border-border/40 px-4 py-3 bg-black/10 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide" style={{ color: settingsDraft.textColor }}>Preview</span>
          <motion.span
            className="text-sm font-medium px-3 py-1 rounded-md"
            initial={messagePreview.initial}
            animate={messagePreview.animate}
            transition={messagePreview.transition}
          >
            Take a deep breath
          </motion.span>
        </div>
      </div>
    </div>
  );
}
