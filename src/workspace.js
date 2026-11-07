import { decodeFile, encodeText, expandHome, parseStatus, splitNul } from "./core.js";

const QUIET_GIT = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

/** File and git access through the plugin's declared host programs. */
export function createWorkspace(host) {
  const supported = Boolean(host.spawn && host.readFile && host.resolveDirectory);

  async function run(id, args, { input = "", timeout = 20000 } = {}) {
    let stdout = "";
    let stderr = "";
    const process = await host.spawn(id, {
      args,
      env: QUIET_GIT,
      onStdout: (data) => {
        stdout += data;
      },
      onStderr: (data) => {
        stderr += data;
      },
    });
    let timer;
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeout);
    });
    // A program may exit before reading stdin; its exit code is what counts.
    const wrote = process.end(input).catch((error) => error);
    const code = await Promise.race([process.exited, expired]);
    clearTimeout(timer);
    if (code === "timeout") {
      await process.kill();
      throw new Error(`${id} took too long`);
    }
    await wrote;
    return { code, stdout, stderr };
  }

  async function git(root, args, options) {
    const result = await run(
      "git",
      ["-C", root, "-c", "core.quotePath=false", ...args],
      options,
    );
    if (result.code !== 0)
      throw new Error(result.stderr.trim() || `git exited with ${result.code}`);
    return result.stdout;
  }

  return {
    supported,

    async listRepositories() {
      const base = await host.resolveDirectory("~/.buzz/REPOS");
      const { stdout } = await run("find", [base, "-maxdepth", "2", "-name", ".git"]);
      return stdout
        .split("\n")
        .filter(Boolean)
        .map((path) => path.replace(/\/\.git$/, ""))
        .sort((a, b) => a.localeCompare(b));
    },

    /** Resolves a repository root. Never creates a missing folder. */
    async openFolder(input) {
      const home = await host.resolveDirectory("~");
      const path = expandHome(input.trim(), home);
      if (!path.startsWith("/")) throw new Error("Use a full path, such as ~/code/app");
      const result = await run("git", ["-C", path, "rev-parse", "--show-toplevel"]);
      if (result.code !== 0)
        throw new Error("That folder isn't a git repository, or it doesn't exist.");
      return result.stdout.trim();
    },

    async listFiles(root) {
      const output = await git(root, ["ls-files", "-co", "--exclude-standard", "-z"]);
      return [...new Set(splitNul(output))].sort();
    },

    async status(root) {
      return parseStatus(
        await git(root, ["status", "--porcelain=v1", "-z", "-b", "--untracked-files=all"]),
      );
    },

    async read(root, path) {
      return decodeFile(await host.readFile(path, { cwd: root }));
    },

    /** Writes in place to keep the file's mode and symlinks, then verifies it. */
    async write(root, path, text, crlf) {
      const content = encodeText(text, crlf);
      const result = await run("tee", [`${root}/${path}`], { input: content });
      if (result.code !== 0)
        throw new Error(result.stderr.trim() || "The file couldn't be written.");
      const check = decodeFile(await host.readFile(path, { cwd: root }));
      if (check.kind !== "text" || encodeText(check.text, check.crlf) !== content)
        throw new Error("The saved file doesn't match. Your changes are still here.");
    },
  };
}
