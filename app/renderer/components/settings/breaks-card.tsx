import type { ChangeEvent } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SettingsCard from "./settings-card";
import TimeInput from "./time-input";
import { Input } from "@/components/ui/input";
import { NotificationType, type Settings } from "../../../types/settings";

interface BreaksCardProps {
  settingsDraft: Settings;
  onNotificationTypeChange: (value: string) => void;
  onDateChange: (fieldName: string, newVal: Date) => void;
  onTextChange: (
    field: string,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onSwitchChange: (field: string, checked: boolean) => void;
}

function secondsToDate(seconds: number): Date {
  const date = new Date();
  date.setHours(Math.floor(seconds / 3600));
  date.setMinutes(Math.floor((seconds % 3600) / 60));
  date.setSeconds(seconds % 60);
  return date;
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
      title="Break Timing"
      helperText="Control how often breaks appear and how long they last."
      toggle={{
        checked: settingsDraft.breaksEnabled,
        onCheckedChange: (checked) => onSwitchChange("breaksEnabled", checked),
      }}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Type</Label>
            <Select
              value={settingsDraft.notificationType}
              onValueChange={onNotificationTypeChange}
              disabled={!settingsDraft.breaksEnabled}
            >
              <SelectTrigger style={{ width: 180 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NotificationType.Popup}>Popup break</SelectItem>
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
              onChange={(seconds) => onDateChange("breakFrequency", secondsToDate(seconds))}
              disabled={!settingsDraft.breaksEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Length</Label>
            <TimeInput
              precision="seconds"
              value={settingsDraft.breakLengthSeconds}
              onChange={(seconds) => onDateChange("breakLength", secondsToDate(seconds))}
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
      </div>
    </SettingsCard>
  );
}
