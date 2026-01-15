// Scale utility functions for GameTable component
// These functions handle responsive scaling calculations

export interface WindowSize {
  width: number;
  height: number;
  isMobile: boolean;
}

/**
 * Check if screen is mobile
 */
export const isMobileScreen = (windowSize: WindowSize): boolean => {
  return windowSize.width < 640;
};

/**
 * Calculate base scale factor
 */
export const calculateBaseScale = (windowSize: WindowSize): number => {
  const referenceWidth = 1200; // Reference width for desktop
  return Math.min(1, windowSize.width / referenceWidth);
};

/**
 * Apply minimum scale constraint
 */
export const applyMinimumScale = (scale: number): number => {
  return Math.max(0.6, scale);
};

/**
 * Get scale factor for responsive design
 */
export const getScaleFactor = (windowSize: WindowSize): number => {
  const width = windowSize.width;
  
  // Screens 600-650px wide: make buttons smaller
  if (width >= 600 && width <= 650) {
    return 0.7;
  }
  
  // Scale down for screens under 768px
  if (width < 768) {
    return Math.max(0.5, width / 768);
  }
  
  // Don't scale on mobile (under 640px)
  if (isMobileScreen(windowSize)) return 1;
  
  const baseScale = calculateBaseScale(windowSize);
  return applyMinimumScale(baseScale);
};
