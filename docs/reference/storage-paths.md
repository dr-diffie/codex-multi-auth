# Storage Paths Reference

Canonical and compatibility paths for account, settings, cache, and logs.

---

## Canonical Root

Default root:

- `~/.codex/multi-auth`

Override root:

- `CODEX_MULTI_AUTH_DIR=<path>`

---

## Canonical Files

| File | Default path |
| --- | --- |
| Unified settings | `~/.codex/multi-auth/settings.json` |
| Unified settings backup | `~/.codex/multi-auth/settings.json.bak` |
| Accounts | `~/.codex/multi-auth/openai-codex-accounts.json` |
| Accounts backup | `~/.codex/multi-auth/openai-codex-accounts.json.bak` |
| Accounts WAL | `~/.codex/multi-auth/openai-codex-accounts.json.wal` |
| Flagged accounts | `~/.codex/multi-auth/openai-codex-flagged-accounts.json` |
| Flagged accounts backup | `~/.codex/multi-auth/openai-codex-flagged-accounts.json.bak` |
| Quota cache | `~/.codex/multi-auth/quota-cache.json` |
| Reset-summary cache | `~/.codex/multi-auth/reset-credit-summary-cache.json` (count and observation time under SHA-256 identity hashes) |
| Reset-summary write lock | `~/.codex/multi-auth/reset-credit-summary-cache.json.lock` (transient; remove manually only after a process was terminated during a write) |
| Runtime observability | `~/.codex/multi-auth/runtime-observability.json` |
| First-run setup marker | `~/.codex/multi-auth/first-run-setup.json` |
| Alternate / legacy plugin config | `~/.codex/multi-auth/config.json` |
| Usage directory | `~/.codex/multi-auth/usage/` |
| Usage ledger | `~/.codex/multi-auth/usage/usage-ledger.jsonl` |
| Usage ledger archives | `~/.codex/multi-auth/usage/usage-ledger.<timestamp>.jsonl` |
| Account policies | `~/.codex/multi-auth/account-policies.json` |
| Routing profiles | `~/.codex/multi-auth/routing-profiles.json` |
| Budget guards | `~/.codex/multi-auth/budget-guards.json` |
| Local bridge client tokens | `~/.codex/multi-auth/local-client-tokens.json` |
| Cross-process refresh leases | `~/.codex/multi-auth/refresh-leases/` |
| Runtime app helper status | `~/.codex/multi-auth/runtime-rotation-app-helper.<pid>.json` |
| Runtime app helper owner metadata | `~/.codex/multi-auth/runtime-rotation-app-helper-owner.<pid>.json` |
| Persistent app bind directory | `~/.codex/multi-auth/app-bind/` |
| Named pool backups | `~/.codex/multi-auth/backups/` |
| Per-project account pools | `~/.codex/multi-auth/projects/<project-key>/openai-codex-accounts.json` |
| Logs | `~/.codex/multi-auth/logs/codex-plugin/` |
| Cache | `~/.codex/multi-auth/cache/` |
| Settings / config save locks | `~/.codex/multi-auth/*.lock` (transient) |
| Reset-intent markers | `~/.codex/multi-auth/*.reset-intent` (excluded from recovery candidates) |
| Codex CLI accounts | `~/.codex/accounts.json` |
| Codex CLI auth | `~/.codex/auth.json` |
| Codex CLI config | `~/.codex/config.toml` |

### First-run setup marker

`first-run-setup.json` lives under the multi-auth root
(`getCodexMultiAuthDir()` / `~/.codex/multi-auth` by default). On the first
manager CLI invocation after install, the package records a one-shot marker and
best-effort self-heals packaged app bind + launcher routing when runtime
rotation is enabled. Concurrent first invocations claim the marker with an
exclusive create so setup runs at most once. Failures are debug-logged and never
block the user command.

