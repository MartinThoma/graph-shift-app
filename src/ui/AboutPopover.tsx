import { useRef, useState } from "react";
import type { UpdateCheckResult } from "../pwa/autoUpdate";
import { useDismiss } from "./useDismiss";

export const REPOSITORY_URL = "https://github.com/MartinThoma/graph-shift-app";

interface AboutPopoverProps {
  version: string;
  onCheckForUpdates: () => Promise<UpdateCheckResult>;
  onClose: () => void;
}

/** Turn a build version like `20261124T131706Z-abc` into a readable date. */
export function formatBuildDate(version: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(version);
  if (!match) return null;
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]));
  return date.toLocaleString("en", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CHECK_MESSAGES: Record<UpdateCheckResult, string> = {
  update: "A newer version is being downloaded; a Reload button appears when it is ready.",
  current: "You have the latest version.",
  offline: "You are offline; try again when connected.",
  unavailable: "Update checks are not available here (development build or no service worker).",
  error: "Could not reach the server to check for updates.",
};

/** Version information, project links and an update check. */
export function AboutPopover({ version, onCheckForUpdates, onClose }: AboutPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  useDismiss(rootRef, onClose, "[data-about-toggle]");
  const built = formatBuildDate(version);

  return (
    <div ref={rootRef} className="popover align-right about-popover" role="dialog" aria-label="About Graph Shift">
      <h2>Graph Shift</h2>
      <dl className="about-facts">
        <dt>Version</dt>
        <dd>
          <code>{version}</code>
        </dd>
        {built && (
          <>
            <dt>Built</dt>
            <dd>{built}</dd>
          </>
        )}
      </dl>
      <p className="form-hint">Everything runs in your browser. Graphs are saved on this device and never uploaded.</p>
      <p className="about-invite">
        Missing a feature or found a bug?{" "}
        <a href={`${REPOSITORY_URL}/issues/new`} target="_blank" rel="noopener noreferrer">
          Open an issue on GitHub
        </a>
        . Feature requests are welcome.
      </p>
      <div className="popover-actions about-actions">
        <a className="btn" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
          Source on GitHub
        </a>
        <button
          type="button"
          className="btn"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            setCheckResult(await onCheckForUpdates());
            setChecking(false);
          }}
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>
      </div>
      {checkResult && (
        <p className="form-hint" role="status">
          {CHECK_MESSAGES[checkResult]}
        </p>
      )}
    </div>
  );
}
