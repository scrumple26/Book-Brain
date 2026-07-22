/**
 * Read a JSON API response without assuming it is JSON.
 *
 * When a serverless function crashes or times out, the platform returns its own
 * HTML/text error page. Calling res.json() on that throws a SyntaxError, so the
 * user sees "Unexpected token 'A'..." instead of what actually happened — the
 * real failure gets replaced by a parser complaint about it.
 */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

export async function readJson<T>(res: Response): Promise<ApiResult<T>> {
  const text = await res.text().catch(() => "");

  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    // Not JSON — a platform error page, a proxy timeout, or an empty body.
    const snippet = text.trim().replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").slice(0, 140);
    return {
      ok: false,
      status: res.status,
      data: null,
      error: snippet
        ? `Server error (${res.status}): ${snippet}`
        : `Server error (${res.status}) with no response body.`,
    };
  }

  if (!res.ok) {
    const message =
      (data as { error?: unknown } | null)?.error;
    return {
      ok: false,
      status: res.status,
      data,
      error: typeof message === "string" ? message : `Request failed (${res.status})`,
    };
  }

  return { ok: true, status: res.status, data, error: null };
}
