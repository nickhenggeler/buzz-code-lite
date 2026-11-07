// Runs the real workspace layer against real git, tee and find.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { test } from "node:test";
import { createWorkspace } from "../src/workspace.js";

const programs = { git: "git", tee: "tee", find: "find" };
const host = {
  async spawn(id, { args = [], cwd, env, onStdout, onStderr }) {
    const child = spawn(programs[id], args, { cwd, env: { ...process.env, ...env } });
    child.stdout.setEncoding("utf8").on("data", (data) => onStdout?.(data));
    child.stderr.setEncoding("utf8").on("data", (data) => onStderr?.(data));
    child.stdin.on("error", () => {});
    const exited = new Promise((done) => child.on("close", done));
    return { end: async (data = "") => child.stdin.end(data), kill: async () => child.kill(), exited };
  },
  readFile: async (path, { cwd } = {}) => new Uint8Array(readFileSync(isAbsolute(path) ? path : resolve(cwd, path))),
  resolveDirectory: async (path) => {
    const full = path.replace(/^~/, process.env.TEST_HOME ?? homedir());
    mkdirSync(full, { recursive: true });
    return full;
  },
};

function repo() {
  const root = mkdtempSync(join(tmpdir(), "code-lite-"));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a b é.txt"), "one\n");
  writeFileSync(join(root, "run.sh"), "#!/bin/sh\n");
  chmodSync(join(root, "run.sh"), 0o755);
  writeFileSync(join(root, "win.txt"), "a\r\nb\r\n");
  writeFileSync(join(root, "bin.dat"), Buffer.from([0, 1, 2]));
  writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(root, "ignored.txt"), "x");
  git("add", "-A");
  git("commit", "-qm", "init");
  return root;
}

const ws = createWorkspace(host);

test("opens a repository and rejects a missing folder without creating it", async () => {
  const root = repo();
  assert.equal(await ws.openFolder(root), execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"]).toString().trim());
  const missing = join(root, "nope");
  await assert.rejects(ws.openFolder(missing), /isn't a git repository/);
  assert.throws(() => statSync(missing));
  await assert.rejects(ws.openFolder("relative/path"), /full path/);
  rmSync(root, { recursive: true });
});

test("lists tracked and new files, hides ignored files, handles spaces and accents", async () => {
  const root = repo();
  writeFileSync(join(root, "new.txt"), "n");
  const files = await ws.listFiles(root);
  assert.ok(files.includes("src/a b é.txt"));
  assert.ok(files.includes("new.txt"));
  assert.ok(!files.includes("ignored.txt"));
  rmSync(root, { recursive: true });
});

test("reports branch and each change type", async () => {
  const root = repo();
  writeFileSync(join(root, "run.sh"), "#!/bin/sh\necho\n");
  writeFileSync(join(root, "new.txt"), "n");
  rmSync(join(root, "win.txt"));
  const status = await ws.status(root);
  assert.equal(status.branch, "main");
  assert.equal(status.changes.get("run.sh"), "M");
  assert.equal(status.changes.get("new.txt"), "U");
  assert.equal(status.changes.get("win.txt"), "D");
  rmSync(root, { recursive: true });
});

test("saves text exactly, including unicode and an empty file", async () => {
  const root = repo();
  await ws.write(root, "src/a b é.txt", "héllo 🌍\nline\n", false);
  assert.equal(readFileSync(join(root, "src/a b é.txt"), "utf8"), "héllo 🌍\nline\n");
  await ws.write(root, "src/a b é.txt", "", false);
  assert.equal(readFileSync(join(root, "src/a b é.txt"), "utf8"), "");
  rmSync(root, { recursive: true });
});

test("saving keeps file mode, symlinks and CRLF line endings", async () => {
  const root = repo();
  await ws.write(root, "run.sh", "#!/bin/sh\necho hi\n", false);
  assert.equal(statSync(join(root, "run.sh")).mode & 0o777, 0o755);
  symlinkSync("run.sh", join(root, "link.sh"));
  await ws.write(root, "link.sh", "#!/bin/sh\n", false);
  assert.equal(readFileSync(join(root, "run.sh"), "utf8"), "#!/bin/sh\n");
  const file = await ws.read(root, "win.txt");
  assert.equal(file.crlf, true);
  assert.equal(file.text, "a\nb\n");
  await ws.write(root, "win.txt", `${file.text}c\n`, file.crlf);
  assert.equal(readFileSync(join(root, "win.txt"), "utf8"), "a\r\nb\r\nc\r\n");
  rmSync(root, { recursive: true });
});

test("large saves go through intact", async () => {
  const root = repo();
  const text = "0123456789abcdef\n".repeat(200000);
  await ws.write(root, "big.txt", text, false);
  assert.equal(readFileSync(join(root, "big.txt"), "utf8"), text);
  rmSync(root, { recursive: true });
});

test("flags binary and oversized files instead of opening them", async () => {
  const root = repo();
  assert.equal((await ws.read(root, "bin.dat")).kind, "binary");
  writeFileSync(join(root, "huge.txt"), Buffer.alloc(6 * 1024 * 1024, 97));
  assert.equal((await ws.read(root, "huge.txt")).kind, "large");
  rmSync(root, { recursive: true });
});

test("a failed write reports an error", async () => {
  const root = repo();
  await assert.rejects(ws.write(root, "no/such/dir/file.txt", "x", false));
  rmSync(root, { recursive: true });
});

test("finds repositories under ~/.buzz/REPOS", async () => {
  const home = mkdtempSync(join(tmpdir(), "code-lite-home-"));
  process.env.TEST_HOME = home;
  mkdirSync(join(home, ".buzz/REPOS/one/.git"), { recursive: true });
  mkdirSync(join(home, ".buzz/REPOS/plain"), { recursive: true });
  assert.deepEqual(await ws.listRepositories(), [join(home, ".buzz/REPOS/one")]);
  delete process.env.TEST_HOME;
  rmSync(home, { recursive: true });
});
