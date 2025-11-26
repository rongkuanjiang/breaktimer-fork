type BreakTimerStartPayload = {
  breakEndTime: number;
  totalDurationMs: number;
};

type BreakTimerPausePayload = {
  remainingMs: number;
  totalDurationMs: number;
};

declare const ipcRenderer: {
  invokeBreakPostpone: (action: string) => Promise<void>;
  invokeBreakPause: () => Promise<void>;
  invokeBreakResume: () => Promise<void>;
  invokeBreakMessageNext: () => Promise<
    import("./types/breaks").BreakMessageSwitchResult
  >;
  invokeBreakMessagePrevious: () => Promise<
    import("./types/breaks").BreakMessageSwitchResult
  >;
  invokeBreakAdjustDuration: (deltaMs: number) => Promise<void>;
  invokeGetAllowPostpone: () => Promise<boolean>;
  invokeGetBreakLength: () => Promise<number>;
  invokeBreakWindowResize: () => Promise<void>;
  invokeBreakWindowReady: () => Promise<void>;
  invokeSaveAttachment: (payload: {
    dataUrl: string;
    mimeType?: string;
    name?: string;
    sizeBytes?: number;
  }) => Promise<import("./types/settings").BreakMessageAttachment>;
  invokeGetSettings: () => Promise<import("./types/settings").Settings>;
  invokeGetCurrentBreakMessage: () => Promise<
    import("./types/breaks").BreakMessageSwitchResult
  >;
  invokeEndSound: (type: string, volume?: number) => Promise<unknown>;
  invokeStartSound: (type: string, volume?: number) => Promise<unknown>;
  invokeSetSettings: (settings: import("./types/settings").Settings) => Promise<void>;
  invokeGetTimeSinceLastBreak: () => Promise<number | null>;
  invokeCompleteBreakTracking: (breakDurationMs: number) => Promise<void>;
  invokeWasStartedFromTray: () => Promise<boolean>;
  invokeGetAppInitialized: () => Promise<boolean>;
  invokeSetAppInitialized: () => Promise<void>;
  invokeBreakStart: () => Promise<void>;
  invokeBreakEnd: () => Promise<void>;
  onPlayEndSound: (cb: (type: string, volume?: number) => void) => () => void;
  onPlayStartSound: (cb: (type: string, volume?: number) => void) => () => void;
  onBreakStart: (cb: (payload: BreakTimerStartPayload) => void) => () => void;
  onBreakPause: (cb: (payload: BreakTimerPausePayload) => void) => () => void;
  onBreakEnd: (cb: () => void) => () => void;
  onBreakMessageUpdate: (
    cb: (payload: import("./types/breaks").BreakMessageUpdatePayload) => void,
  ) => () => void;
};



declare const webFrame: {
  setZoomFactor?: (factor: number) => void;
  getZoomFactor?: () => number;
};

interface Window {
  process: {
    env: { [key: string]: string | undefined };
    platform: string;
  };
}

declare module "*.scss" {
  const content: { [className: string]: string };
  export = content;
}
