import { z } from "zod";
import {
  NotificationType,
  SoundType,
  BreakMessagesMode,
  MessageColorEffect,
} from "./settings";

const WorkingHoursRangeSchema = z.object({
  fromMinutes: z.number(),
  toMinutes: z.number(),
});

const WorkingHoursSchema = z.object({
  enabled: z.boolean(),
  ranges: z.array(WorkingHoursRangeSchema),
});

const BreakMessageAttachmentSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  uri: z.string().optional(),
  mimeType: z.string().optional(),
  name: z.string().optional(),
  sizeBytes: z.number().optional(),
  dataUrl: z.string().optional(),
});

const BreakMessageContentSchema = z.object({
  text: z.string(),
  attachments: z.array(BreakMessageAttachmentSchema),
  durationSeconds: z.number().nullable().optional(),
});

export const SettingsSchema = z.object({
  autoLaunch: z.boolean(),
  breaksEnabled: z.boolean(),
  notificationType: z.nativeEnum(NotificationType),
  breakFrequencySeconds: z.number(),
  breakLengthSeconds: z.number(),
  postponeLengthSeconds: z.number(),
  postponeLimit: z.number(),
  workingHoursEnabled: z.boolean(),
  workingHoursMonday: WorkingHoursSchema,
  workingHoursTuesday: WorkingHoursSchema,
  workingHoursWednesday: WorkingHoursSchema,
  workingHoursThursday: WorkingHoursSchema,
  workingHoursFriday: WorkingHoursSchema,
  workingHoursSaturday: WorkingHoursSchema,
  workingHoursSunday: WorkingHoursSchema,
  idleResetEnabled: z.boolean(),
  idleResetLengthSeconds: z.number(),
  idleResetNotification: z.boolean(),
  soundType: z.nativeEnum(SoundType),
  breakSoundVolume: z.number(),
  breakTitle: z.string(),
  breakMessage: z.string(),
  breakMessages: z.array(BreakMessageContentSchema).optional(),
  breakMessagesMode: z.nativeEnum(BreakMessagesMode).optional(),
  breakMessagesNextIndex: z.number().optional(),
  breakMessagesOrder: z.array(z.number()).optional(),
  monthlyMessages: z.array(BreakMessageContentSchema).optional(),
  monthlyMessagesMode: z.nativeEnum(BreakMessagesMode).optional(),
  monthlyMessagesNextIndex: z.number().optional(),
  monthlyMessagesOrder: z.array(z.number()).optional(),
  backgroundColor: z.string(),
  backgroundImage: BreakMessageAttachmentSchema.nullable(),
  textColor: z.string(),
  titleTextColor: z.string(),
  messageTextColor: z.string(),
  messageColorEffect: z.nativeEnum(MessageColorEffect),
  applyMessageColorEffectToTitle: z.boolean(),
  applyMessageColorEffectToButtons: z.boolean(),
  showBackdrop: z.boolean(),
  backdropOpacity: z.number(),
  endBreakEnabled: z.boolean(),
  skipBreakEnabled: z.boolean(),
  postponeBreakEnabled: z.boolean(),
  immediatelyStartBreaks: z.boolean(),
});
