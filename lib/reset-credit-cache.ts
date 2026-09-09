import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { withRetry } from "./fs-retry.js";
import { logWarn } from "./logger.js";
import { getCodexMultiAuthDir } from "./runtime-paths.js";
import { tempPathFor } from "./temp-path.js";
import { isRecord } from "./utils.js";

interface ResetCreditEntry {
  availableCount: number;
  observedAt: number;
  lastSeenAt: number;
}

interface ResetCreditCache {
  version: 1;
  byIdentityHash: Record<string, ResetCreditEntry>;
}

interface QuotaEntryLike {
  updatedAt: number;
  rateLimitResetCredits?: { availableCount: number };
}

interface QuotaCacheLike {
  byAccountId: Record<string, QuotaEntryLike>;
  byEmail: Record<string, QuotaEntryLike>;
}

const RESET_CREDIT_CACHE_PATH = join(
  getCodexMultiAuthDir(),
  "reset-credit-summary-cache.json",
);
const RESET_CREDIT_CACHE_LABEL = basename(RESET_CREDIT_CACHE_PATH);
const RESET_CREDIT_LOCK_PATH = `${RESET_CREDIT_CACHE_PATH}.lock`;
const LOCK_WAIT_MS = 5_000;
const RETAIN_ABSENT_IDENTITY_MS = 30 * 24 * 60 * 60 * 1_000;

function emptyCache(): ResetCreditCache {
  return { version: 1, byIdentityHash: {} };
}

function identityHash(namespace: "account" | "email", key: string): string {
  return createHash("sha256").update(`${namespace}\0${key}`).digest("hex");
}

function normalizeEntry(value: unknown): ResetCreditEntry | null {
  if (!isRecord(value)) return null;
  const { availableCount, observedAt } = value;
  const lastSeenAt = value.lastSeenAt ?? observedAt;
  if (
    typeof availableCount !== "number" ||
    !Number.isSafeInteger(availableCount) ||
    availableCount < 0 ||
    typeof observedAt !== "number" ||
    !Number.isFinite(observedAt) ||
    observedAt <= 0 ||
    typeof lastSeenAt !== "number" ||
    !Number.isFinite(lastSeenAt) ||
    lastSeenAt <= 0
  ) {
    return null;
  }
  return { availableCount, observedAt, lastSeenAt };
}

function normalizeMap(value: unknown): Record<string, ResetCreditEntry> {
  if (!isRecord(value)) return {};
  const normalized: Record<string, ResetCreditEntry> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[0-9a-f]{64}$/.test(key)) continue;
    const entry = normalizeEntry(raw);
    if (entry) normalized[key] = entry;
  }
  return normalized;
}

async function loadResetCreditCache(): Promise<ResetCreditCache> {
  if (!existsSync(RESET_CREDIT_CACHE_PATH)) return emptyCache();
  try {
    const content = await withRetry(
      () => fs.readFile(RESET_CREDIT_CACHE_PATH, "utf8"),
      {
        maxAttempts: 5,
        backoffMs: (attempt) => 10 * 2 ** (attempt - 1),
      },
    );
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) return emptyCache();
    return {
      version: 1,
      byIdentityHash: normalizeMap(parsed.byIdentityHash),
    };
  } catch (error) {
    logWarn(
      `Failed to load ${RESET_CREDIT_CACHE_LABEL}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return emptyCache();
  }
}

function hydrateMap(
  namespace: "account" | "email",
  target: Record<string, QuotaEntryLike>,
  source: Record<string, ResetCreditEntry>,
): void {
  for (const [key, entry] of Object.entries(target)) {
    if (entry.rateLimitResetCredits) continue;
    const retained = source[identityHash(namespace, key)];
    if (retained) {
      entry.rateLimitResetCredits = {
        availableCount: retained.availableCount,
      };
    }
  }
}

function reconcileMap(
  namespace: "account" | "email",
  source: Record<string, QuotaEntryLike>,
  previous: Record<string, ResetCreditEntry>,
  next: Record<string, ResetCreditEntry>,
  now: number,
): void {
  for (const [key, entry] of Object.entries(source)) {
    const hash = identityHash(namespace, key);
    const availableCount = entry.rateLimitResetCredits?.availableCount;
    if (availableCount !== undefined) {
      const retained = previous[hash];
      next[hash] =
        retained && retained.observedAt > entry.updatedAt
          ? { ...retained, lastSeenAt: now }
          : { availableCount, observedAt: entry.updatedAt, lastSeenAt: now };
    } else if (previous[hash]) {
      next[hash] = { ...previous[hash], lastSeenAt: now };
    }
  }
}

interface LockHandle {
  handle: Awaited<ReturnType<typeof fs.open>>;
}

async function releaseLock(lock: LockHandle): Promise<void> {
  await lock.handle.close().catch(() => undefined);
  await fs.rm(RESET_CREDIT_LOCK_PATH, { force: true }).catch(() => undefined);
}

async function acquireLock(): Promise<LockHandle> {
  const started = Date.now();
  while (true) {
    try {
      const handle = await fs.open(RESET_CREDIT_LOCK_PATH, "wx", 0o600);
      try {
        await handle.writeFile(`${process.pid}\n`, "utf8");
        return { handle };
      } catch (error) {
        await handle.close().catch(() => undefined);
        await fs
          .rm(RESET_CREDIT_LOCK_PATH, { force: true })
          .catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (Date.now() - started >= LOCK_WAIT_MS) {
      throw new Error(
        `timed out waiting for ${basename(RESET_CREDIT_LOCK_PATH)}`,
      );
    }
    await sleep(25);
  }
}

export async function hydrateRetainedResetCredits<T extends QuotaCacheLike>(
  cache: T,
): Promise<T> {
  const retained = await loadResetCreditCache();
  hydrateMap("account", cache.byAccountId, retained.byIdentityHash);
  hydrateMap("email", cache.byEmail, retained.byIdentityHash);
  return cache;
}

export async function preserveKnownResetCredits(
  cache: QuotaCacheLike,
): Promise<void> {
  let lock: LockHandle | null = null;
  try {
    const cacheDir = getCodexMultiAuthDir();
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      try {
        await fs.chmod(cacheDir, 0o700);
      } catch {
        // Best-effort directory hardening; the file remains owner-only on POSIX.
      }
    }
    lock = await acquireLock();
    const previous = await loadResetCreditCache();
    const next = emptyCache();
    const now = Date.now();
    for (const [hash, entry] of Object.entries(previous.byIdentityHash)) {
      if (now - entry.lastSeenAt <= RETAIN_ABSENT_IDENTITY_MS) {
        next.byIdentityHash[hash] = entry;
      }
    }
    reconcileMap(
      "account",
      cache.byAccountId,
      previous.byIdentityHash,
      next.byIdentityHash,
      now,
    );
    reconcileMap(
      "email",
      cache.byEmail,
      previous.byIdentityHash,
      next.byIdentityHash,
      now,
    );
    const tempPath = tempPathFor(RESET_CREDIT_CACHE_PATH);
    await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await withRetry(() => fs.rename(tempPath, RESET_CREDIT_CACHE_PATH), {
        maxAttempts: 5,
        backoffMs: (attempt) => 10 * 2 ** (attempt - 1),
      });
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    logWarn(
      `Failed to save ${RESET_CREDIT_CACHE_LABEL}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    if (lock) await releaseLock(lock);
  }
}
