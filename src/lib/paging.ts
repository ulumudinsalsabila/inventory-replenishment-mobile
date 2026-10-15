type PageResult<T> = { data: T[]; meta?: { totalPages?: number } };

/**
 * Loads every page of a paginated list endpoint (100 rows per request), like the web's
 * `apiRequestAllPages`. `path` must already contain its query string without `page`/`perPage`.
 */
export async function fetchAllPages<T>(request: <R>(path: string) => Promise<R>, path: string, maxPages = 50): Promise<{ data: T[] }> {
  const separator = path.includes('?') ? '&' : '?';
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await request<PageResult<T>>(`${path}${separator}page=${page}&perPage=100`);
    rows.push(...result.data);
    if (page >= (result.meta?.totalPages ?? 1) || result.data.length < 100) break;
  }
  return { data: rows };
}
