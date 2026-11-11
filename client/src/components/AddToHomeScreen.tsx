import { useState, useEffect } from 'react';
import { useIsStandalone } from '../hooks/useIsStandalone';
import { BuxModal } from './ui/BuxModal';

/** Detect iOS (Safari on iPhone/iPad) */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Detect Android */
function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent);
}

interface AddToHomeScreenProps {
  /** Optional custom class for the button */
  className?: string;
  /** Compact style for inline/header use */
  compact?: boolean;
}

export function AddToHomeScreen({ className = '', compact = false }: AddToHomeScreenProps) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const isStandalone = useIsStandalone();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Don't show if already in standalone mode (opened from home screen) or on desktop
  if (isStandalone || !isMobile) return null;

  const ios = isIOS();
  const android = isAndroid();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`bux-btn-ghost inline-flex items-center gap-2 px-3 py-2 text-sm ${compact ? 'px-2 py-1.5 text-xs' : ''} ${className}`}
        aria-label="Add to Home Screen for full screen play"
      >
        <svg className={compact ? 'h-4 w-4' : 'h-5 w-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {!compact && <span>Add to Home Screen</span>}
      </button>

      <BuxModal
        open={open}
        title="Full Screen Play"
        icon="home"
        position="fixed"
        maxWidth="md"
        align="left"
        onClose={() => setOpen(false)}
        zIndexClass="z-[100]"
      >
        <p className="mb-4 text-sm text-slate-300">
          Add BUX Poker to your home screen for full screen gameplay without the browser bar.
        </p>

        {ios && (
          <ol className="space-y-3 text-sm text-slate-200">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">1</span>
              <span>Tap the <strong>Share</strong> button <span className="text-slate-400">(square with arrow pointing up)</span> at the bottom of Safari</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">2</span>
              <span>Scroll down and tap <strong>Add to Home Screen</strong></span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">3</span>
              <span>Tap <strong>Add</strong> in the top right, then open BUX Poker from your home screen</span>
            </li>
          </ol>
        )}

        {android && (
          <ol className="space-y-3 text-sm text-slate-200">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">1</span>
              <span>Tap the <strong>menu</strong> button <span className="text-slate-400">(three dots)</span> in your browser</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">2</span>
              <span>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong></span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 font-semibold text-emerald-300">3</span>
              <span>Confirm and open BUX Poker from your home screen or app drawer</span>
            </li>
          </ol>
        )}

        {!ios && !android && (
          <p className="text-sm text-slate-400">
            In your mobile browser, look for <strong>Add to Home screen</strong> or <strong>Install</strong> in the menu to add this app for full screen play.
          </p>
        )}
      </BuxModal>
    </>
  );
}