The marker carries a `version`. A marker written before the Codex auth-store
step existed (`version: 1`) is migrated in place on the next manager CLI
invocation: only that step is replayed, and app bind / launcher install are
deliberately not rerun so shortcuts the user removed stay removed. The migration
takes no exclusive claim because both the `config.toml` rewrite and the marker
write are idempotent and atomic. An unreadable or truncated marker is treated as
pre-v2 and migrated the same way, rather than re-triggering full setup.

A *failed* auth-store step deliberately leaves the marker pre-v2 so the next
invocation retries it — otherwise one transient Windows `EPERM`/`EBUSY` on a
locked `config.toml` would strand the CLI on keychain mode permanently. This
applies to the initial setup too: if that step fails there, the marker records
the older version and the next run replays only that step. A `skipped` result
does advance the version, since it is the normal outcome both for a config
already pinned to `"file"` and for an explicit
`CODEX_MULTI_AUTH_ENFORCE_CLI_FILE_AUTH_STORE=0` opt-out.

Deleting the marker can re-trigger first-run setup on
the next CLI run.

Ownership note:

- `~/.codex/multi-auth/*` is managed by this project.
- `~/.codex/accounts.json`, `~/.codex/auth.json`, and `~/.codex/config.toml` are managed by official Codex CLI.
- The `codex-multi-auth-codex` wrapper preserves that official CLI file-backed auth layout by forwarding non-auth commands with `-c cli_auth_credentials_store="file"`, unless the caller already set `cli_auth_credentials_store` explicitly.
- That `-c` override only covers processes the wrapper launches. Third-party front-ends (menu-bar apps such as CodexBar, editor extensions) exec the official binary directly and read `~/.codex/config.toml` instead, so a config left on `cli_auth_credentials_store = "keychain"` keeps raising macOS login-keychain "Always Allow" prompts. The *persisted* top-level value is therefore reconciled to `"file"` at three points: first-run setup, wrapper startup before forwarding, and `doctor --fix`.
- Only the top-level assignment is rewritten. A `cli_auth_credentials_store` inside a `[profiles.*]` table is left as authored, and a top-level key is inserted above the first table instead. The rewrite preserves the file's existing line endings (a CRLF `config.toml` stays CRLF) and accepts either TOML string form, so `'file'` is recognized as already-correct and left alone.
- Set `CODEX_MULTI_AUTH_FORCE_FILE_AUTH_STORE=0` to opt out of both the wrapper-injected `-c` override and the wrapper-startup config reconcile, leaving the downstream CLI auth store untouched.
- Set `CODEX_MULTI_AUTH_ENFORCE_CLI_FILE_AUTH_STORE=0` to opt out of every `config.toml` rewrite (first-run, account switch/login sync, and `doctor --fix`) while leaving the per-invocation `-c` override in place.
- Neither the keychain nor the `security` CLI is ever read or written: reading a keychain item would itself raise the prompt this behavior exists to eliminate. Credentials saved by an earlier official `codex login` stay where they are, are no longer read once the store is pinned to `"file"`, and can be removed manually via Keychain Access.
- Runtime rotation may create a temporary shadow `CODEX_HOME` under the operating-system temp directory while a forwarded Codex command is running. The wrapper syncs refreshed official state files back to the original Codex home before cleanup.
- Interactive TUI sessions are the exception: they run against the canonical `CODEX_HOME` and receive the rotation provider through `-c` overrides instead, so session history and SQLite state are read and written in place rather than copied into a shadow and synced back. `config.toml` itself is never rewritten on this path.
- Because interactive sessions share the canonical home, two of them can run concurrently against the same state — the same as running the official CLI twice. No lock is taken: neither session copies or syncs state, so there is nothing to clobber, and serializing them would be a regression against stock behavior. Concurrent-session state retention is covered by a regression test in `test/codex-bin-wrapper.test.ts`.
- When `CODEX_HOME` is set to a non-default directory, multi-auth resolves strictly to `$CODEX_HOME/multi-auth` and does not scan `~/.codex/multi-auth` for existing pools.
- V3 account storage may also carry `pinnedAccountIndex` and `affinityGeneration` for CLI pin / session-affinity invalidation.

