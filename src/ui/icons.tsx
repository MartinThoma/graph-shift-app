/** Authored 16px line icons, one stroke weight, drawn in currentColor. */
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const UndoIcon = () => (
  <Icon>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" />
  </Icon>
);

export const RedoIcon = () => (
  <Icon>
    <path d="M10.5 3.5l3 3-3 3" />
    <path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9" />
  </Icon>
);

export const AddNodeIcon = () => (
  <Icon>
    <rect x="1.5" y="4" width="9" height="7" rx="2" />
    <path d="M13 3v5M10.5 5.5h5" />
  </Icon>
);

export const AddEdgeIcon = () => (
  <Icon>
    <circle cx="3.5" cy="12.5" r="2" />
    <path d="M5 11l6.5-6.5" />
    <path d="M8.5 4.5h3v3" />
    <path d="M13 11v4M11 13h4" />
  </Icon>
);

export const RemoveNodeIcon = () => (
  <Icon>
    <rect x="1.5" y="4" width="9" height="7" rx="2" />
    <path d="M10.8 5.5h4.7" />
  </Icon>
);

export const RemoveEdgeIcon = () => (
  <Icon>
    <circle cx="3.5" cy="12.5" r="2" />
    <path d="M5 11l6.5-6.5" />
    <path d="M10.5 12.5l4 0" />
  </Icon>
);

export const ResetIcon = () => (
  <Icon>
    <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" />
    <path d="M2.5 1.8v3.4h3.4" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M8 2v8.5" />
    <path d="M4.5 7.5 8 11l3.5-3.5" />
    <path d="M2.5 13.5h11" />
  </Icon>
);

export const ZoomInIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

export const ZoomOutIcon = () => (
  <Icon>
    <path d="M3 8h10" />
  </Icon>
);

export const FitIcon = () => (
  <Icon>
    <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
    <rect x="5.5" y="5.5" width="5" height="5" rx="1" />
  </Icon>
);

export const ErrorIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.8v3.8" />
    <path d="M8 11.1v.1" strokeWidth="1.8" />
  </Icon>
);

export const InstallIcon = () => (
  <Icon>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M8 5v5M5.8 8 8 10.2 10.2 8" />
  </Icon>
);

/** The hand-placed mark: a corner tick, same as the one drawn on nodes. */
export const HandTick = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
    <path d="M1.5 9V1.5H9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
  </svg>
);

export const HandIcon = () => (
  <Icon>
    <path d="M5.5 8.5V3.8a1.1 1.1 0 0 1 2.2 0V7.5" />
    <path d="M7.7 7.2V2.9a1.1 1.1 0 0 1 2.2 0v4.3" />
    <path d="M9.9 7.2V3.9a1.1 1.1 0 0 1 2.2 0v5.3c0 2.9-1.9 5.3-4.6 5.3-1.6 0-2.6-.7-3.5-1.9L2.2 9.8a1.1 1.1 0 0 1 1.7-1.4l1.6 1.7" />
  </Icon>
);

export const MarqueeIcon = () => (
  <Icon>
    <path d="M2 4.5V2h2.5M7 2h2M11.5 2H14v2.5M14 7v2M14 11.5V14h-2.5M9 14H7M4.5 14H2v-2.5M2 9V7" />
  </Icon>
);

/** Toggle for highlighting hand-placed nodes: a node with the corner tick. */
export const HandMarkIcon = () => (
  <Icon>
    <rect x="4.5" y="6" width="9.5" height="7" rx="1.8" />
    <path d="M2 6.5V3.5h3" strokeWidth="1.8" strokeLinecap="square" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const OptionsIcon = () => (
  <Icon>
    <path d="M2 4.5h7M12.5 4.5H14M2 11.5h2M7.5 11.5H14" />
    <circle cx="10.8" cy="4.5" r="1.7" />
    <circle cx="5.8" cy="11.5" r="1.7" />
  </Icon>
);
