import type { ReactNode } from "react";

export type BuxModalTone = "default" | "danger" | "success" | "warning";
export type BuxModalIconName =
  | "eliminated"
  | "trophy"
  | "break"
  | "blinds"
  | "stats"
  | "lobby"
  | "loading"
  | "error"
  | "home"
  | "confirm"
  | "fold"
  | "info"
  | "wifi"
  | "wait"
  | "close";

const TONE_ICON: Record<BuxModalTone, string> = {
  default: "text-[color:var(--bux-brass)]",
  danger: "text-red-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
};

const TONE_TITLE: Record<BuxModalTone, string> = {
  default: "text-slate-100",
  danger: "text-red-300",
  success: "text-emerald-300",
  warning: "text-amber-200",
};

function ModalIcon({ name, className }: { name: BuxModalIconName; className?: string }) {
  const cn = `h-5 w-5 shrink-0 ${className ?? ""}`;
  switch (name) {
    case "eliminated":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M8 8l8 8M16 8l-8 8" />
        </svg>
      );
    case "trophy":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 6H5a2 2 0 002 3M17 6h2a2 2 0 01-2 3" />
        </svg>
      );
    case "break":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 7v5l3 2" />
        </svg>
      );
    case "blinds":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18M7 8c2-2 8-2 10 0M7 16c2 2 8 2 10 0" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "stats":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M4 19V5M10 19V9M16 19v-6M22 19V7" />
        </svg>
      );
    case "lobby":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 10l8-6 8 6v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9z" />
          <path strokeLinecap="round" d="M9 20v-6h6v6" />
        </svg>
      );
    case "loading":
      return (
        <svg className={`${cn} animate-spin`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M12 3a9 9 0 019 9" />
        </svg>
      );
    case "error":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.3 4.3L2.8 17a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z" />
        </svg>
      );
    case "home":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      );
    case "confirm":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 8v5M12 16h.01" />
        </svg>
      );
    case "fold":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="12" height="16" rx="2" />
          <path strokeLinecap="round" d="M9 5V3m6 8h6M18 8l3 3-3 3" />
        </svg>
      );
    case "wifi":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M2 8.5a14 14 0 0120 0M5.5 12a9 9 0 0113 0M9 15.5a4 4 0 016 0" />
          <circle cx="12" cy="19" r="1" fill="currentColor" />
          <path strokeLinecap="round" d="M4 4l16 16" />
        </svg>
      );
    case "wait":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 7v5l3 2" />
        </svg>
      );
    case "close":
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "info":
    default:
      return (
        <svg className={cn} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 11v5M12 8h.01" />
        </svg>
      );
  }
}

type BuxModalProps = {
  open?: boolean;
  title: string;
  icon: BuxModalIconName;
  tone?: BuxModalTone;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** absolute = contained in relative parent (table column); fixed = full viewport */
  position?: "absolute" | "fixed";
  maxWidth?: "sm" | "md" | "lg" | "xl";
  /** Center body text (dialogs) vs left-aligned (forms/lists) */
  align?: "center" | "left";
  zIndexClass?: string;
  className?: string;
};

const MAX_W = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
} as const;

export function BuxModal({
  open = true,
  title,
  icon,
  tone = "default",
  onClose,
  children,
  footer,
  position = "absolute",
  maxWidth = "sm",
  align = "center",
  zIndexClass = "z-[120]",
  className = "",
}: BuxModalProps) {
  if (!open) return null;

  return (
    <div
      className={`${position} inset-0 ${zIndexClass} pointer-events-none flex items-center justify-center p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bux-modal-title"
    >
      <div
        className={`bux-modal pointer-events-auto ${MAX_W[maxWidth]} w-full ${align === "center" ? "text-center" : "text-left"} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`bux-modal-header ${align === "center" ? "justify-center" : ""}`}>
          <span className={`bux-modal-icon ${TONE_ICON[tone]}`} aria-hidden>
            <ModalIcon name={icon} />
          </span>
          <h2 id="bux-modal-title" className={`bux-modal-title ${TONE_TITLE[tone]}`}>
            {title}
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="bux-modal-close"
              aria-label="Close"
            >
              <ModalIcon name="close" className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="bux-modal-body">{children}</div>
        {footer != null && <div className="bux-modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

type BuxBannerProps = {
  title: string;
  icon: BuxModalIconName;
  tone?: BuxModalTone;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function BuxBanner({
  title,
  icon,
  tone = "default",
  children,
  action,
  className = "",
}: BuxBannerProps) {
  return (
    <div className={`bux-banner bux-modal-banner ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`bux-modal-icon mt-0.5 ${TONE_ICON[tone]}`} aria-hidden>
          <ModalIcon name={icon} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${TONE_TITLE[tone]}`}>{title}</p>
          {children != null && <div className="mt-1 text-xs text-slate-400">{children}</div>}
        </div>
        {action != null && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

export function BuxModalButton({
  children,
  onClick,
  variant = "secondary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
}) {
  const variantClass =
    variant === "primary"
      ? "bux-modal-btn bux-modal-btn-primary"
      : variant === "danger"
        ? "bux-modal-btn bux-modal-btn-danger"
        : "bux-modal-btn bux-modal-btn-secondary";
  return (
    <button type={type} onClick={onClick} className={variantClass}>
      {children}
    </button>
  );
}

export { ModalIcon };
