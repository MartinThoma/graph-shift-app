import { useEffect, type RefObject } from "react";

/** Close a popover on outside pointer-down or Escape; `toggleSelector` marks its own toggle button. */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, toggleSelector: string): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element;
      if (ref.current?.contains(target) || target.closest?.(toggleSelector)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, onClose, toggleSelector]);
}
