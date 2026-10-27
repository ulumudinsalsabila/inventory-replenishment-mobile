import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useOnRefocus } from './use-refocus';

/** Rows per request for lazily loaded mobile lists. */
export const LIST_PAGE_SIZE = 10;

type PageResult<T> = { data: T[]; meta?: { total?: number; totalPages?: number } };

/**
 * Pages are fetched by offset, so rows created meanwhile shift the next page and repeat rows already shown;
 * those repeats are dropped by id (rows without an id are kept as they come).
 */
function appendUnique<T>(current: T[], next: T[]) {
  const idOf = (row: T) => (row as { id?: unknown }).id;
  const seen = new Set(current.map(idOf).filter((id) => id !== undefined));
  return [...current, ...next.filter((row) => { const id = idOf(row); return id === undefined || !seen.has(id); })];
}

/**
 * Loads a paginated list endpoint `pageSize` rows at a time and appends the next page on demand.
 * `path` is the endpoint with its filters but without `page`/`perPage`; changing it restarts from
 * the first page, and `null` clears the list (for example while a required filter is missing).
 */
export function useInfiniteList<T>(request: <R>(path: string) => Promise<R>, path: string | null, pageSize = LIST_PAGE_SIZE) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(Boolean(path));
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  // The path whose first page is currently shown; differs from `path` until a new filter has loaded.
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  // `generation` discards responses that belong to a previous path or an older reload.
  const state = useRef({ page: 0, busy: false, generation: 0 });

  const fetchPage = useCallback(async (page: number, mode: 'reset' | 'more' | 'refresh' | 'silent') => {
    if (!path) return;
    const generation = mode === 'more' ? state.current.generation : state.current.generation + 1;
    state.current.generation = generation;
    state.current.busy = true;
    if (mode === 'reset') setLoading(true);
    else if (mode === 'more') setLoadingMore(true);
    else if (mode === 'refresh') setRefreshing(true);
    try {
      const separator = path.includes('?') ? '&' : '?';
      const result = await request<PageResult<T>>(`${path}${separator}page=${page}&perPage=${pageSize}`);
      if (generation !== state.current.generation) return;
      state.current.page = page;
      setLoadedPath(path);
      setItems((current) => page === 1 ? result.data : appendUnique(current, result.data));
      setTotal(result.meta?.total ?? (page - 1) * pageSize + result.data.length);
      setHasMore(result.meta?.totalPages !== undefined ? page < result.meta.totalPages : result.data.length === pageSize);
      setError('');
    } catch (cause) {
      if (generation === state.current.generation) {
        setError(cause instanceof Error ? cause.message : 'Data belum dapat dimuat.');
        if (page === 1) setLoadedPath(path);
      }
    } finally {
      if (generation === state.current.generation) {
        state.current.busy = false;
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  }, [path, pageSize, request]);

  useEffect(() => {
    state.current.page = 0;
    if (!path) {
      state.current.generation += 1;
      state.current.busy = false;
      const clear = setTimeout(() => { setItems([]); setTotal(0); setHasMore(false); setLoading(false); setError(''); setLoadedPath(null); }, 0);
      return () => clearTimeout(clear);
    }
    const initial = setTimeout(() => void fetchPage(1, 'reset'), 0);
    return () => clearTimeout(initial);
  }, [fetchPage, path]);

  const loadMore = useCallback(() => {
    if (!hasMore || state.current.busy) return;
    void fetchPage(state.current.page + 1, 'more');
  }, [fetchPage, hasMore]);

  /** Pull-to-refresh: reloads the first page while keeping the current rows visible. */
  const refresh = useCallback(() => fetchPage(1, 'refresh'), [fetchPage]);
  /** Reloads the first page with the full-screen loader, for example after saving a record. */
  const reload = useCallback(() => fetchPage(1, 'reset'), [fetchPage]);

  // Coming back to the screen (tab switch or returning from a detail route) quietly reloads the first page.
  useOnRefocus(() => { if (path && loadedPath === path) void fetchPage(1, 'silent'); });

  // Report loading as soon as the filters change, so screens never flash an empty state in between.
  const pending = path !== null && loadedPath !== path;
  return { items, setItems, total, hasMore, loading: loading || pending, loadingMore, refreshing, error, loadMore, refresh, reload };
}

/**
 * Scroll props that call `loadMore` when the user nears the end of a ScrollView, and also when the
 * first page is too short to scroll at all (tablets), so the list keeps filling the screen.
 */
export function useLoadMoreOnScroll(loadMore: () => void, threshold = 320) {
  const viewport = useRef(0);
  return {
    scrollEventThrottle: 100,
    onLayout: (event: LayoutChangeEvent) => { viewport.current = event.nativeEvent.layout.height; },
    onContentSizeChange: (_width: number, height: number) => { if (viewport.current && height <= viewport.current + threshold) loadMore(); },
    onScroll: ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - threshold) loadMore();
    },
  };
}

/** Returns `value` once it has stopped changing for `delay` ms, for search-as-you-type fields. */
export function useDebouncedValue<T>(value: T, delay = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}
