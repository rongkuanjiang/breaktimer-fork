import { createContext, useContext, ReactNode } from "react";

// Define the shape of the IPC renderer object based on the global declaration
export type IpcRenderer = typeof ipcRenderer;

const IpcContext = createContext<IpcRenderer | null>(null);

export const useIpc = () => {
  const context = useContext(IpcContext);
  if (!context) {
    throw new Error("useIpc must be used within an IpcProvider");
  }
  return context;
};

interface IpcProviderProps {
  children: ReactNode;
  // Allow injecting a mock implementation for testing
  ipc?: IpcRenderer;
}

export const IpcProvider = ({ children, ipc }: IpcProviderProps) => {
  // Default to the global ipcRenderer if no mock is provided
  // We cast to IpcRenderer because we know it matches the shape in the real app
  const value =
    ipc || (typeof ipcRenderer !== "undefined" ? ipcRenderer : null);

  if (!value) {
    // In a real app running in Electron, this should not happen if preload is correct.
    // In tests, we should provide the 'ipc' prop.
    console.warn(
      "IpcRenderer is not available. Are you running outside of Electron or missing a mock?"
    );
  }

  return (
    <IpcContext.Provider value={value as IpcRenderer}>
      {children}
    </IpcContext.Provider>
  );
};
