#!/usr/bin/env node
// Release helper for @oakzone/mcp-client-tests. Validates, stages all changes, commits,
// tags, and pushes — the full sequence from AGENTS.md § Release flow in one command.
//
// Usage:
//   npm run release -- v0.18.0          # full release sequence
//   npm run release -- 0.18.0           # 'v' prefix optional; auto-added
//   npm run release -- v0.18.0 --dry-run  # show what would happen, change nothing
//
// The script:
//   1. Parses + normalizes the version arg.
//   2. Verifies package.json's version field matches the requested version.
//   3. Verifies CHANGELOG.md has a heading "## vX.Y.Z — <summary>" for it.
//      Extracts <summary> for the commit/tag message.
//   4. Runs `npm run validate` (lint + tests). Aborts on failure.
//   5. Stages all changes with `git add -A`. Aborts if any staged file
//      looks suspicious (.env, anything with 'secret'/'credential'/'.key'
//      in the name) — those almost certainly shouldn't ship.
//   6. Commits with `feat: vX.Y.Z — <summary>`.
//   7. Tags vX.Y.Z (annotated tag, message matches the commit summary).
//   8. Pushes the commit to origin/main.
//   9. Pushes the tag to origin.
//  10. Prints verification commands so the maintainer can sanity-check.
//
// On any failure after step 5 (commit), the script exits non-zero and
// leaves git state where it was — partial state is recoverable manually
// (`git reset HEAD~1` to undo the commit, `git tag -d vX.Y.Z` to remove
// the local tag) without surprising the maintainer.
//
// Pre-conditions for use:
//   - package.json `version` already bumped to the target version.
//   - CHANGELOG.md has a top entry "## vX.Y.Z — <summary>".
//   - On branch `main` (or whatever the maintainer wants pushed; the
//     script pushes whatever branch is currently checked out — verify
//     before running).

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

// Run a command line via the platform shell. Avoids DEP0190 (Node 22+'s
// deprecation of `spawnSync(file, args, { shell: true })`, which
// concatenates without escaping) by passing a single pre-formatted command
// string and `shell: true`. Trying to spawn `.cmd` files directly without
// shell on Windows fails with `EINVAL` in Node 22+, so the shell route is
// the cross-platform path. Callers must quote any user-supplied values
// they embed in `cmd` — the script only invokes this with a SemVer-validated
// version tag and a hardcoded summary string.
function shellRun(cmd, options = {}) {
  return spawnSync(cmd, { shell: true, ...options });
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const versionArg = args.find((a) => !a.startsWith("--"));

if (!versionArg) {
  process.stderr.write(
    `usage: npm run release -- <version> [--dry-run]\n` +
    `  examples:\n` +
    `    npm run release -- v0.18.0\n` +
    `    npm run release -- 0.18.0\n` +
    `    npm run release -- v0.18.0 --dry-run\n`
  );
  process.exit(2);
}

const version = versionArg.startsWith("v") ? versionArg : `v${versionArg}`;
const versionNoV = version.slice(1);
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(versionNoV)) {
  process.stderr.write(
    `error: invalid version format: ${versionArg}\n` +
    `  expected vMAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH (optional pre-release suffix)\n`
  );
  process.exit(2);
}

// ---------- Step 2: package.json version check ----------

const pkg = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8"));
if (pkg.version !== versionNoV) {
  process.stderr.write(
    `error: package.json version is "${pkg.version}", but you asked to release "${version}".\n` +
    `  bump package.json first (single line edit), or specify the matching version on the command line.\n`
  );
  process.exit(2);
}

// ---------- Step 3: CHANGELOG check + summary extraction ----------

