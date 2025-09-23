import { useCallback, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  NotificationType,
  BreakMessagesMode,
  normalizeBreakMessage,
  MAX_BREAK_ATTACHMENT_BYTES,
} from "../../../types/settings";
import type {
  Settings,
  BreakMessageContent,
  BreakMessageAttachment,
} from "../../../types/settings";
import SettingsCard from "./settings-card";
import { toast } from "../../toaster";
import TimeInput from "./time-input";

interface BreaksCardProps {
  settingsDraft: Settings;
  onNotificationTypeChange: (value: string) => void;
  onDateChange: (fieldName: string, newVal: Date) => void;
  onTextChange: (
    field: string,
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onSwitchChange: (field: string, checked: boolean) => void;
}

interface BreakMessageEditorProps {
  value: BreakMessageContent;
  disabled: boolean;
  onChange: (value: BreakMessageContent) => void;
  onRemove: () => void;
  index: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read file contents"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Could not read file contents"));
    };
    reader.readAsDataURL(file);
  });
}


function createSyntheticInputEvent<T>(value: T): ChangeEvent<HTMLInputElement> {
  return { target: { value } } as unknown as ChangeEvent<HTMLInputElement>;
}

function BreakMessageEditor({
  value,
  disabled,
  onChange,
  onRemove,
  index,
}: BreakMessageEditorProps) {

  const [isProcessingPaste, setIsProcessingPaste] = useState(false);

  const handleTextChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(
        normalizeBreakMessage({
          ...value,
          text: event.target.value,
        }),
      );
    },
    [onChange, value],
  );

  const handleRemoveAttachment = useCallback(
    (id: string) => {
      const next = normalizeBreakMessage({
        ...value,
        attachments: value.attachments.filter((attachment) => attachment.id !== id),
      });
      onChange(next);
    },
    [onChange, value],
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file && file.type.startsWith("image/"));

      if (files.length === 0) {
        return;
      }

      const textData = event.clipboardData?.getData("text/plain");
      if (!textData) {
        event.preventDefault();
      }

      setIsProcessingPaste(true);
      try {
        const attachments: BreakMessageAttachment[] = [];
        let rejectedLargeFile = false;

        for (const file of files) {
          if (file.size > MAX_BREAK_ATTACHMENT_BYTES) {
            rejectedLargeFile = true;
            continue;
          }

          try {
            const dataUrl = await readFileAsDataUrl(file);
            const saved = (await ipcRenderer.invokeSaveAttachment({
              dataUrl,
              mimeType: file.type,
              name: file.name,
              sizeBytes: file.size,
            })) as BreakMessageAttachment;
            attachments.push(saved);
          } catch (error) {
            console.error("Failed to persist pasted image", error);
            toast("Couldn't save attachment. Try a smaller file.");
          }
        }

        if (rejectedLargeFile) {
          toast("Images must be 4 MB or smaller.");
        }

        if (attachments.length > 0) {
          const next = normalizeBreakMessage({
            ...value,
            attachments: [...value.attachments, ...attachments],
          });
          onChange(next);
        }
      } finally {
        setIsProcessingPaste(false);
      }
    },
    [onChange, value],
  );

  return (
    <div className="rounded-md border p-3 space-y-3 bg-muted/10">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Message {index + 1}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
        >
          Remove
        </Button>
      </div>
      <Textarea
        className="text-sm resize-none flex-1"
        rows={4}
        value={value.text}
        onChange={handleTextChange}
        onPaste={handlePaste}
        disabled={disabled}
        placeholder="Rest your eyes..."
      />
      <p className="text-xs text-muted-foreground">Paste images directly into the message area to attach them.</p>
      {isProcessingPaste && (
        <p className="text-xs text-muted-foreground">Attaching image...</p>
      )}
      {value.attachments.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {value.attachments.map((attachment) => (
            <figure
              key={attachment.id}
              className="relative rounded-md border bg-background p-2"
            >
              <img
                src={attachment.uri}
                alt={attachment.name || "Break message attachment"}
                className="max-h-32 max-w-[16rem] rounded-sm object-contain"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6"
                onClick={() => handleRemoveAttachment(attachment.id)}
                disabled={disabled}
              >
                <X className="h-3 w-3" />
              </Button>
              {attachment.name && (
                <figcaption className="mt-1 truncate text-xs text-muted-foreground">
                  {attachment.name}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BreaksCard({
  settingsDraft,
  onNotificationTypeChange,
  onDateChange,
  onTextChange,
  onSwitchChange,
}: BreaksCardProps) {
  const breakMessages: BreakMessageContent[] =
    settingsDraft.breakMessages ?? [];

  const handleMessagesChange = useCallback(
    (messages: BreakMessageContent[]) => {
      onTextChange("breakMessages", createSyntheticInputEvent(messages));
    },
    [onTextChange],
  );

  return (
    <SettingsCard
      title="Breaks"
      toggle={{
        checked: settingsDraft.breaksEnabled,
        onCheckedChange: (checked) => onSwitchChange("breaksEnabled", checked),
      }}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Type</Label>
            <Select
              value={settingsDraft.notificationType}
              onValueChange={onNotificationTypeChange}
              disabled={!settingsDraft.breaksEnabled}
            >
              <SelectTrigger style={{ width: 145 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NotificationType.Popup}>
                  Popup break
                </SelectItem>
                <SelectItem value={NotificationType.Notification}>
                  Simple notification
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Frequency</Label>
            <TimeInput
              precision="seconds"
              value={settingsDraft.breakFrequencySeconds}
              onChange={(seconds) => {
                const date = new Date();
                date.setHours(Math.floor(seconds / 3600));
                date.setMinutes(Math.floor((seconds % 3600) / 60));
                date.setSeconds(seconds % 60);
                onDateChange("breakFrequency", date);
              }}
              disabled={!settingsDraft.breaksEnabled}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Length</Label>
            <TimeInput
              precision="seconds"
              value={settingsDraft.breakLengthSeconds}
              onChange={(seconds) => {
                const date = new Date();
                date.setHours(Math.floor(seconds / 3600));
                date.setMinutes(Math.floor((seconds % 3600) / 60));
                date.setSeconds(seconds % 60);
                onDateChange("breakLength", date);
              }}
              disabled={
                !settingsDraft.breaksEnabled ||
                settingsDraft.notificationType !== NotificationType.Popup
              }
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Title</Label>
          <Input
            id="break-title"
            className="text-sm"
            value={settingsDraft.breakTitle}
            onChange={onTextChange.bind(null, "breakTitle")}
            disabled={!settingsDraft.breaksEnabled}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Message Order</Label>
          <Select
            value={settingsDraft.breakMessagesMode || BreakMessagesMode.Random}
            onValueChange={(val) =>
              onTextChange("breakMessagesMode", createSyntheticInputEvent(val))
            }
            disabled={!settingsDraft.breaksEnabled}
          >
            <SelectTrigger style={{ width: 180 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BreakMessagesMode.Random}>Random</SelectItem>
              <SelectItem value={BreakMessagesMode.Sequential}>Sequential (Round Robin)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium">Messages</Label>
          <p className="text-xs text-muted-foreground">
            Add one or more messages. Paste images directly into a message to attach them.
            Markdown-style bullets (&quot;*&quot;, &quot;1.&quot;, &quot;a.&quot;) are formatted automatically during breaks.
          </p>
          <div className="space-y-3">
            {breakMessages.map((msg, idx) => (
              <BreakMessageEditor
                key={idx}
                value={msg}
                index={idx}
                disabled={!settingsDraft.breaksEnabled}
                onChange={(updated) => {
                  const next = [...breakMessages];
                  next[idx] = updated;
                  handleMessagesChange(next);
                }}
                onRemove={() => {
                  const next = [...breakMessages];
                  next.splice(idx, 1);
                  handleMessagesChange(next);
                }}
              />
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const next = [
                    ...breakMessages,
                    normalizeBreakMessage(settingsDraft.breakMessage || ""),
                  ];
                  handleMessagesChange(next);
                }}
                disabled={!settingsDraft.breaksEnabled}
              >
                Add Message
              </Button>
              {breakMessages.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleMessagesChange([])}
                  disabled={!settingsDraft.breaksEnabled}
                >
                  Clear All
                </Button>
              )}
            </div>
          </div>
          <Label className="text-sm font-medium mt-4 block">Single Message (fallback)</Label>
          <Textarea
            id="break-message"
            className="text-sm resize-none"
            rows={3}
            value={settingsDraft.breakMessage}
            onChange={onTextChange.bind(null, "breakMessage")}
            disabled={!settingsDraft.breaksEnabled}
            placeholder="Enter your break message..."
          />
        </div>
      </div>
    </SettingsCard>
  );
}
