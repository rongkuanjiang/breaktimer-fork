import path from "path";
import { Notification, Event } from "electron";

export function showNotification(
  title: string,
  body: string,
  onClick?: (e: Event) => void,
  forceClose = true,
): void {
  let imgPath: string | undefined;
  if (process.platform !== "darwin") {
    imgPath =
      process.env.NODE_ENV === "development"
        ? "resources/tray/icon.png"
        : path.join(process.resourcesPath, "app/resources/tray/icon.png");
  }

  const notification = new Notification({
    title,
    body,
    icon: imgPath,
    silent: process.platform !== "win32",
  });

  let isClosed = false;

  // Track when notification is closed
  notification.on("close", () => {
    isClosed = true;
  });

  if (forceClose && process.platform !== "darwin") {
    // Ensure notification doesn't stay open longer than 5 secs
    setTimeout(() => {
      if (!isClosed) {
        notification.close();
      }
    }, 5000);
  }

  if (onClick) {
    notification.on("click", onClick);
  }

  notification.show();
}
