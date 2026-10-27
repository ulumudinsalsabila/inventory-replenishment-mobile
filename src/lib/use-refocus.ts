import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Calls `callback` every time the screen regains focus, but not on the first focus (the screen's
 * own mount effect already loads it). Tab screens stay mounted, so without this their data only
 * refreshes on pull-to-refresh.
 */
export function useOnRefocus(callback: () => void) {
  const latest = useRef(callback);
  useEffect(() => { latest.current = callback; }, [callback]);
  const focusedBefore = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedBefore.current) latest.current();
    focusedBefore.current = true;
  }, []));
}
