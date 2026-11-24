import { useEffect, useRef, useState } from "react";

interface AddNodePopoverProps {
  suggestedId: string;
  /** Returns an error message, or null on success. */
  onSubmit: (id: string, label: string) => string | null;
  onClose: () => void;
}

/** Small anchored form for adding a node with an ID and optional label. */
export function AddNodePopover({ suggestedId, onSubmit, onClose }: AddNodePopoverProps) {
  const [id, setId] = useState(suggestedId);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLFormElement>(null);
  const idRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    idRef.current?.select();
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as Element).closest?.("[aria-haspopup='dialog']")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <form
      ref={rootRef}
      className="popover"
      role="dialog"
      aria-label="Add node"
      onSubmit={(e) => {
        e.preventDefault();
        setError(onSubmit(id.trim(), label.trim()));
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <label>
        <span>ID</span>
        <input ref={idRef} value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!error} />
      </label>
      <label>
        <span>
          Label <em>optional</em>
        </span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={id || "Shown inside the node"} autoComplete="off" />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="form-hint">Added to the DOT source. With hand-placed nodes it lands in free space near the view center.</p>
      <div className="popover-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Add node
        </button>
      </div>
    </form>
  );
}
