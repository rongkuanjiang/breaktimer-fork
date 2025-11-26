import { Moment } from "moment";
import type { BreakMessageContent } from "./settings";

export type BreakTime = Moment | null;

export interface BreakMessageNavigationState {
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface BreakMessageSwitchResult extends BreakMessageNavigationState {
  message: BreakMessageContent | null;
  /**
   * Total countdown duration in milliseconds for the returned message.
   * Always at least 1 second.
   */
  durationMs: number;
}

export interface BreakMessageUpdatePayload extends BreakMessageNavigationState {
  message: BreakMessageContent | null;
}
