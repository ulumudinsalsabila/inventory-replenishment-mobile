import { useWindowDimensions } from 'react-native';

/** Width (dp) from which the app switches to the tablet layout: sidebar navigation and split views. */
export const TABLET_BREAKPOINT = 768;
/** Smallest screen side (dp) of a tablet; keeps rotated phones on the phone layout. */
export const TABLET_SHORT_SIDE = 600;
/** Content width cap for list and form screens on wide screens, so rows and inputs stay readable. */
export const CONTENT_MAX_WIDTH = 920;

export function useResponsive() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT && Math.min(width, height) >= TABLET_SHORT_SIDE;
  return {
    width,
    height,
    isTablet,
    /** Number of grid columns that fit `available` width with cards at least `minCardWidth` wide. */
    columns: (available: number, minCardWidth: number, max = 6) => Math.max(2, Math.min(max, Math.floor(available / minCardWidth))),
  };
}
