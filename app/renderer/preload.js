/**
 * This preload script is run when browser windows are created and allows us to
 * safely expose node/electron APIs to the renderer process.
 *
 * See https://www.electronjs.org/docs/tutorial/context-isolation for more
 * information.
 */

const { contextBridge, ipcRenderer, webFrame } = require("electron");

process.once("loaded", () => {
  contextBridge.exposeInMainWorld("process", {
    env: { ...process.env },
    platform: process.platform,
  });
  contextBridge.exposeInMainWorld("webFrame", {
    setZoomFactor: (factor) => {
      webFrame.setZoomFactor(factor);
    },
    getZoomFactor: () => {
      return webFrame.getZoomFactor();
    },
  });
  contextBridge.exposeInMainWorld("ipcRenderer", {
    invokeBreakPostpone: (action) => {
      return ipcRenderer.invoke("BREAK_POSTPONE", action);
    },
    invokeBreakPause: () => {
      return ipcRenderer.invoke("BREAK_PAUSE");
    },
    invokeBreakResume: () => {
      return ipcRenderer.invoke("BREAK_RESUME");
    },
    invokeBreakMessageNext: () => {
      return ipcRenderer.invoke("BREAK_MESSAGE_NEXT");
    },
    invokeBreakMessagePrevious: () => {
      return ipcRenderer.invoke("BREAK_MESSAGE_PREVIOUS");
    },
    invokeBreakAdjustDuration: (deltaMs) => {
      return ipcRenderer.invoke("BREAK_ADJUST_DURATION", deltaMs);
    },
    invokeGetAllowPostpone: () => {
      return ipcRenderer.invoke("ALLOW_POSTPONE_GET");
    },
    invokeGetBreakLength: () => {
      return ipcRenderer.invoke("BREAK_LENGTH_GET");
    },
    invokeGetSettings: () => {
      return ipcRenderer.invoke("SETTINGS_GET");
    },
    invokeGetCurrentBreakMessage: () => {
      return ipcRenderer.invoke("CURRENT_BREAK_MESSAGE_GET");
    },
    invokeEndSound: (type, volume = 1) => {
      return ipcRenderer.invoke("SOUND_END_PLAY", type, volume);
    },
    invokeStartSound: (type, volume = 1) => {
      return ipcRenderer.invoke("SOUND_START_PLAY", type, volume);
    },
    invokeSetSettings: (settings) => {
      return ipcRenderer.invoke("SETTINGS_SET", settings);
    },
    invokeBreakWindowResize: () => {
      return ipcRenderer.invoke("BREAK_WINDOW_RESIZE");
    },
    invokeBreakWindowReady: () => {
      return ipcRenderer.invoke("BREAK_WINDOW_READY");
    },
    invokeSaveAttachment: (payload) => {
      return ipcRenderer.invoke("ATTACHMENT_SAVE", payload);
    },
    invokeGetTimeSinceLastBreak: () => {
      return ipcRenderer.invoke("TIME_SINCE_LAST_BREAK_GET");
    },
    invokeCompleteBreakTracking: (breakDurationMs) => {
      return ipcRenderer.invoke("BREAK_TRACKING_COMPLETE", breakDurationMs);
    },
    invokeWasStartedFromTray: () => {
      return ipcRenderer.invoke("WAS_STARTED_FROM_TRAY_GET");
    },
    invokeGetAppInitialized: () => {
      return ipcRenderer.invoke("APP_INITIALIZED_GET");
    },
    invokeSetAppInitialized: () => {
      return ipcRenderer.invoke("APP_INITIALIZED_SET");
    },
    invokeBreakStart: () => {
      return ipcRenderer.invoke("BREAK_START");
    },
    invokeBreakEnd: () => {
      return ipcRenderer.invoke("BREAK_END");
    },
    onPlayStartSound: (cb) => {
      const listener = (_event, type, volume = 1) => {
        cb(type, volume);
      };
      ipcRenderer.on("SOUND_START_PLAY", listener);
      return () => ipcRenderer.removeListener("SOUND_START_PLAY", listener);
    },
    onPlayEndSound: (cb) => {
      const listener = (_event, type, volume = 1) => {
        cb(type, volume);
      };
      ipcRenderer.on("SOUND_END_PLAY", listener);
      return () => ipcRenderer.removeListener("SOUND_END_PLAY", listener);
    },
    onBreakStart: (cb) => {
      const listener = (_event, payload) => {
        cb(payload);
      };
      ipcRenderer.on("BREAK_START", listener);
      return () => ipcRenderer.removeListener("BREAK_START", listener);
    },
    onBreakPause: (cb) => {
      const listener = (_event, payload) => {
        cb(payload);
      };
      ipcRenderer.on("BREAK_PAUSE", listener);
      return () => ipcRenderer.removeListener("BREAK_PAUSE", listener);
    },
    onBreakEnd: (cb) => {
      const listener = () => {
        cb();
      };
      ipcRenderer.on("BREAK_END", listener);
      return () => ipcRenderer.removeListener("BREAK_END", listener);
    },
    onBreakMessageUpdate: (cb) => {
      const listener = (_event, payload) => {
        cb(payload);
      };
      ipcRenderer.on("BREAK_MESSAGE_UPDATE", listener);
      return () => ipcRenderer.removeListener("BREAK_MESSAGE_UPDATE", listener);
    },
  });
});