const changelog = await readFile(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
const headingRe = new RegExp(`^## ${escapeRegex(version)}\\s+—\\s+(.+)$`, "m");
const match = changelog.match(headingRe);
if (!match) {
  process.stderr.write(
    `error: no CHANGELOG.md heading found for ${version}.\n` +
    `  expected a line of the form "## ${version} — <summary>" in CHANGELOG.md.\n` +
    `  add a CHANGELOG entry first; the heading text becomes the commit/tag message.\n`
  );
  process.exit(2);
}
const summary = match[1].trim();

console.log(`mcp-client-tests-release: ${version} — ${summary}`);
if (DRY_RUN) console.log(`mcp-client-tests-release: DRY RUN — git operations will be skipped`);

// ---------- Step 4: validate ----------

console.log(`mcp-client-tests-release: running 'npm run validate'...`);
const validate = shellRun(`npm run validate`, {
  cwd: REPO_ROOT,
  stdio: "inherit",
});
if (validate.status !== 0) {
  process.stderr.write(
    `\nerror: 'npm run validate' failed (exit ${validate.status}). fix before releasing.\n`
  );
  process.exit(1);
}

// ---------- Step 5: stage + sanity check ----------

if (!DRY_RUN) {
  const add = spawnSync("git", ["add", "-A"], { cwd: REPO_ROOT, stdio: "inherit" });
  if (add.status !== 0) {
    process.stderr.write(`error: 'git add -A' failed (exit ${add.status}).\n`);
    process.exit(1);
  }
}

const stagedRes = spawnSync(
  "git",
  ["diff", "--cached", "--name-only"],
  { cwd: REPO_ROOT, encoding: "utf8" }
);
const stagedFiles = (stagedRes.stdout || "").split("\n").filter(Boolean);

const SUSPICIOUS = /(?:^|\/)\.env(\.|$)|secret|credential|password|\.key$|\.pem$|\.p12$/i;
const suspicious = stagedFiles.filter((f) => SUSPICIOUS.test(f));
if (suspicious.length > 0) {
  process.stderr.write(
    `\nerror: refusing to commit; suspicious files staged:\n` +
    suspicious.map((s) => `  - ${s}`).join("\n") + "\n" +
    `\nif these are intended, run 'git reset HEAD' and commit manually.\n`
  );
  if (!DRY_RUN) spawnSync("git", ["reset", "HEAD"], { cwd: REPO_ROOT, stdio: "inherit" });
  process.exit(2);
}

if (stagedFiles.length === 0) {
  if (DRY_RUN) {
    console.log(`mcp-client-tests-release: no staged changes (dry-run mode shows pre-existing state)`);
  } else {
    process.stderr.write(
      `\nerror: nothing to commit. either no changes were made, or they're already committed.\n` +
      `  if the version-bump commit already exists, just need to tag and push:\n` +
      `    git tag ${version}\n` +
      `    git push origin main\n` +
      `    git push origin ${version}\n`
    );
    process.exit(2);
  }
}

console.log(`mcp-client-tests-release: staged ${stagedFiles.length} file(s)`);
for (const f of stagedFiles) console.log(`  - ${f}`);

// ---------- Step 6: commit ----------

const commitMsg = `feat: ${version} — ${summary}`;
console.log(`mcp-client-tests-release: committing as: ${commitMsg}`);
if (!DRY_RUN) {
  const commit = spawnSync("git", ["commit", "-m", commitMsg], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (commit.status !== 0) {
    process.stderr.write(`\nerror: 'git commit' failed (exit ${commit.status}).\n`);
    process.exit(1);
  }
}

// ---------- Step 7: tag ----------

console.log(`mcp-client-tests-release: tagging ${version}`);
if (!DRY_RUN) {
  const tag = spawnSync(
    "git",
    ["tag", "-a", version, "-m", `${version} — ${summary}`],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
  if (tag.status !== 0) {
    process.stderr.write(
      `\nerror: 'git tag' failed (exit ${tag.status}).\n` +
      `  the commit was made but the tag is not. either tag manually:\n` +
      `    git tag -a ${version} -m "${version} — ${summary}"\n` +
      `  or undo the commit:\n` +
      `    git reset HEAD~1\n`
    );
    process.exit(1);
  }
}

// ---------- Step 8: push commit ----------

console.log(`mcp-client-tests-release: pushing commit to origin (current branch)...`);
if (!DRY_RUN) {
  const push = spawnSync("git", ["push", "origin", "HEAD"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (push.status !== 0) {
    process.stderr.write(
      `\nerror: 'git push origin HEAD' failed (exit ${push.status}).\n` +
      `  commit + tag exist locally but aren't pushed. retry the pushes:\n` +
      `    git push origin HEAD\n` +
      `    git push origin ${version}\n`
    );
    process.exit(1);
  }
}

// ---------- Step 9: push tag ----------

console.log(`mcp-client-tests-release: pushing tag ${version}...`);
if (!DRY_RUN) {
  const pushTag = spawnSync("git", ["push", "origin", version], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (pushTag.status !== 0) {
    process.stderr.write(
      `\nerror: 'git push origin ${version}' failed (exit ${pushTag.status}).\n` +
      `  the commit is pushed but the tag is not. consumers pinning to ${version} will fail until the tag is on the remote. retry:\n` +
      `    git push origin ${version}\n`
    );
    process.exit(1);
  }
}

// ---------- Step 10: verification hint ----------

console.log(``);
console.log(`✓ released ${version}`);
if (DRY_RUN) {
  console.log(`  (dry-run — nothing actually committed/tagged/pushed)`);
} else {
  console.log(``);
  console.log(`  verify on the remote:`);
  console.log(`    git ls-remote --tags origin | grep ${version}`);
  console.log(`    git log -1 --format="%H %s" ${version}`);
  console.log(`    git show ${version}:package.json | grep '"version"'`);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
