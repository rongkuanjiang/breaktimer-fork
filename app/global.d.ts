declare const ipcRenderer: {
  invokeBreakPostpone: (action: string) => Promise<void>;
  invokeGetAllowPostpone: () => Promise<boolean>;
  invokeGetBreakLength: () => Promise<number>;
  invokeBreakWindowResize: () => Promise<void>;
  invokeBreakWindowReady: () => Promise<void>;
  invokeSaveAttachment: (payload: { dataUrl: string; mimeType?: string; name?: string; sizeBytes?: number }) => Promise<import("./types/settings").BreakMessageAttachment>;
  invokeGetSettings: () => Promise<unknown>;
  invokeGetCurrentBreakMessage: () => Promise<import("./types/settings").BreakMessageContent | null>;
  invokeEndSound: (type: string, volume?: number) => Promise<unknown>;
  invokeStartSound: (type: string, volume?: number) => Promise<unknown>;
  invokeSetSettings: (settings: unknown) => Promise<void>;
  invokeGetTimeSinceLastBreak: () => Promise<number | null>;
  invokeCompleteBreakTracking: (breakDurationMs: number) => Promise<void>;
  invokeWasStartedFromTray: () => Promise<boolean>;
  invokeGetAppInitialized: () => Promise<boolean>;
  invokeSetAppInitialized: () => Promise<void>;
  invokeBreakStart: () => Promise<void>;
  invokeBreakEnd: () => Promise<void>;
  onPlayEndSound: (
    cb: (type: string, volume?: number) => void,
  ) => Promise<void>;
  onPlayStartSound: (
    cb: (type: string, volume?: number) => void,
  ) => Promise<void>;
  onBreakStart: (cb: (breakEndTime: number) => void) => void;
  onBreakEnd: (cb: () => void) => void;
};

declare const processEnv: {
  [key: string]: string;
};

declare const processPlatform: string;

declare const webFrame: {
  setZoomFactor?: (factor: number) => void;
  getZoomFactor?: () => number;
};

declare module "*.scss" {
  const content: { [className: string]: string };
  export = content;
}
