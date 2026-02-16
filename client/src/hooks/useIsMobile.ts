import { useState, useEffect } from 'react';

const MOBILE_UA =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints != null && navigator.maxTouchPoints > 0)
  );
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return MOBILE_UA.test(navigator.userAgent);
}

/**
 * True when the user is on a mobile device (phone/tablet) so we show:
 * - CSS text cards instead of PNGs
 * - Collapsible chat
 * Uses: touch capability, mobile user agent, or viewport ≤1024px so that
 * large phones and tablets get the mobile experience.
 */
export function useIsMobile(): boolean {
  const touchOrUa =
    typeof window !== 'undefined' && (isTouchDevice() || isMobileUserAgent());
  const [width, setWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : 1200)
  );

  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return touchOrUa || width <= 1024;
}
