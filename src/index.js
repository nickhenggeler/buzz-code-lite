import { indentWithTab } from "@codemirror/commands";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import {
  StreamLanguage,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { EditorState } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  ancestors,
  baseName,
  changedFolders,
  languageKey,
  languageLabel,
  matchFiles,
  treeRows,
} from "./core.js";
import { createWorkspace } from "./workspace.js";

const RECENT_KEY = "sprig.code-lite.recent";
const PANEL_TARGET = "sprig-code-lite:edit";
const COMPACT_WIDTH = 620;

const languages = {
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  python: () => python(),
  rust: () => rust(),
  go: () => go(),
  json: () => json(),
  html: () => html(),
  css: () => css(),
  markdown: () => markdown(),
  yaml: () => yaml(),
  sql: () => sql(),
  cpp: () => cpp(),
  java: () => java(),
  toml: () => StreamLanguage.define(toml),
  shell: () => StreamLanguage.define(shell),
  swift: () => StreamLanguage.define(swift),
  dockerfile: () => StreamLanguage.define(dockerFile),
};

function readRecent() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveRecent(values) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(values));
  } catch {
    // Recents are a convenience only.
  }
}

/** Buzz's theme can differ from the OS, so read the page it actually painted. */
function pageIsDark(element) {
  for (let node = element; node; node = node.parentElement) {
    const match = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(
      getComputedStyle(node).backgroundColor,
    );
    if (match && Number(match[4] ?? 1) > 0.5)
      return (Number(match[1]) + Number(match[2]) + Number(match[3])) / 3 < 128;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

const CSS = `
[data-code-lite] {
  --cl-line: color-mix(in srgb, currentColor 14%, transparent);
  --cl-hover: color-mix(in srgb, currentColor 7%, transparent);
  --cl-selected: color-mix(in srgb, currentColor 12%, transparent);
  --cl-muted: color-mix(in srgb, currentColor 62%, transparent);
  display: flex; flex-direction: column; position: relative;
  height: 100%; min-height: 360px; width: 100%; font-size: 13px; overflow: hidden;
}
[data-code-lite] *, [data-code-lite] *::before { box-sizing: border-box; }
[data-code-lite] button:focus-visible, [data-code-lite] input:focus-visible { outline: 2px solid currentColor; outline-offset: -2px; }
.cl-btn { padding: 4px 9px; border-radius: 6px; border: 1px solid var(--cl-line); background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.cl-btn:hover { background: var(--cl-hover); }
.cl-input { width: 100%; padding: 7px 10px; border-radius: 7px; border: 1px solid var(--cl-line); background: transparent; color: inherit; font: inherit; }
.cl-muted { color: var(--cl-muted); }
.cl-oneline { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.cl-welcome { margin: 0 auto; padding: 32px 20px; width: 100%; max-width: 620px; overflow-y: auto; }
.cl-welcome h1 { font-size: 21px; margin: 0 0 4px; }
.cl-welcome h2 { font-size: 12px; font-weight: 600; margin: 20px 0 6px; color: var(--cl-muted); }
.cl-pick { display: flex; flex-direction: column; width: 100%; min-width: 0; padding: 6px 10px; border: none; border-radius: 7px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.cl-pick:hover { background: var(--cl-hover); }
.cl-form { display: flex; gap: 8px; margin-top: 8px; }
.cl-alert { padding: 8px 12px; margin-top: 10px; border-radius: 7px; border: 1px solid var(--cl-line); }
.cl-body { display: flex; flex: 1; min-height: 0; }
.cl-side { width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid var(--cl-line); min-height: 0; }
.cl-side-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 12px; border-bottom: 1px solid var(--cl-line); }
.cl-side-title { flex: 1; font-weight: 600; }
.cl-icon-btn { width: 24px; height: 24px; padding: 0; border: none; border-radius: 5px; background: none; color: inherit; font: inherit; opacity: .7; cursor: pointer; }
.cl-icon-btn:hover { background: var(--cl-hover); opacity: 1; }
.cl-tree { flex: 1; overflow: auto; padding: 4px; min-height: 0; }
.cl-row { display: flex; align-items: center; min-width: 0; border-radius: 5px; }
.cl-row:hover { background: var(--cl-hover); }
.cl-row[data-active="true"] { background: var(--cl-selected); }
.cl-row-btn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 3px 6px 3px 2px; background: none; border: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.cl-twist { display: inline-block; width: 12px; flex-shrink: 0; font-size: 9px; opacity: .55; text-align: center; }
.cl-mark { flex-shrink: 0; margin-left: auto; font-size: 11px; font-weight: 600; color: #d29922; }
.cl-mark[data-code="U"], .cl-mark[data-code="A"] { color: #3fb950; }
.cl-mark[data-code="D"] { color: #e5534b; }
.cl-dot { width: 6px; height: 6px; flex-shrink: 0; margin-left: auto; border-radius: 50%; background: #d29922; }
.cl-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.cl-tabs { display: flex; overflow-x: auto; flex-shrink: 0; border-bottom: 1px solid var(--cl-line); scrollbar-width: thin; min-height: 34px; }
.cl-tab { display: flex; align-items: center; gap: 2px; flex-shrink: 0; max-width: 200px; border-right: 1px solid var(--cl-line); opacity: .68; }
.cl-tab:hover { opacity: 1; }
.cl-tab[data-active="true"] { opacity: 1; box-shadow: inset 0 -2px 0 currentColor; }
.cl-tab-open { min-width: 0; padding: 7px 2px 7px 12px; background: none; border: none; color: inherit; font: inherit; cursor: pointer; }
.cl-tab-close { width: 22px; height: 22px; margin-right: 4px; flex-shrink: 0; padding: 0; border: none; border-radius: 4px; background: none; color: inherit; font-size: 13px; cursor: pointer; }
.cl-tab-close:hover { background: var(--cl-hover); }
.cl-banner { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0; padding: 7px 12px; border-bottom: 1px solid var(--cl-line); background: color-mix(in srgb, #d29922 14%, transparent); }
.cl-grow { flex: 1; min-width: 0; }
.cl-editor { flex: 1; min-height: 0; position: relative; }
.cl-editor .cm-editor { position: absolute; inset: 0; }
.cl-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 24px; text-align: center; }
.cl-empty h2 { font-size: 15px; margin: 0; }
.cl-kbd { padding: 0 5px; font-size: 11px; border: 1px solid var(--cl-line); border-radius: 4px; }
.cl-status { display: flex; align-items: center; gap: 14px; flex-shrink: 0; padding: 3px 12px; border-top: 1px solid var(--cl-line); font-size: 11.5px; color: var(--cl-muted); white-space: nowrap; overflow: hidden; }
.cl-quick { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 5; width: min(560px, calc(100% - 24px)); padding: 6px; border: 1px solid var(--cl-line); border-radius: 9px; background: var(--cl-surface, Canvas); box-shadow: 0 8px 26px rgb(0 0 0 / .28); }
.cl-quick-list { max-height: 320px; overflow-y: auto; margin-top: 6px; }
.cl-quick .cl-pick { flex-direction: row; gap: 10px; align-items: baseline; padding: 4px 8px; }
.cl-quick .cl-pick[aria-selected="true"] { background: var(--cl-selected); }
.cl-compact .cl-side { width: 100%; border-right: none; }
.cl-compact .cl-side[data-hidden="true"], .cl-compact .cl-main[data-hidden="true"] { display: none; }
.cl-compact .cl-status { gap: 10px; }
.cl-files-btn { flex-shrink: 0; padding: 0 10px; border: none; border-right: 1px solid var(--cl-line); background: none; color: inherit; font: inherit; cursor: pointer; }
.cl-files-btn:hover { background: var(--cl-hover); }
`;

export const inject = ["react", "pages", "panels", "host"];

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const workspace = createWorkspace(ctx.host);

  // Lives outside React so open files survive leaving and returning to the page.
  const store = {
    root: null,
    files: [],
    status: null,
    expanded: new Set(),
    tabs: [],
    active: null,
    notice: "",
    owner: null,
    version: 0,
  };
  const listeners = new Set();
  const changed = () => {
    store.version += 1;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const useStore = () =>
    React.useSyncExternalStore(subscribe, () => store.version);

  let view = null;
  let dark = false;
  const activeTab = () => store.tabs.find((tab) => tab.path === store.active);

  function editorState(tab, doc) {
    const key = languageKey(tab.path);
    return EditorState.create({
      doc,
      extensions: [
        basicSetup,
        keymap.of([
          indentWithTab,
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void saveTab(tab);
              return true;
            },
          },
        ]),
        languages[key] ? languages[key]() : [],
        syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle),
        EditorView.theme(
          {
            "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent" },
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
              lineHeight: "1.55",
            },
            ".cm-gutters": {
              backgroundColor: "transparent",
              border: "none",
              color: "color-mix(in srgb, currentColor 45%, transparent)",
            },
            ".cm-activeLine, .cm-activeLineGutter": {
              backgroundColor: "color-mix(in srgb, currentColor 5%, transparent)",
            },
            ".cm-cursor": { borderLeftColor: "currentColor" },
          },
          { dark },
        ),
        EditorView.updateListener.of((update) => {
          tab.state = update.state;
          if (update.docChanged) {
            const dirty = !update.state.doc.eq(tab.saved);
            if (dirty !== tab.dirty) {
              tab.dirty = dirty;
              changed();
            }
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            tab.cursor = { line: line.number, column: head - line.from + 1 };
            changed();
          }
        }),
      ],
    });
  }

  function loadText(tab, file) {
    tab.kind = "text";
    tab.disk = file.text;
    tab.crlf = file.crlf;
    tab.state = editorState(tab, file.text);
    tab.saved = tab.state.doc;
    tab.dirty = false;
    tab.conflict = false;
    tab.error = "";
    tab.cursor = { line: 1, column: 1 };
  }

  async function refreshStatus() {
    if (!store.root) return;
    try {
      const root = store.root;
      const [files, status] = await Promise.all([
        workspace.listFiles(root),
        workspace.status(root),
      ]);
      if (root !== store.root) return;
      store.files = files;
      store.status = status;
      changed();
    } catch (error) {
      store.notice = error.message;
      changed();
    }
  }

  /** Pick up edits made elsewhere, such as by an agent. */
  async function syncTabs() {
    for (const tab of store.tabs) {
      if (tab.kind !== "text") continue;
      try {
        const file = await workspace.read(store.root, tab.path);
        if (file.kind !== "text" || file.text === tab.disk) continue;
        if (tab.dirty) tab.conflict = true;
        else {
          loadText(tab, file);
          if (tab.path === store.active && view) view.setState(tab.state);
        }
        changed();
      } catch {
        tab.conflict = tab.dirty;
      }
    }
  }

  async function openPath(path) {
    for (const folder of ancestors(path)) store.expanded.add(folder);
    const held = store.tabs.find((tab) => tab.path === path);
    store.active = path;
    if (held) {
      changed();
      return;
    }
    const tab = { path, kind: "loading", dirty: false, conflict: false, error: "" };
    store.tabs.push(tab);
    changed();
    try {
      const file = await workspace.read(store.root, path);
      if (file.kind === "text") loadText(tab, file);
      else tab.kind = file.kind;
    } catch (error) {
      tab.kind = "error";
      tab.error = error.message;
    }
    changed();
  }

  async function saveTab(tab, force = false) {
    if (tab.kind !== "text" || tab.saving) return;
    tab.saving = true;
    tab.error = "";
    changed();
    try {
      if (!force) {
        const disk = await workspace.read(store.root, tab.path).catch(() => null);
        if (disk && (disk.kind !== "text" || disk.text !== tab.disk)) {
          tab.conflict = true;
          return;
        }
      }
      const doc = tab.state.doc;
      const text = doc.toString();
      await workspace.write(store.root, tab.path, text, tab.crlf);
      tab.saved = doc;
      tab.disk = text;
      tab.dirty = !tab.state.doc.eq(doc);
      tab.conflict = false;
      await refreshStatus();
    } catch (error) {
      tab.error = error.message;
    } finally {
      tab.saving = false;
      changed();
    }
  }

  async function reloadTab(tab) {
    const file = await workspace.read(store.root, tab.path);
    if (file.kind !== "text") return;
    loadText(tab, file);
    if (tab.path === store.active && view) view.setState(tab.state);
    changed();
  }

  function closeTab(tab) {
    const index = store.tabs.indexOf(tab);
    store.tabs.splice(index, 1);
    if (store.active === tab.path) {
      const next = store.tabs[Math.min(index, store.tabs.length - 1)];
      store.active = next ? next.path : null;
    }
    changed();
  }

  async function openRoot(input) {
    const root = await workspace.openFolder(input);
    store.root = root;
    store.tabs = [];
    store.active = null;
    store.expanded = new Set();
    store.notice = "";
    store.files = [];
    store.status = null;
    saveRecent([root, ...readRecent().filter((item) => item !== root)].slice(0, 5));
    changed();
    await refreshStatus();
  }

  function leaveRoot() {
    store.root = null;
    store.tabs = [];
    store.active = null;
    changed();
  }

  function Welcome() {
    const [repositories, setRepositories] = React.useState(null);
    const [path, setPath] = React.useState("");
    const [error, setError] = React.useState("");
    const recent = React.useMemo(readRecent, []);
    React.useEffect(() => {
      let live = true;
      workspace.listRepositories().then(
        (items) => live && setRepositories(items),
        () => live && setRepositories([]),
      );
      return () => {
        live = false;
      };
    }, []);
    const open = (value) => {
      setError("");
      openRoot(value).catch((failure) => setError(failure.message));
    };
    const pick = (item) =>
      h(
        "button",
        { key: item, type: "button", className: "cl-pick", onClick: () => open(item) },
        h("span", { className: "cl-oneline" }, baseName(item).replace(/^[0-9a-f]{64}--/, "")),
        h("span", { className: "cl-oneline cl-muted", style: { fontSize: 11.5 } }, item),
      );
    if (!workspace.supported)
      return h(
        "div",
        { className: "cl-welcome" },
        h("h1", null, "Code Lite"),
        h("p", null, "Code Lite needs the Buzz desktop app."),
      );
    return h(
      "div",
      { className: "cl-welcome" },
      h("h1", null, "Code Lite"),
      h("p", { className: "cl-muted", style: { margin: 0 } }, "Open a local git repository to start editing."),
      h(
        "form",
        {
          className: "cl-form",
          onSubmit: (event) => {
            event.preventDefault();
            if (path.trim()) open(path);
          },
        },
        h("input", {
          className: "cl-input",
          placeholder: "~/code/my-project",
          "aria-label": "Repository folder",
          value: path,
          onChange: (event) => setPath(event.target.value),
        }),
        h("button", { type: "submit", className: "cl-btn" }, "Open"),
      ),
      error ? h("p", { className: "cl-alert", role: "alert" }, error) : null,
      recent.length
        ? h(React.Fragment, null, h("h2", null, "Recent"), recent.map(pick))
        : null,
      h("h2", null, "Buzz repositories on this computer"),
      repositories === null
        ? h("p", { className: "cl-muted", role: "status" }, "Looking…")
        : repositories.length
          ? repositories.map(pick)
          : h("p", { className: "cl-muted" }, "None found in ~/.buzz/REPOS."),
    );
  }

  function Tree() {
    const rows = React.useMemo(
      () => treeRows(store.files, store.expanded),
      [store.version],
    );
    const changes = store.status ? store.status.changes : new Map();
    const folders = React.useMemo(() => changedFolders(changes), [changes]);
    return h(
      "div",
      { className: "cl-tree", role: "tree", "aria-label": "Files" },
      rows.map((row) =>
        h(
          "div",
          {
            key: row.path,
            className: "cl-row",
            "data-active": row.path === store.active,
            style: { paddingLeft: 4 + row.depth * 12 },
          },
          h(
            "button",
            {
              type: "button",
              className: "cl-row-btn",
              "aria-expanded": row.type === "folder" ? row.open : undefined,
              title: row.path,
              onClick: () => {
                if (row.type === "file") {
                  void openPath(row.path);
                  return;
                }
                if (row.open) store.expanded.delete(row.path);
                else store.expanded.add(row.path);
                changed();
              },
            },
            h("span", { className: "cl-twist" }, row.type === "folder" ? (row.open ? "▾" : "▸") : ""),
            h("span", { className: "cl-oneline" }, row.name),
            row.type === "file" && changes.has(row.path)
              ? h("span", { className: "cl-mark", "data-code": changes.get(row.path) }, changes.get(row.path))
              : row.type === "folder" && folders.has(row.path)
                ? h("span", { className: "cl-dot", "aria-label": "Contains changes" })
                : null,
          ),
        ),
      ),
    );
  }

  function Editor() {
    const host = React.useRef(null);
    React.useEffect(() => {
      dark = pageIsDark(host.current);
      view = new EditorView({ parent: host.current });
      return () => {
        view.destroy();
        view = null;
      };
    }, []);
    const tab = activeTab();
    React.useEffect(() => {
      if (view && tab && tab.kind === "text" && view.state !== tab.state) {
        view.setState(tab.state);
        view.focus();
      }
    }, [tab, tab && tab.kind]);
    return h("div", {
      ref: host,
      className: "cl-editor",
      style: { display: tab && tab.kind === "text" ? "block" : "none" },
    });
  }

  function TabNotice({ tab }) {
    if (tab.kind === "text") return null;
    const content = {
      loading: ["Opening…", ""],
      binary: ["This file can't be edited as text", "It looks like a binary file."],
      large: ["This file is too large to edit here", "Code Lite opens files up to 5 MB."],
      error: ["This file couldn't be opened", tab.error],
    }[tab.kind];
    return h(
      "div",
      { className: "cl-empty", role: tab.kind === "error" ? "alert" : "status" },
      h("h2", null, content[0]),
      content[1] ? h("p", { className: "cl-muted", style: { margin: 0 } }, content[1]) : null,
    );
  }

  function Banners({ tab, closing, setClosing }) {
    if (closing && closing === tab)
      return h(
        "div",
        { className: "cl-banner", role: "alert" },
        h("span", { className: "cl-grow" }, `Save changes to ${baseName(tab.path)}?`),
        h(
          "button",
          {
            type: "button",
            className: "cl-btn",
            onClick: async () => {
              await saveTab(tab);
              setClosing(null);
              if (!tab.dirty) closeTab(tab);
            },
          },
          "Save",
        ),
        h(
          "button",
          {
            type: "button",
            className: "cl-btn",
            onClick: () => {
              setClosing(null);
              closeTab(tab);
            },
          },
          "Don't save",
        ),
        h("button", { type: "button", className: "cl-btn", onClick: () => setClosing(null) }, "Cancel"),
      );
    if (tab.conflict)
      return h(
        "div",
        { className: "cl-banner", role: "alert" },
        h("span", { className: "cl-grow" }, "This file changed on disk since you opened it."),
        h("button", { type: "button", className: "cl-btn", onClick: () => void reloadTab(tab) }, "Use disk version"),
        h("button", { type: "button", className: "cl-btn", onClick: () => void saveTab(tab, true) }, "Overwrite with mine"),
      );
    if (tab.error && tab.kind === "text")
      return h(
        "div",
        { className: "cl-banner", role: "alert" },
        h("span", { className: "cl-grow" }, `Couldn't save: ${tab.error}`),
        h("button", { type: "button", className: "cl-btn", onClick: () => void saveTab(tab) }, "Try again"),
      );
    return null;
  }

  function QuickOpen({ close }) {
    const [query, setQuery] = React.useState("");
    const [active, setActive] = React.useState(0);
    const results = React.useMemo(() => matchFiles(store.files, query), [query]);
    React.useEffect(() => setActive(0), [query]);
    const choose = (path) => {
      close();
      void openPath(path);
    };
    return h(
      "div",
      { className: "cl-quick", role: "dialog", "aria-label": "Go to file" },
      h("input", {
        autoFocus: true,
        className: "cl-input",
        placeholder: "Go to file",
        "aria-label": "Go to file",
        value: query,
        onChange: (event) => setQuery(event.target.value),
        onBlur: (event) => {
          if (!event.relatedTarget) close();
        },
        onKeyDown: (event) => {
          if (event.key === "Escape") close();
          else if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((value) => Math.min(value + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => Math.max(value - 1, 0));
          } else if (event.key === "Enter" && results[active]) choose(results[active]);
        },
      }),
      h(
        "div",
        { className: "cl-quick-list", role: "listbox" },
        results.map((path, index) =>
          h(
            "button",
            {
              key: path,
              type: "button",
              role: "option",
              className: "cl-pick",
              "aria-selected": index === active,
              onClick: () => choose(path),
            },
            h("span", null, baseName(path)),
            h("span", { className: "cl-oneline cl-muted", style: { fontSize: 11.5 } }, path),
          ),
        ),
      ),
    );
  }

  function Workbench({ compact }) {
    const [quick, setQuick] = React.useState(false);
    const [showFiles, setShowFiles] = React.useState(!store.active);
    const [closing, setClosing] = React.useState(null);
    const tab = activeTab();
    const dirty = store.tabs.filter((item) => item.dirty);
    const status = store.status;
    const filesVisible = compact && showFiles;
    React.useEffect(() => {
      if (store.active) setShowFiles(false);
    }, [store.active]);
    React.useEffect(() => {
      const onFocus = () => {
        void refreshStatus();
        void syncTabs();
      };
      addEventListener("focus", onFocus);
      return () => removeEventListener("focus", onFocus);
    }, []);
    return h(
      "div",
      {
        style: { display: "contents" },
        onKeyDown: (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
            event.preventDefault();
            setQuick(true);
          }
        },
      },
      h(
        "div",
        { className: "cl-body" },
        h(
          "aside",
          { className: "cl-side", "data-hidden": compact && !showFiles },
          h(
            "div",
            { className: "cl-side-head" },
            h("span", { className: "cl-side-title cl-oneline", title: store.root }, baseName(store.root).replace(/^[0-9a-f]{64}--/, "")),
            h("button", { type: "button", className: "cl-icon-btn", title: "Go to file (⌘P)", "aria-label": "Go to file", onClick: () => setQuick(true) }, "⌕"),
            h(
              "button",
              {
                type: "button",
                className: "cl-icon-btn",
                title: "Refresh",
                "aria-label": "Refresh",
                onClick: () => {
                  void refreshStatus();
                  void syncTabs();
                },
              },
              "↻",
            ),
            h(
              "button",
              {
                type: "button",
                className: "cl-icon-btn",
                title: dirty.length ? "Save or close your changed files first" : "Close folder",
                "aria-label": "Close folder",
                disabled: dirty.length > 0,
                onClick: leaveRoot,
              },
              "×",
            ),
          ),
          h(Tree),
          compact && store.tabs.length
            ? h(
                "div",
                { style: { padding: 8, borderTop: "1px solid var(--cl-line)" } },
                h(
                  "button",
                  { type: "button", className: "cl-btn", onClick: () => setShowFiles(false) },
                  "Back to editor",
                ),
              )
            : null,
        ),
        h(
          "section",
          { className: "cl-main", "data-hidden": filesVisible },
          store.tabs.length
            ? h(
                "div",
                { className: "cl-tabs", role: "tablist" },
                compact
                  ? h(
                      "button",
                      {
                        type: "button",
                        className: "cl-files-btn",
                        onClick: () => setShowFiles(true),
                      },
                      "Files",
                    )
                  : null,
                store.tabs.map((item) =>
                  h(
                    "div",
                    { key: item.path, className: "cl-tab", "data-active": item.path === store.active, title: item.path },
                    h(
                      "button",
                      {
                        type: "button",
                        role: "tab",
                        "aria-selected": item.path === store.active,
                        className: "cl-tab-open cl-oneline",
                        onClick: () => {
                          store.active = item.path;
                          changed();
                        },
                      },
                      baseName(item.path),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        className: "cl-tab-close",
                        "aria-label": item.dirty ? `Close ${baseName(item.path)}, unsaved` : `Close ${baseName(item.path)}`,
                        onClick: () => {
                          if (!item.dirty) {
                            closeTab(item);
                            return;
                          }
                          store.active = item.path;
                          setClosing(item);
                          changed();
                        },
                      },
                      item.dirty ? "●" : "×",
                    ),
                  ),
                ),
              )
            : null,
          tab ? h(Banners, { tab, closing, setClosing }) : null,
          tab ? h(TabNotice, { tab }) : null,
          !tab
            ? h(
                "div",
                { className: "cl-empty" },
                h("h2", null, "No file open"),
                h("p", { className: "cl-muted", style: { margin: 0 } }, "Pick a file from the tree, or press ", h("span", { className: "cl-kbd" }, "⌘P"), " to find one."),
                compact
                  ? h("button", { type: "button", className: "cl-btn", onClick: () => setShowFiles(true) }, "Show files")
                  : null,
              )
            : null,
          h(Editor),
        ),
      ),
      h(
        "footer",
        { className: "cl-status" },
        status ? h("span", null, `⎇ ${status.branch || "no branch"}`) : null,
        status && status.ahead ? h("span", null, `↑${status.ahead}`) : null,
        status && status.behind ? h("span", null, `↓${status.behind}`) : null,
        status ? h("span", null, `${status.changes.size} changed`) : null,
        store.notice ? h("span", { className: "cl-oneline", role: "alert" }, store.notice) : null,
        h("span", { className: "cl-grow" }),
        tab && tab.saving ? h("span", { role: "status" }, "Saving…") : null,
        tab && tab.kind === "text" && !tab.saving && tab.dirty ? h("span", null, "Unsaved") : null,
        tab && tab.kind === "text" && tab.cursor ? h("span", null, `Ln ${tab.cursor.line}, Col ${tab.cursor.column}`) : null,
        !compact && tab && tab.kind === "text" && tab.crlf ? h("span", null, "CRLF") : null,
        !compact && tab ? h("span", null, languageLabel(languageKey(tab.path))) : null,
      ),
      quick ? h(QuickOpen, { close: () => setQuick(false) }) : null,
    );
  }

  /** One editor at a time, so two views can't disagree about unsaved text. */
  function Surface() {
    useStore();
    const ref = React.useRef(null);
    const id = React.useRef({}).current;
    const [compact, setCompact] = React.useState(false);
    const layout = React.useLayoutEffect || React.useEffect;
    layout(() => {
      const element = ref.current;
      if (!element || typeof ResizeObserver === "undefined") return undefined;
      const measure = (width) => setCompact(width < COMPACT_WIDTH);
      measure(element.getBoundingClientRect().width);
      const observer = new ResizeObserver((entries) =>
        measure(entries[0].contentRect.width),
      );
      observer.observe(element);
      return () => observer.disconnect();
    }, []);
    React.useEffect(() => {
      store.owner = id;
      changed();
      return () => {
        if (store.owner === id) {
          store.owner = null;
          changed();
        }
      };
    }, []);
    const elsewhere = store.owner !== null && store.owner !== id;
    return h(
      "div",
      { ref, "data-code-lite": "", className: compact ? "cl-compact" : undefined },
      h("style", null, CSS),
      elsewhere
        ? h(
            "div",
            { className: "cl-empty" },
            h("h2", null, "Code Lite is open in another view"),
            h(
              "button",
              {
                type: "button",
                className: "cl-btn",
                onClick: () => {
                  store.owner = id;
                  changed();
                },
              },
              "Use it here",
            ),
          )
        : store.root
          ? h(Workbench, { compact })
          : h(Welcome),
    );
  }

  const icon = `data:image/svg+xml;base64,${btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>',
  )}`;

  function ChannelButton({ toggle, pressed }) {
    return h(
      "button",
      {
        type: "button",
        "aria-label": "Toggle Code Lite",
        "aria-expanded": pressed,
        title: "Code Lite",
        onClick: () => toggle(PANEL_TARGET),
        style: {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          padding: 0,
          border: "none",
          borderRadius: 6,
          background: pressed
            ? "color-mix(in srgb, currentColor 12%, transparent)"
            : "transparent",
          color: "inherit",
          cursor: "pointer",
        },
      },
      h(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: 16,
          height: 16,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
        },
        h("path", { d: "m8 7-5 5 5 5M16 7l5 5-5 5" }),
      ),
    );
  }

  ctx.pages.register({
    id: "code",
    title: "Code",
    layout: "workspace",
    primary: true,
    icon,
    component: Surface,
  });
  ctx.panels.register({
    id: "code-panel",
    title: "Code",
    matches: () => false,
    launcher: { icon, target: PANEL_TARGET },
    channelLauncher: ChannelButton,
    channelPlacement: "tab",
    deferUntilShown: true,
    component: Surface,
  });
}
