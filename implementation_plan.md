# MindfulPulse: Architecture & Migration Guide

## 1. Executive Summary

This document serves as the architectural blueprint for **MindfulPulse**, a commercial desktop application designed to deliver custom affirmations via spaced repetition and emotion tracking.

**Goal:** Create a clean-room implementation of a "smart interruption" app, inspired by the functionality of break timers but evolved into a mental wellness tool.

**License Strategy:** This project is a **new** codebase. Do not copy-paste code from GPL-licensed projects. Use this guide to implement the _logic_ and _patterns_ from scratch.

---

## 2. Technology Stack

- **Runtime:** [Electron](https://www.electronjs.org/) (Latest stable)
- **Frontend:** [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **State Management:** [Zustand](https://github.com/pmndrs/zustand) (Renderer) + [Electron Store](https://github.com/sindresorhus/electron-store) (Persistence)
- **Database (Optional but Recommended):** [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) or [RxDB](https://rxdb.info/) (For Anki-style card scheduling). _For MVP, a JSON file is sufficient._
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) (For accessible, premium components).

---

## 3. Core Architecture

### 3.1. Process Model

The app follows the standard Electron multi-process model:

1.  **Main Process:**
    - Handles OS-level integrations (System Tray, Power Monitor, Global Shortcuts).
    - Manages the "Scheduler Loop" (The brain that decides _when_ to interrupt).
    - Manages Window creation and lifecycle.
    - Persists data to disk.
2.  **Renderer Process (UI):**
    - **Dashboard Window:** The main UI for creating cards, viewing stats, and configuring settings.
    - **Overlay Window:** The transparent, always-on-top window that appears during an affirmation session.

### 3.2. Data Model (The "Affirmation Deck")

Instead of a simple array of strings, we treat every affirmation as a **Card**.

```typescript
interface AffirmationCard {
  id: string;
  content: {
    text: string;
    image?: string; // Path to local image
    audio?: string; // Path to local audio
  };
  tags: string[];

  // Spaced Repetition Data (Anki-style)
  srs: {
    interval: number; // Days until next show
    easeFactor: number; // Multiplier (e.g., 2.5)
    dueDate: number; // Timestamp
    repetitions: number;
  };

  // Relationships
  references: string[]; // IDs of other cards this one links to
}
```

---

## 4. The "Interruption Engine" (Main Process)

The core value proposition is the **smart interruption**. This logic resides in the Main Process to ensure it runs even when the window is closed.

### 4.1. The Tick Loop

Implement a `setInterval` loop (e.g., every 1 second) in the Main Process.
**Logic per tick:**

1.  **Check Active State:** Is the user currently in a "Break/Affirmation" session? If yes, do nothing.
2.  **Check Idle State:** Use `electron.powerMonitor.getSystemIdleTime()`.
    - If `idleTime > threshold`, pause the internal timer (don't interrupt a user who isn't there).
3.  **Check Schedule:**
    - **Mode A (Timer):** Is `timeSinceLastAffirmation > frequency`?
    - **Mode B (SRS):** Is there a card with `dueDate <= now`?
4.  **Trigger:** If conditions are met, call `triggerAffirmationSession()`.

### 4.2. Window Management

- **Dashboard:** Standard `BrowserWindow`.
- **Overlay (The "Pop-up"):**
  - Create a `BrowserWindow` that is:
    - `transparent: true`
    - `frame: false`
    - `alwaysOnTop: true` (Level: "screen-saver" or "floating")
    - `fullscreen: true` (Optional: or centered modal)
  - **Critical:** Ensure it grabs focus (`win.focus()`) so the user notices it.

---

## 5. The "Emotion Engine" (Renderer Process)

When the Overlay Window opens, do not show the affirmation immediately.

**Step 1: The Check-in**

- Show a beautiful, minimal UI asking: _"How are you feeling?"_
- Options: Emoji grid or Slider (Valence/Arousal).
- **Action:** Save this data point with a timestamp.

**Step 2: The Affirmation**

- Based on the emotion (optional advanced feature) or simply the SRS schedule, display the **Card**.
- Play audio if attached.
- Show text/image.

**Step 3: The Feedback (The "Anki" part)**

- User reads/internalizes the message.
- User clicks a button indicating how much they needed this:
  - _"Again"_ (I didn't believe it / forgot it) -> Reset Interval.
  - _"Good"_ (Resonated) -> Multiply Interval by Ease Factor.
  - _"Easy"_ (I know this) -> Increase Ease Factor.

---

## 6. Migration Steps (From "BreakTimer" Fork)

If you are looking at the `breaktimer-app` codebase as a reference, here is how to translate the concepts:

| BreakTimer Concept                  | MindfulPulse Equivalent                           | Implementation Note                                                                          |
| :---------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------- |
| `app/main/lib/breaks.ts`            | `src/main/scheduler.ts`                           | Rewrite `tick()` to check SRS database instead of simple timer.                              |
| `app/main/lib/windows.ts`           | `src/main/windowManager.ts`                       | Keep the "Overlay" window logic (transparent, always-on-top) but change the URL it loads.    |
| `app/renderer/components/break.tsx` | `src/renderer/components/Session/SessionFlow.tsx` | Replace the "Time Remaining" progress bar with the [Emotion Check -> Card -> Feedback] flow. |
| `Settings` (JSON)                   | `Database` (SQLite/JSON)                          | Move from a flat settings file to a structured database of Cards.                            |

## 7. Next Steps for AI Agent

1.  Initialize a new project using `npm create vite@latest my-app -- --template react-ts`.
2.  Install Electron and configure the build pipeline (or use a template like `electron-vite-react`).
3.  Implement the **Main Process** skeleton (Window creation).
4.  Implement the **Scheduler** (The `tick` loop).
5.  Build the **Card Editor** in the Dashboard.