Compatibility note:

- This file-store forwarding keeps auth state readable from disk outside interactive terminals, so wrapper forwarding and non-TTY auth flows stay deterministic after the Ink migration.

> **Windows note:** The wrapper keeps the official Codex CLI file-store layout unchanged, so Windows `EPERM`/`EBUSY` retry handling still lives with the downstream CLI writes rather than this wrapper layer. Opting out with `CODEX_MULTI_AUTH_FORCE_FILE_AUTH_STORE=0` stops injecting the file-store override for future wrapper launches, but it does not rewrite or expose previously written CLI auth files beyond the standard `~/.codex/auth.json` and `~/.codex/accounts.json` locations. The wrapper-startup `config.toml` reconcile writes through the same atomic rename with `EPERM`/`EBUSY` retries; if it still fails (locked or read-only config), the failure is swallowed and forwarding proceeds, because the per-invocation `-c` override already protects that run.

Backup metadata:

- `getBackupMetadata()` reports deterministic snapshot lists for the canonical account pool (primary, WAL, `.bak`, `.bak.1`, `.bak.2`, and discovered manual backups) and flagged-account state (primary, `.bak`, `.bak.1`, `.bak.2`, and discovered manual backups). Cache-like artifacts and `.reset-intent` markers are excluded from recovery candidates.
- `settings.json.bak` stores the last valid unified settings snapshot before each write and is used as a recovery fallback when `settings.json` is unreadable.
- Flagged-account backup recovery is suppressed whenever the flagged reset marker is still present, so partial clears cannot revive previously cleared flagged entries.

Upgrade note:

- Restore workflows now distinguish between unreadable state and intentionally cleared state. `settings.json.bak` is only used when `settings.json` exists but cannot be read, while flagged-account backups stay suppressed whenever the reset marker survives a partial clear.
- Operators validating a restore or clear flow should use `codex-multi-auth verify-flagged`, `codex-multi-auth fix --dry-run`, and `codex-multi-auth doctor --fix` to confirm what will be recovered, what stays cleared, and whether manual repair is still needed.
- Maintainers validating the on-disk upgrade behavior can run `npm run build` plus `npm test -- --run test/unified-settings.test.ts test/storage-recovery-paths.test.ts test/storage-flagged.test.ts` before shipping backup or restore changes.

---

## Project-Scoped Account Paths

When project-scoped behavior is enabled:

- `~/.codex/multi-auth/projects/<project-key>/openai-codex-accounts.json`

`<project-key>` is derived as:

- sanitized project folder basename (max 40 chars)
- `-`
- first 12 chars of `sha256(normalized project path)`

On Windows, normalization lowercases drive/path segments before hashing.
Implementation reference: `lib/storage/paths.ts` (`getProjectStorageKey`).

**Worktree behavior:**

- Standard repositories: identity is the project root path.
- Linked Git worktrees: identity is the shared repository root, so all worktrees for the same repo share one account pool.
- Non-Git directories: identity falls back to the detected project path.

---

## Legacy Compatibility Paths

Older installations may still have compatibility-read paths during migration. These are migration-only and not canonical for new setup.

Examples:

- `~/DevTools/config/codex/`
- older pre-`~/.codex/multi-auth` custom roots

---

## Runtime Rotation Paths

Runtime rotation adds local state only when enabled or when a helper has recently run.

