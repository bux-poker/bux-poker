import { useState, useEffect } from 'react';

/**
 * Detects if the app is running in PWA/standalone mode (opened from home screen icon).
 * When true, the "Add to Home Screen" prompt should be hidden.
 */
export function useIsStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  });

  useEffect(() => {
    const check = () => {
      setIsStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    };
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', check);
    return () => mq.removeEventListener('change', check);
  }, []);

  return isStandalone;
}
