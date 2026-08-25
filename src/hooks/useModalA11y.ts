"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Baseline modal accessibility, attached to the dialog's outer container:
 * - Moves focus into the dialog (first focusable element) when it opens.
 * - Traps Tab/Shift+Tab so focus cycles within the dialog while open.
 * - Escape calls `onClose`.
 * - Restores focus to whatever was focused before the dialog opened, once
 *   it closes — so keyboard/screen-reader users land back where they were,
 *   not at the top of the page.
 *
 * `open` defaults to true for modals that are only ever mounted while
 * open (e.g. conditionally rendered by the parent, like
 * KeywordDetailModal) — for a modal that stays mounted and toggles via a
 * prop (like AuthModal), pass its `open` state explicitly.
 */
export function useModalA11y(onClose: () => void, open = true) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = ref.current;
    const focusable = container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable?.[0] ?? container)?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return ref;
}
