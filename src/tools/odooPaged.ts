import { authenticate, executeKw } from "../api/odoo";

const PAGE = 500;
const PAUSE_MS = 250;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /429|Too many|rate limit|ECONNRESET|ETIMEDOUT/i.test(msg);
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryable(err) || i === 5) throw err;
      const wait = 1000 * 2 ** i;
      process.stderr.write(`[${label}] retry ${i + 1} in ${wait}ms\n`);
      await sleep(wait);
    }
  }
  throw last;
}

export async function searchReadPaged<T>(
  model: string,
  fields: string[],
  opts: {
    domain?: unknown[];
    activeTest?: boolean;
    label?: string;
    page?: number;
  } = {},
): Promise<T[]> {
  const label = opts.label ?? model;
  const domain = opts.domain ?? [];
  const activeTest = opts.activeTest ?? true;
  const page = opts.page ?? PAGE;
  const out: T[] = [];
  let offset = 0;
  await authenticate();
  for (;;) {
    const batch = await withRetry(label, () =>
      executeKw<T[]>(model, "search_read", [domain], {
        fields,
        limit: page,
        offset,
        context: { lang: "uk_UA", active_test: activeTest },
      }),
    );
    out.push(...batch);
    process.stderr.write(`[${label}] ${model} +${batch.length} (total ${out.length})\n`);
    if (batch.length < page) break;
    offset += page;
    await sleep(PAUSE_MS);
  }
  return out;
}
