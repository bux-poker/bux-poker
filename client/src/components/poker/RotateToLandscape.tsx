/**
 * Full-screen gate: the poker table is landscape-only.
 */
export function RotateToLandscape() {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 px-8 text-center"
      style={{ background: "var(--bux-ink, #1e2733)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotate-landscape-title"
    >
      <div
        className="flex h-24 w-24 items-center justify-center rounded-2xl border-2"
        style={{
          borderColor: "color-mix(in srgb, var(--bux-brass, #c4a574) 70%, transparent)",
          background: "color-mix(in srgb, var(--bux-ink-elevated, #2a3544) 90%, transparent)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.45), 0 12px 40px rgba(0,0,0,0.45)",
        }}
        aria-hidden
      >
        <svg
          width="56"
          height="56"
          viewBox="0 0 56 56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="bux-rotate-phone-icon"
        >
          {/* Phone body (portrait) */}
          <rect
            x="18"
            y="8"
            width="20"
            height="36"
            rx="3.5"
            stroke="var(--bux-brass, #c4a574)"
            strokeWidth="2.5"
          />
          <path
            d="M26 12h4"
            stroke="var(--bux-brass, #c4a574)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* Rotate arc */}
          <path
            d="M42 22c3.5 2.5 5.5 6.5 5.5 11 0 7.5-6 13.5-13.5 13.5"
            stroke="var(--bux-accent, #1cb981)"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M38 42l-4 4.5 5.5.5"
            stroke="var(--bux-accent, #1cb981)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
      <div className="max-w-xs space-y-2">
        <h1
          id="rotate-landscape-title"
          className="font-display text-2xl font-bold tracking-tight text-white"
        >
          Rotate your device
        </h1>
        <p className="text-sm leading-relaxed text-slate-400">
          The table only works in landscape. Turn your phone sideways to keep playing.
        </p>
      </div>
      <style>{`
        @keyframes bux-phone-tilt {
          0%, 100% { transform: rotate(0deg); }
          40% { transform: rotate(90deg); }
          60% { transform: rotate(90deg); }
        }
        .bux-rotate-phone-icon {
          animation: bux-phone-tilt 2.4s ease-in-out infinite;
          transform-origin: 50% 55%;
        }
        @media (prefers-reduced-motion: reduce) {
          .bux-rotate-phone-icon { animation: none; }
        }
      `}</style>
    </div>
  );
}
