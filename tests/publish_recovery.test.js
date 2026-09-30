import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function sandbox(t, script = "update_and_publish_daily.sh") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "app3-publish-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const production = path.join(root, "production");
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const artifacts = ["app3_signal.json", "benchmark_series.json", "app3_strategy_history.json", "public_market_update_status.json"];
  for (const name of artifacts) write(path.join(repo, "data", name), "original\n");
  write(path.join(repo, "scripts", script), fs.readFileSync(new URL(`../scripts/${script}`, import.meta.url)));
  for (const name of ["scripts/app3_export_public_signal.py", "data/processed/decision_v1.json", "data/processed/app3_signal_feedback.json", "data/outputs/app1/rotation_live/rotation_live_series.csv"]) {
    write(path.join(production, name), "production remains untouched\n");
  }
  const fakePython = path.join(root, "exporter");
  write(fakePython, `#!/bin/bash
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then printf 'generated\\n' > "$2"; break; fi
  if [[ "$1" == "--target" ]]; then printf 'generated\\n' > "$2"; break; fi
  shift
done
`);
  const fakeGit = path.join(root, "git");
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  write(fakeGit, `#!/bin/bash
if [[ "$1" == "pull" ]]; then exit 0; fi
exec "${realGit}" "$@"
`);
  fs.chmodSync(fakePython, 0o755);
  fs.chmodSync(fakeGit, 0o755);
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("add", ".");
  git("commit", "-m", "fixture");
  const run = () => spawnSync("bash", [`scripts/${script}`], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, APP3_PRODUCTION_ROOT: production, PYTHON_BIN: fakePython, GIT_BIN: fakeGit, NODE_BIN: "/usr/bin/true", NPM_BIN: "/usr/bin/false" },
  });
  return { root, repo, production, artifacts, git, run, write };
}

test("failed validation after export restores only generated artifacts from a clean repo", (t) => {
  const s = sandbox(t);
  const before = fs.readFileSync(path.join(s.production, "data/processed/decision_v1.json"), "utf8");
  assert.equal(s.run().status, 1);
  assert.equal(s.git("status", "--porcelain"), "");
  for (const name of s.artifacts) assert.equal(fs.readFileSync(path.join(s.repo, "data", name), "utf8"), "original\n");
  assert.equal(fs.readFileSync(path.join(s.production, "data/processed/decision_v1.json"), "utf8"), before);
});

test("22:15 updater stops on validation failure and restores its generated market files", (t) => {
  const s = sandbox(t, "update_public_market_data.sh");
  assert.equal(s.run().status, 1);
  assert.equal(s.git("status", "--porcelain"), "");
  assert.equal(s.git("rev-list", "--count", "HEAD").trim(), "1");
  for (const name of s.artifacts) assert.equal(fs.readFileSync(path.join(s.repo, "data", name), "utf8"), "original\n");
});

test("22:15 updater leaves dirty-at-start user changes untouched", (t) => {
  const s = sandbox(t, "update_public_market_data.sh");
  s.write(path.join(s.repo, "data/benchmark_series.json"), "user edit\n");
  const before = s.git("status", "--porcelain");
  assert.equal(s.run().status, 1);
  assert.equal(s.git("status", "--porcelain"), before);
  assert.equal(fs.readFileSync(path.join(s.repo, "data/benchmark_series.json"), "utf8"), "user edit\n");
});

test("dirty-at-start fails closed and preserves both user files and modified public data", (t) => {
  const s = sandbox(t);
  s.write(path.join(s.repo, "data/app3_signal.json"), "user edit\n");
  s.write(path.join(s.repo, "user.txt"), "private local work\n");
  const before = s.git("status", "--porcelain");
  const result = s.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lokala ändringar/);
  assert.equal(s.git("status", "--porcelain"), before);
  assert.equal(fs.readFileSync(path.join(s.repo, "data/app3_signal.json"), "utf8"), "user edit\n");
  assert.equal(fs.readFileSync(path.join(s.repo, "user.txt"), "utf8"), "private local work\n");
});
