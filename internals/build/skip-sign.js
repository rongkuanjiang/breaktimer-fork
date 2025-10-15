/**
 * Electron Builder hook used to short-circuit Windows code signing during dev builds.
 * The function signature matches CustomWindowsSign from electron-builder.
 */
module.exports = async function skipWindowsSign(config) {
  // Returning without touching the target file tells electron-builder to proceed without invoking signtool.
  if (process.env.DEBUG_SIGN_SKIP === "1") {
    // eslint-disable-next-line no-console
    console.log(`Skipping code signing for ${config?.path ?? "unknown file"}`);
  }
};
