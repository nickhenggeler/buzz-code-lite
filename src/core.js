// Pure logic: no host, DOM or editor dependencies.
export const MAX_EDIT_BYTES = 5 * 1024 * 1024;

export const splitNul = (text) => text.split("\0").filter(Boolean);

export function listChildren(paths, dir) {
  const prefix = dir ? `${dir}/` : "";
  const folders = new Map();
  const files = [];
  for (const path of paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) files.push({ name: rest, path });
    else {
      const name = rest.slice(0, slash);
      folders.set(name, { name, path: prefix + name });
    }
  }
  const byName = (a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return { folders: [...folders.values()].sort(byName), files: files.sort(byName) };
}

export function treeRows(paths, expanded) {
  const rows = [];
  const walk = (dir, depth) => {
    const children = listChildren(paths, dir);
    for (const folder of children.folders) {
      const open = expanded.has(folder.path);
      rows.push({ type: "folder", ...folder, depth, open });
      if (open) walk(folder.path, depth + 1);
    }
    for (const file of children.files) rows.push({ type: "file", ...file, depth });
  };
  walk("", 0);
  return rows;
}

export function ancestors(path) {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** `git status --porcelain=v1 -z -b` output. */
export function parseStatus(text) {
  const entries = splitNul(text);
  let branch = "";
  let ahead = 0;
  let behind = 0;
  const changes = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.startsWith("## ")) {
      const head = entry.slice(3);
      branch = head
        .replace(/^No commits yet on /, "")
        .replace(/^Initial commit on /, "")
        .split("...")[0]
        .split(" ")[0];
      ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
      continue;
    }
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code[0] === "R" || code[0] === "C") index += 1;
    changes.set(
      path,
      code === "??"
        ? "U"
        : code.includes("D")
          ? "D"
          : code.includes("A")
            ? "A"
            : code.includes("R")
              ? "R"
              : "M",
    );
  }
  return { branch, ahead, behind, changes };
}

export function changedFolders(changes) {
  const folders = new Set();
  for (const path of changes.keys())
    for (const folder of ancestors(path)) folders.add(folder);
  return folders;
}

export function decodeFile(bytes) {
  if (bytes.length > MAX_EDIT_BYTES) return { kind: "large", size: bytes.length };
  if (bytes.includes(0)) return { kind: "binary", size: bytes.length };
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { kind: "binary", size: bytes.length };
  }
  const crlf = /\r\n/.test(text) && !/(^|[^\r])\n/.test(text);
  return { kind: "text", text: text.replace(/\r\n/g, "\n"), crlf, size: bytes.length };
}

export const encodeText = (text, crlf) =>
  crlf ? text.replace(/\n/g, "\r\n") : text;

export function languageKey(path) {
  const name = path.split("/").pop().toLowerCase();
  if (name === "dockerfile" || name.endsWith(".dockerfile")) return "dockerfile";
  if (name === "makefile") return "shell";
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const map = {
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
    ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
    py: "python", rs: "rust", go: "go", json: "json", jsonc: "json",
    html: "html", htm: "html", css: "css", scss: "css",
    md: "markdown", markdown: "markdown", mdx: "markdown",
    yml: "yaml", yaml: "yaml", toml: "toml", sql: "sql",
    c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", hpp: "cpp",
    java: "java", kt: "java", swift: "swift",
    sh: "shell", bash: "shell", zsh: "shell",
  };
  return map[ext] ?? "plain";
}

export const languageLabel = (key) =>
  ({
    javascript: "JavaScript", jsx: "JavaScript JSX", typescript: "TypeScript",
    tsx: "TypeScript JSX", python: "Python", rust: "Rust", go: "Go", json: "JSON",
    html: "HTML", css: "CSS", markdown: "Markdown", yaml: "YAML", toml: "TOML",
    sql: "SQL", cpp: "C/C++", java: "Java", swift: "Swift", shell: "Shell",
    dockerfile: "Dockerfile", plain: "Plain text",
  })[key] ?? "Plain text";

/** In-order character match, preferring the file name and tight matches. */
export function matchFiles(paths, query, limit = 50) {
  const needle = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!needle) return paths.slice(0, limit);
  const scored = [];
  for (const path of paths) {
    const haystack = path.toLowerCase();
    let at = -1;
    let gaps = 0;
    let found = true;
    for (const character of needle) {
      const next = haystack.indexOf(character, at + 1);
      if (next < 0) {
        found = false;
        break;
      }
      if (at >= 0) gaps += next - at - 1;
      at = next;
    }
    if (!found) continue;
    const name = haystack.slice(haystack.lastIndexOf("/") + 1);
    const score = gaps + path.length / 100 - (name.includes(needle) ? 1000 : 0);
    scored.push({ path, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((item) => item.path);
}

export function expandHome(path, home) {
  if (path === "~") return home;
  return path.startsWith("~/") ? `${home}/${path.slice(2)}` : path;
}

export const baseName = (path) => path.split("/").filter(Boolean).pop() ?? path;
