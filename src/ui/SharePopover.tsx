import { useEffect, useRef, useState } from "react";
import { createShareLink, MAX_SHARE_URL_LENGTH, type SharedDocument, type ShareLinkResult } from "../share/shareLink";
import { useDismiss } from "./useDismiss";

interface SharePopoverProps {
  doc: SharedDocument;
  onClose: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Builds a share link that contains the whole graph and offers to copy it. */
export function SharePopover({ doc, onClose }: SharePopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ShareLinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "dot" | null>(null);
  useDismiss(rootRef, onClose, "[data-share-toggle]");

  useEffect(() => {
    let cancelled = false;
    createShareLink(doc, window.location.href)
      .then((r) => !cancelled && setResult(r))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [doc]);

  useEffect(() => {
    if (result?.ok) inputRef.current?.select();
  }, [result]);

  const handleCopy = async (kind: "link" | "dot", text: string): Promise<void> => {
    if (await copyText(text)) setCopied(kind);
    else if (kind === "link") inputRef.current?.select();
  };

  const hasHand = !!doc.manualNodes?.length;
  return (
    <div ref={rootRef} className="popover align-right share-popover" role="dialog" aria-label="Share link">
      <h2>Share this graph</h2>
      {!result && !error && <p className="form-hint">Compressing…</p>}
      {error && (
        <p className="form-error" role="alert">
          Could not create a link: {error}
        </p>
      )}
      {result?.ok && (
        <>
          <input ref={inputRef} className="share-url" readOnly value={result.url} aria-label="Share link" onFocus={(e) => e.target.select()} />
          <div className="popover-actions">
            <span className="share-copied" role="status">
              {copied === "link" ? "Link copied" : ""}
            </span>
            <button type="button" className="btn primary" onClick={() => void handleCopy("link", result.url)}>
              Copy link
            </button>
          </div>
          <p className="form-hint">
            The whole graph is stored in the link itself, compressed ({result.length.toLocaleString("en")} characters). Nothing is uploaded.
            {result.withPositions && " Your hand-placed positions are included."}
            {!result.withPositions && hasHand && " With your hand-placed positions the link would be too long, so the recipient gets a fresh layout."}
          </p>
        </>
      )}
      {result && !result.ok && (
        <>
          <input className="share-url" readOnly disabled value="" placeholder="Too big for a link" aria-label="Share link" />
          <p className="share-info" role="note">
            This graph is too big for a share link: it needs about {result.length.toLocaleString("en")} characters, and links are limited to{" "}
            {MAX_SHARE_URL_LENGTH.toLocaleString("en")}. Share the DOT text or the downloaded SVG instead.
          </p>
          <div className="popover-actions">
            <span className="share-copied" role="status">
              {copied === "dot" ? "DOT copied" : ""}
            </span>
            <button type="button" className="btn" onClick={() => void handleCopy("dot", doc.dot)}>
              Copy DOT text
            </button>
            <button type="button" className="btn primary" disabled>
              Copy link
            </button>
          </div>
        </>
      )}
    </div>
  );
}
