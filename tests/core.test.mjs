import assert from "node:assert/strict";
import { test } from "node:test";
import { ancestors, changedFolders, decodeFile, encodeText, expandHome, languageKey, listChildren, matchFiles, parseStatus, treeRows } from "../src/core.js";

const paths = ["README.md", "src/app/main.rs", "src/lib.rs", "docs/a.md"];

test("tree lists folders first and only walks open folders", () => {
  assert.deepEqual(listChildren(paths, "").folders.map((f) => f.name), ["docs", "src"]);
  assert.deepEqual(treeRows(paths, new Set()).map((r) => r.name), ["docs", "src", "README.md"]);
  assert.deepEqual(treeRows(paths, new Set(["src"])).map((r) => [r.name, r.depth]), [["docs", 0], ["src", 0], ["app", 1], ["lib.rs", 1], ["README.md", 0]]);
  assert.equal(listChildren(paths, "sr").files.length, 0);
});

test("status parses branches, renames and new repositories", () => {
  const status = parseStatus("## main...origin/main [ahead 2, behind 1]\0 M a.txt\0R  new.txt\0old.txt\0?? u.txt\0");
  assert.equal(status.branch, "main");
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.deepEqual([...status.changes], [["a.txt", "M"], ["new.txt", "R"], ["u.txt", "U"]]);
  assert.equal(parseStatus("## No commits yet on main\0").branch, "main");
  assert.deepEqual([...changedFolders(new Map([["a/b/c.txt", "M"]]))], ["a", "a/b"]);
  assert.deepEqual(ancestors("c.txt"), []);
});

test("decoding keeps text honest", () => {
  const bytes = (text) => new TextEncoder().encode(text);
  assert.equal(decodeFile(bytes("a\nb")).crlf, false);
  assert.equal(decodeFile(bytes("a\r\nb\r\n")).crlf, true);
  assert.equal(decodeFile(bytes("a\r\nb\n")).crlf, false);
  assert.equal(decodeFile(new Uint8Array([0xff, 0xfe])).kind, "binary");
  const bom = decodeFile(bytes("﻿hi"));
  assert.equal(bom.text, "﻿hi");
  assert.equal(encodeText("a\nb\n", true), "a\r\nb\r\n");
});

test("languages and search", () => {
  assert.equal(languageKey("src/app.tsx"), "tsx");
  assert.equal(languageKey("Dockerfile"), "dockerfile");
  assert.equal(languageKey("notes"), "plain");
  assert.equal(matchFiles(paths, "main")[0], "src/app/main.rs");
  assert.equal(matchFiles(paths, "sapm")[0], "src/app/main.rs");
  assert.equal(matchFiles(paths, "zzz").length, 0);
  assert.equal(expandHome("~/x", "/h"), "/h/x");
  assert.equal(expandHome("/x", "/h"), "/x");
});
