# Publishing spine-mcp to npm

> Read this **before** running `npm publish`. Two minutes here saves an
> hour rolling back a botched release.

## Where things stand right now

- Package name on npm: **`spine-mcp`** (unscoped — no `@spine/` prefix).
- Latest published: check with `npm view spine-mcp version`.
- Source of truth for version: `packages/mcp/package.json` `"version"`.
- Maintainer on npm: `roman.xxiautomate` (your account).
- Tarball is **64 files, ~65 kB** — no `src/`, no `node_modules/`. If
  `npm pack --dry-run` shows anything else, stop and investigate before
  publishing.

---

## Pre-flight (run every time)

From `packages/mcp/`:

```bash
# 1. Clean build
npm run build

# 2. Inspect the tarball that will go to npm
npm pack --dry-run

# 3. Smoke the published behaviour locally
npm run smoke         # publish-smoke.mjs
```

If `prepublishOnly` is honoured (it is, via the script in package.json)
both build and smoke run automatically when you `npm publish` — but it's
faster to catch problems before you've authenticated.

---

## Authentication

You should already be logged in (`npm whoami` → `roman.xxiautomate`).
If not:

```bash
npm login
# Choose: Web (browser flow) — opens npm.js in the browser, sign in,
# returns to the terminal authenticated.
```

For 2FA, you have two options on your account:

- **Standard**: every `npm publish` prompts for an OTP from your
  authenticator app. Safest, slowest.
- **Granular access token with `--otp` bypass**: generate at
  https://www.npmjs.com/settings/<you>/tokens · choose
  *Granular Access Token*, scope to the `spine-mcp` package, tick
  "Bypass 2FA for publish." Set `NPM_TOKEN` in your shell and `npm
  publish` will use it without prompting. Treat this token like a
  password — short expiry, never commit it.

---

## Publish

```bash
# 1. Decide the version bump (see semver below)
npm version patch     # 1.1.1 → 1.1.2 (bug fix, no API change)
npm version minor     # 1.1.x → 1.2.0 (new MCP tool, new command, new flag)
npm version major     # 1.x.x → 2.0.0 (breaking config or schema change)
# This commits a version bump and creates a git tag.

# 2. Push the version bump + tag (so the repo and npm stay in sync)
git push --follow-tags

# 3. Publish
npm publish --access public
# --access public is required even for unscoped packages on free accounts.

# 4. Verify the release landed
npm view spine-mcp version
# Should print the version you just published.
```

### Cold-install verification

```bash
cd /tmp
npx spine-mcp@latest --version
# Should print the version you just published. If npm cached, add
# --no-cache or `npx spine-mcp@<exact-version>`.

npx spine-mcp@latest init --local
# Writes ~/.spine/config.json + ~/.claude/settings.json,
# starts MCP server on stdio with no errors.
```

---

## Rollback

If you find a critical bug **after** publish:

```bash
# Option A — deprecate the bad version (preferred, doesn't break installs)
npm deprecate spine-mcp@<version> "Critical bug — please install <safe>"

# Option B — fully unpublish (only allowed within 72 hours of publish,
# only if no one else depends on it)
npm unpublish spine-mcp@<version>
```

Then publish a patch version with the fix immediately. The deprecation
message shows up in `npm install` warnings — users on the bad version
get nudged automatically.

**Never `npm unpublish` a version that's been live for more than a
couple of hours.** It breaks every lockfile that's pinned to it and
poisons the cache for downstream users.

---

## Version strategy

- `patch` (1.1.x) — bug fixes, parser tweaks, idempotency improvements,
  hook registration fixes. Safe to publish without warning.
- `minor` (1.x.0) — new MCP tools, new commands, new CLI flags, new
  store features. Backward-compatible.
- `major` (x.0.0) — breaking changes to config format, MCP tool names,
  CLI command shape, or store schema. Coordinate with Roman first.

The currently-staged version (1.1.1) is a `patch` — sync-obsidian now
drops the prior memory before re-ingesting an updated note (true
update-in-place semantics) instead of leaving a duplicate. No public
API change.

---

## Post-publish

- [ ] `npm view spine-mcp version` matches expected
- [ ] `npx spine-mcp@latest --version` prints from a fresh directory
- [ ] `npx spine-mcp@latest init --local` writes config + starts server
- [ ] Stop hook fires and captures session on next Claude Code session end
- [ ] UserPromptSubmit hook fires and injects memories at session start
- [ ] Update `CHANGELOG.md` with what changed in this version (one line
      under `## <version>`)

---

## If something goes sideways

- **`npm publish` errors with "version already exists"** — bump the
  version (`npm version patch`) before retrying.
- **`npm publish` errors with "you do not have permission"** — re-auth
  (`npm logout && npm login`), confirm `npm whoami` matches the package
  maintainer.
- **`prepublishOnly` smoke fails** — read the failure, fix the source,
  rebuild, retry. Do **not** skip with `--ignore-scripts` to ship a
  release that didn't smoke-test.
- **Tarball size jumped > 100 kB** — something landed in `dist/` that
  shouldn't have. Compare `npm pack --dry-run` against the previous
  version's file list.
- **Stop hook regressed for users on the new version** — `npm
  deprecate` the bad version with a pointer to the safe one, then ship
  a patch within an hour.