| Path | Purpose |
| --- | --- |
| `~/.codex/multi-auth/runtime-observability.json` | request counters, last selected runtime account metadata, and cooldown context for status/report commands |
| `~/.codex/multi-auth/runtime-rotation-app-helper.<pid>.json` | wrapper-launched `codex app` helper state, idle timeout, request count, and last-account metadata — one file per helper; the un-suffixed name is the legacy shared path from older versions, still read. A terminal stamp persists until the next helper launch sweeps files whose PID is dead; the owner file is removed on clean helper exit. `codex-multi-auth rotation unbind-app` sweeps the same metadata independently — including owner files with no surviving status record — so it is the recovery path when helpers have accumulated and nothing is launching new ones. It preserves, with a warning, any record whose PID is still live |
| `~/.codex/multi-auth/app-bind/runtime-rotation-app-bind.json` | persistent packaged-app bind state |
| `~/.codex/multi-auth/app-bind/codex-config-backup.json` | backup metadata for restoring the real Codex `config.toml` |
| `~/.codex/multi-auth/app-bind/runtime-rotation-app-bind-status.json` | persistent app router status |
| `~/.codex/multi-auth/app-bind/runtime-rotation-app-router.log` | persistent app router log |
| `~/.codex/multi-auth/first-run-setup.json` | one-shot first CLI run marker for Codex auth-store enforcement / app bind / launcher self-heal (versioned; v1 markers migrate in place) |

The app bind writes a provider entry to the real `~/.codex/config.toml` only after taking a backup. `codex-multi-auth rotation disable` and `codex-multi-auth rotation unbind-app` restore the backup and remove the router startup entry.

---

## Local Governance and Bridge Paths

| Path | Purpose |
| --- | --- |
| `~/.codex/multi-auth/usage/` | Directory for the local usage ledger and rotated archives |
| `~/.codex/multi-auth/usage/usage-ledger.jsonl` | Append-only local usage metadata ledger |
| `~/.codex/multi-auth/usage/usage-ledger.<timestamp>.jsonl` | Archived ledgers produced by `codex-multi-auth usage rotate` |
| `~/.codex/multi-auth/account-policies.json` | Hashed-account policy metadata for tags, weights, pause, drain, and notes (`codex-multi-auth account ...`) |
| `~/.codex/multi-auth/routing-profiles.json` | Project-aware profile preferences keyed with `getProjectStorageKey` |
| `~/.codex/multi-auth/budget-guards.json` | Local budget limits evaluated from usage summaries (`codex-multi-auth budget ...`) |
| `~/.codex/multi-auth/local-client-tokens.json` | Local bridge token hashes and prefixes only (`codex-multi-auth bridge token ...`) |

The local bridge is loopback-only and exposes `/health`, `/v1/models`, and
`/v1/responses`. Plain client tokens are shown only by `codex-multi-auth bridge token
create` or `codex-multi-auth bridge token rotate`; the token store persists hashes.

Policy pause/drain entries in `account-policies.json` are enforced at selection
time by `evaluateRuntimePolicy` (blocked accounts are excluded from hybrid
rotation).

---

## Named Backup Exports

Experimental named backup exports are written under the local plugin-owned backup namespace beside the active accounts file:

- global root: `~/.codex/multi-auth/backups/<name>.json`
- project root: `~/.codex/multi-auth/projects/<project-key>/backups/<name>.json`

Rules:

- `.json` is appended when omitted
- backup names may only contain letters, numbers, `_`, and `-`
- path separators and `..` are rejected
- `.rotate.`, `.tmp`, and `.wal` names are rejected
- existing files are not overwritten unless a lower-level force path is used explicitly

---

## oc-chatgpt Target Paths

Experimental sync targets the companion `oc-chatgpt-multi-auth` storage layout:

- global target: `~/.opencode/openai-codex-accounts.json`
- project target: `~/.opencode/projects/<project-key>/openai-codex-accounts.json`
- target backups: `~/.opencode/backups/` or project-local `backups/` beside the target account file

---

## Verification Commands

```bash
codex-multi-auth status
codex-multi-auth list
codex-multi-auth verify --paths
```

---

## Related

- [../configuration.md](../configuration.md)
- [../upgrade.md](../upgrade.md)
- [../privacy.md](../privacy.md)
- [commands.md](commands.md)
- [settings.md](settings.md)
