import AutoLaunch from "auto-launch";

let app = { name: "BreakTimer" };

if (process.env.APPIMAGE) {
  app = Object.assign(app, { path: process.env.APPIMAGE });
}

const AppLauncher = new AutoLaunch(app);

export async function setAutoLaunch(autoLaunch: boolean): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    try {
      if (autoLaunch) {
        await AppLauncher.enable();
      } else {
        await AppLauncher.disable();
      }
    } catch (error) {
      console.error("Failed to set auto-launch:", error);
      throw error;
    }
  }
}
