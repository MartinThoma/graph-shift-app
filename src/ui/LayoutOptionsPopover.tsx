import { useEffect, useRef } from "react";

interface LayoutOptionsPopoverProps {
  groupIsolated: boolean;
  isolatedCount: number;
  onChangeGroupIsolated: (value: boolean) => void;
  onClose: () => void;
}

/** Options that apply to the whole-graph layout. */
export function LayoutOptionsPopover({ groupIsolated, isolatedCount, onChangeGroupIsolated, onClose }: LayoutOptionsPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.querySelector("input")?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Element;
      if (rootRef.current?.contains(target) || target.closest?.("[data-layout-options-toggle]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="popover layout-options"
      role="dialog"
      aria-label="Layout options"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="check">
        <input type="checkbox" checked={groupIsolated} onChange={(e) => onChangeGroupIsolated(e.target.checked)} />
        <span>Collect unconnected nodes in a grid</span>
      </label>
      <p className="form-hint">
        Nodes without edges to other nodes are laid out as a separate grid that completes the graph's rectangle.{" "}
        {isolatedCount === 0
          ? "This graph has none right now."
          : `This graph has ${isolatedCount} ${isolatedCount === 1 ? "such node" : "such nodes"}.`}
      </p>
      <p className="form-hint">To lay out only some nodes, select them and use Arrange in the panel on the right.</p>
    </div>
  );
}
