/**
 * Stage keyboard (U13): 1/2/3 modes (in the bar's visual order Widgets | HTML | A2UI), D decision model,
 * Esc clears the thread. Space belongs to the voice lane; this file only keeps Space away from focused controls.
 */
import { useEffect } from "react";
import type { Mode } from "@shared/protocol";

export type Shortcut = { type: "mode"; mode: Mode } | { type: "decision" } | { type: "clear" };
export type KeyInfo = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat">;

/** Visual order of the segmented control, not the order of MODES. */
export const MODE_KEYS: Readonly<Record<Mode, string>> = { widgets: "1", html: "2", a2ui: "3" };
const KEY_TO_MODE: Readonly<Record<string, Mode>> = { "1": "widgets", "2": "html", "3": "a2ui" };

export function matchShortcut(e: KeyInfo): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (e.key === "Escape") return { type: "clear" };
  // Holding a key must not flip the decision switch back and forth.
  if (e.repeat) return null;
  const mode = KEY_TO_MODE[e.key];
  if (mode) return { type: "mode", mode };
  if (e.key === "d" || e.key === "D") return { type: "decision" };
  return null;
}

/** Input types you type text into. A range (Slider thumb), checkbox or button is not one of them. */
const TYPING_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "time",
  "datetime-local",
]);

/**
 * True only for editable text entry: a textarea, contenteditable, or a text-like <input> that is neither
 * read-only nor disabled. Shared with the voice lane, so a tapped Slider or read-only field never leaves
 * shortcuts and push-to-talk dead until focus moves.
 */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.tagName === "TEXTAREA") {
    const t = el as HTMLTextAreaElement;
    return !t.readOnly && !t.disabled;
  }
  if (el.tagName === "INPUT") {
    const i = el as HTMLInputElement;
    return TYPING_INPUT_TYPES.has((i.type || "text").toLowerCase()) && !i.readOnly && !i.disabled;
  }
  return false;
}

function asElement(t: EventTarget | null): Element | null {
  return typeof Element !== "undefined" && t instanceof Element ? t : null;
}

/** A focused element inside the app (button, chip, switch, tab, slider thumb) that Space would otherwise activate. */
function isFocusedControl(el: Element | null): boolean {
  return el !== null && el.closest("#root") !== null;
}

/**
 * Space is push-to-talk everywhere. Base UI composite items (toggle-group chips, the mode switch) click on
 * Space keydown even when the default is prevented, so a chip tapped a moment ago would toggle the instant
 * the speaker starts talking. Stop the real event before React sees it and hand an untargeted copy to the
 * window listeners (the voice lane) instead.
 */
function shieldSpace(e: KeyboardEvent): void {
  if (e.code !== "Space" || !e.isTrusted) return;
  const el = asElement(e.target);
  if (isTypingTarget(el) || !isFocusedControl(el)) return;
  e.preventDefault();
  e.stopPropagation();
  window.dispatchEvent(
    new KeyboardEvent(e.type, {
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/** Installs the stage shortcuts. Pass a stable (module-level) handler. */
export function useKeyboardShortcuts(onShortcut: (s: Shortcut) => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const el = asElement(e.target);
      if (isTypingTarget(el)) {
        // Esc leaves the text field so the next key is a shortcut again (mouse-free use).
        if (e.key === "Escape" && el instanceof HTMLElement) el.blur();
        return;
      }
      const s = matchShortcut(e);
      if (!s) return;
      e.preventDefault();
      onShortcut(s);
    };
    window.addEventListener("keydown", shieldSpace, { capture: true });
    window.addEventListener("keyup", shieldSpace, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", shieldSpace, { capture: true });
      window.removeEventListener("keyup", shieldSpace, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onShortcut]);
}
