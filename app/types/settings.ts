export enum NotificationType {
  Notification = "NOTIFICATION",
  Popup = "POPUP",
}

export interface WorkingHoursRange {
  fromMinutes: number;
  toMinutes: number;
}

export interface WorkingHours {
  enabled: boolean;
  ranges: WorkingHoursRange[];
}

export enum SoundType {
  None = "NONE",
  Gong = "GONG",
  Blip = "BLIP",
  Bloop = "BLOOP",
  Ping = "PING",
  Scifi = "SCIFI",
}

export enum BreakMessagesMode {
  Random = "RANDOM",
  Sequential = "SEQUENTIAL",
}

export interface BreakMessageAttachment {
  id: string;
  type: "image";
  dataUrl: string;
  mimeType?: string;
  name?: string;
}

export interface BreakMessageContent {
  text: string;
  attachments: BreakMessageAttachment[];
}

export type BreakMessageInput =
  | string
  | Partial<BreakMessageContent>
  | null
  | undefined;

function createAttachmentId(): string {
  return "att-" + Math.random().toString(36).slice(2, 10);
}

function sanitizeAttachment(
  attachment: Partial<BreakMessageAttachment> | null | undefined,
): BreakMessageAttachment | null {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  if (typeof attachment.dataUrl !== "string" || attachment.dataUrl.length === 0) {
    return null;
  }

  const mimeType =
    typeof attachment.mimeType === "string" && attachment.mimeType.length > 0
      ? attachment.mimeType
      : undefined;

  return {
    id:
      typeof attachment.id === "string" && attachment.id.length > 0
        ? attachment.id
        : createAttachmentId(),
    type: "image",
    dataUrl: attachment.dataUrl,
    mimeType,
    name:
      typeof attachment.name === "string" && attachment.name.length > 0
        ? attachment.name
        : undefined,
  };
}

export function normalizeBreakMessage(
  input: BreakMessageInput,
): BreakMessageContent {
  if (!input) {
    return { text: "", attachments: [] };
  }

  if (typeof input === "string") {
    return { text: input, attachments: [] };
  }

  const textSource =
    typeof input.text === "string"
      ? input.text
      : typeof (input as Record<string, unknown>).message === "string"
        ? ((input as Record<string, unknown>).message as string)
        : typeof (input as Record<string, unknown>).value === "string"
          ? ((input as Record<string, unknown>).value as string)
          : "";

  const attachmentsSource = Array.isArray(input.attachments)
    ? input.attachments
    : [];

  const attachments = attachmentsSource
    .map((attachment) => sanitizeAttachment(attachment))
    .filter((attachment): attachment is BreakMessageAttachment => !!attachment);

  return {
    text: textSource,
    attachments,
  };
}

export function normalizeBreakMessages(
  inputs: BreakMessageInput[] | null | undefined,
): BreakMessageContent[] {
  if (!Array.isArray(inputs)) {
    return [];
  }

  return inputs.map((input) => normalizeBreakMessage(input));
}

export interface Settings {
  autoLaunch: boolean;
  breaksEnabled: boolean;
  notificationType: NotificationType;
  breakFrequencySeconds: number;
  breakLengthSeconds: number;
  postponeLengthSeconds: number;
  postponeLimit: number;
  workingHoursEnabled: boolean;
  workingHoursMonday: WorkingHours;
  workingHoursTuesday: WorkingHours;
  workingHoursWednesday: WorkingHours;
  workingHoursThursday: WorkingHours;
  workingHoursFriday: WorkingHours;
  workingHoursSaturday: WorkingHours;
  workingHoursSunday: WorkingHours;
  idleResetEnabled: boolean;
  idleResetLengthSeconds: number;
  idleResetNotification: boolean;
  soundType: SoundType;
  breakSoundVolume: number;
  breakTitle: string;
  breakMessage: string;
  // New: optional list of messages. If present and non-empty, one is chosen at random each break.
  breakMessages?: BreakMessageContent[];
  breakMessagesMode?: BreakMessagesMode; // RANDOM (default) or SEQUENTIAL
  breakMessagesNextIndex?: number; // internal pointer for sequential mode
  breakMessagesOrder?: number[]; // stored shuffle order for sequential mode
  backgroundColor: string;
  textColor: string;
  showBackdrop: boolean;
  backdropOpacity: number;
  endBreakEnabled: boolean;
  skipBreakEnabled: boolean;
  postponeBreakEnabled: boolean;
  immediatelyStartBreaks: boolean;
}

export const defaultWorkingRange: WorkingHoursRange = {
  fromMinutes: 9 * 60, // 09:00
  toMinutes: 18 * 60, // 18:00
};

export const defaultSettings: Settings = {
  autoLaunch: true,
  breaksEnabled: true,
  notificationType: NotificationType.Popup,
  breakFrequencySeconds: 28 * 60,
  breakLengthSeconds: 2 * 60,
  postponeLengthSeconds: 3 * 60,
  postponeLimit: 0,
  workingHoursEnabled: true,
  workingHoursMonday: {
    enabled: true,
    ranges: [defaultWorkingRange],
  },
  workingHoursTuesday: {
    enabled: true,
    ranges: [defaultWorkingRange],
  },
  workingHoursWednesday: {
    enabled: true,
    ranges: [defaultWorkingRange],
  },
  workingHoursThursday: {
    enabled: true,
    ranges: [defaultWorkingRange],
  },
  workingHoursFriday: {
    enabled: true,
    ranges: [defaultWorkingRange],
  },
  workingHoursSaturday: {
    enabled: false,
    ranges: [defaultWorkingRange],
  },
  workingHoursSunday: {
    enabled: false,
    ranges: [defaultWorkingRange],
  },
  idleResetEnabled: true,
  idleResetLengthSeconds: 5 * 60,
  idleResetNotification: false,
  soundType: SoundType.Gong,
  breakSoundVolume: 1,
  breakTitle: "Time for a break.",
  breakMessage: "Rest your eyes.\nStretch your legs.\nBreathe. Relax.",
  breakMessages: [
    {
      text: "Rest your eyes.\nStretch your legs.\nBreathe. Relax.",
      attachments: [],
    },
  ],
  breakMessagesMode: BreakMessagesMode.Random,
  breakMessagesNextIndex: 0,
  breakMessagesOrder: [0],
  backgroundColor: "#16a085",
  textColor: "#ffffff",
  showBackdrop: true,
  backdropOpacity: 0.7,
  endBreakEnabled: true,
  skipBreakEnabled: false,
  postponeBreakEnabled: true,
  immediatelyStartBreaks: false,
};

export interface DayConfig {
  key:
    | "workingHoursMonday"
    | "workingHoursTuesday"
    | "workingHoursWednesday"
    | "workingHoursThursday"
    | "workingHoursFriday"
    | "workingHoursSaturday"
    | "workingHoursSunday";
  label: string;
}

export const daysConfig: DayConfig[] = [
  { key: "workingHoursMonday", label: "Monday" },
  { key: "workingHoursTuesday", label: "Tuesday" },
  { key: "workingHoursWednesday", label: "Wednesday" },
  { key: "workingHoursThursday", label: "Thursday" },
  { key: "workingHoursFriday", label: "Friday" },
  { key: "workingHoursSaturday", label: "Saturday" },
  { key: "workingHoursSunday", label: "Sunday" },
];
