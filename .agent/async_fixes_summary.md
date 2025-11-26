# Async State Update Fixes

This document summarizes the changes made to prevent asynchronous state updates on unmounted components.

## Problem

Async operations (like IPC calls or file reads) can complete after a component has unmounted. If the callback attempts to update the component's state (e.g., via `useState` setters or `toast`), React will issue a warning, and it can lead to memory leaks or unexpected behavior.

## Solution

We implemented the `isMounted` pattern in several components. This involves:

1.  Creating a `useRef(false)` named `isMounted`.
2.  Using a `useEffect` to set `isMounted.current = true` on mount and `false` on unmount.
3.  Checking `if (!isMounted.current) return;` before any state update following an `await` keyword.

## Modified Files

### 1. `app/renderer/components/settings/theme-card.tsx`

- **Function:** `handleBackgroundImageChange`
- **Changes:** Added `isMounted` check before `onValueChange` and `setIsProcessingImage(false)`.

### 2. `app/renderer/components/settings.tsx`

- **Function:** `handleSave`
- **Changes:** Added `isMounted` check before `setSettingsDraft`, `setSettings`, and `toast`.

### 3. `app/renderer/components/settings/messages-card.tsx`

- **Function:** `handlePaste`
- **Changes:** Added `isMounted` check before `onChange` and `setIsProcessingPaste(false)`.

### 4. `app/renderer/components/break.tsx`

- **Functions:** `init`, `handlePostponeBreak`, `handleSkipBreak`, `handleNextBreakMessage`, `handlePreviousBreakMessage`.
- **Changes:** Added `isMounted` checks before state updates in these async functions.

### 5. `app/renderer/components/break/break-progress.tsx`

- **Functions:** `handlePauseToggle`, `resolveBreakTiming` (inside `useEffect`).
- **Changes:** Added `isMounted` checks before state updates in `handlePauseToggle` and the async IIFE within `useEffect`.

## Verification

- Code review confirmed that all identified async state updates are now guarded.
- `npm run build` passed successfully.
