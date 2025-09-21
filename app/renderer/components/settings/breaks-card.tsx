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
import { NotificationType, Settings, BreakMessagesMode } from "../../../types/settings";
import SettingsCard from "./settings-card";
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

export default function BreaksCard({
  settingsDraft,
  onNotificationTypeChange,
  onDateChange,
  onTextChange,
  onSwitchChange,
}: BreaksCardProps) {
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
            onValueChange={(val) => onTextChange("breakMessagesMode", { target: { value: val } } as any)}
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
            Add one or more messages. A random one is shown each break. Leave blank to use the single message field below.
          </p>
          <div className="space-y-3">
            {(settingsDraft.breakMessages || []).map((msg, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <Textarea
                  className="text-sm resize-none flex-1"
                  rows={3}
                  value={msg}
                  onChange={(e) => {
                    const newMessages = [...(settingsDraft.breakMessages || [])];
                    newMessages[idx] = e.target.value;
                    onTextChange("breakMessages", { target: { value: newMessages } } as any);
                  }}
                  disabled={!settingsDraft.breaksEnabled}
                  placeholder="Rest your eyes..."
                />
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={!settingsDraft.breaksEnabled}
                  onClick={() => {
                    const newMessages = [...(settingsDraft.breakMessages || [])];
                    newMessages.splice(idx, 1);
                    onTextChange("breakMessages", { target: { value: newMessages } } as any);
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const newMessages = [
                    ...(settingsDraft.breakMessages || []),
                    settingsDraft.breakMessage || "",
                  ];
                  onTextChange("breakMessages", { target: { value: newMessages } } as any);
                }}
                disabled={!settingsDraft.breaksEnabled}
              >
                Add Message
              </Button>
              {settingsDraft.breakMessages && settingsDraft.breakMessages.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onTextChange("breakMessages", { target: { value: [] } } as any);
                  }}
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
