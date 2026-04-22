# Publishing @spine/mcp to npm

## One-time setup (do this once)

### 1. Create the npm org

1. Go to https://www.npmjs.com/org/create
2. Org name: `spine`
3. If `spine` is taken, check `@spine-mcp` or `@spinemcp`
4. Update `package.json` → `"name"` to match the org you secured

### 2. Authenticate

```bash
npm login
# Prompts for username, password, email, OTP
# Verify: npm whoami → should print your username
```

### 3. Verify you own the org scope

```bash
npm org ls spine
# Should list you as owner
```

---

## Every publish

```bash
# 1. From the repo root — build first
cd packages/mcp
npm run build
# Verify dist/ exists with no tsc errors

# 2. Sanity-check what will be published
npm pack --dry-run
# Should list: dist/**, README.md, package.json
# Should NOT list: src/, node_modules/, *.ts source files

# 3. Bump version (choose: patch | minor | major)
npm version patch
# This commits a version bump and creates a git tag

# 4. Publish
npm publish --access public
# --access public is required for scoped packages on free npm accounts

# 5. Verify install works cold
cd /tmp && npx @spine/mcp --version
# Should print the version you just published
```

---

## Testing the full install flow before publish

```bash
# Pack locally
npm pack
# Creates spine-mcp-1.0.0.tgz in packages/mcp/

# Install from local tarball in a temp dir
mkdir /tmp/spine-test && cd /tmp/spine-test
npm init -y
npm install /path/to/spine-mcp-1.0.0.tgz

# Test commands
npx spine-mcp --version
npx spine-mcp init --local
npx spine-mcp serve &
# Should start MCP server on stdio with no errors
kill %1
```

---

## If the Stop hook is erroring

The hook runs `npx @spine/mcp hook-stop`. If the package isn't published yet,
npx falls back to the local install — but if the package name doesn't match,
it will error with "package not found".

**Temporary workaround** while the package isn't yet published:

In `~/.claude/settings.json`, change the hook command to use the local dist directly:

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node /path/to/saas/spine/packages/mcp/dist/cli.js hook-stop"
      }]
    }]
  }
}
```

Replace `/path/to/saas/spine/` with the actual absolute path.

---

## Post-publish checklist

- [ ] `npx @spine/mcp --version` prints correct version from a fresh directory
- [ ] `npx @spine/mcp init --local` writes `~/.spine/config.json` and `~/.claude/settings.json`
- [ ] `npx @spine/mcp serve` starts without crashing
- [ ] Stop hook fires and captures session on next Claude Code session end
- [ ] UserPromptSubmit hook fires and injects memories (check Claude's context at session start)
- [ ] Update `CHANGELOG.md` with what changed in this version

---

## Version strategy

- `patch` (1.0.x) — bug fixes, hook registration fixes, parse improvements
- `minor` (1.x.0) — new MCP tools, new commands, new store features
- `major` (x.0.0) — breaking config format changes, store schema migrations

Current version: `1.0.0`
