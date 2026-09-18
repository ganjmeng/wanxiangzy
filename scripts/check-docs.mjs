#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".next-dev",
  ".vercel",
  "coverage",
  "node_modules",
  "output",
  "outputs",
  "test-results",
  "tmp",
]);

const errors = [];
const markdownFiles = await findMarkdownFiles(ROOT);
const scripts = Object.keys(JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).scripts || {});
const scriptNames = new Set(scripts);

for (const file of markdownFiles) {
  const text = await readFile(file, "utf8");
  checkCodeFences(file, text);
  await checkLocalLinks(file, text);
  checkNpmCommands(file, text, scriptNames);
}

await checkDocumentationIndex();
await checkRequiredEntrypoints();

if (errors.length > 0) {
  console.error(`[check-docs] Found ${errors.length} documentation issue(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`[check-docs] OK: ${markdownFiles.length} Markdown files validated.`);

async function findMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function checkCodeFences(file, text) {
  const fenceCount = text.split(/\r?\n/).filter((line) => line.trimStart().startsWith("```")).length;
  if (fenceCount % 2 !== 0) {
    errors.push(`${relative(file)} has an unclosed fenced code block`);
  }
}

async function checkLocalLinks(file, text) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const rawTarget = match[1].trim();
    if (!rawTarget || rawTarget.startsWith("#") || rawTarget.startsWith("mailto:")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) continue;

    const pathPart = rawTarget.split("#", 1)[0];
    if (!pathPart) continue;

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(pathPart);
    } catch {
      errors.push(`${relative(file)} contains an invalid URL-encoded link: ${rawTarget}`);
      continue;
    }

    const targetPath = path.resolve(path.dirname(file), decodedTarget);
    try {
      await stat(targetPath);
    } catch {
      errors.push(`${relative(file)} links to missing path: ${rawTarget}`);
    }
  }
}

function checkNpmCommands(file, text, scriptNames) {
  const commandPattern = /npm run ([a-zA-Z0-9:_-]+)/g;
  for (const match of text.matchAll(commandPattern)) {
    if (!scriptNames.has(match[1])) {
      errors.push(`${relative(file)} documents unknown npm script: ${match[1]}`);
    }
  }
}

async function checkDocumentationIndex() {
  const docsDir = path.join(ROOT, "docs");
  const indexPath = path.join(docsDir, "README.md");
  const indexText = await readFile(indexPath, "utf8");
  const docs = (await readdir(docsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();

  for (const doc of docs) {
    if (!indexText.includes(`](${doc})`)) {
      errors.push(`docs/README.md does not index docs/${doc}`);
    }
  }
}

async function checkRequiredEntrypoints() {
  for (const file of ["README.md", "README.zh-CN.md"]) {
    const text = await readFile(path.join(ROOT, file), "utf8");
    if (!text.includes("](docs/README.md)")) {
      errors.push(`${file} must link to docs/README.md`);
    }
  }
}

function relative(file) {
  return path.relative(ROOT, file) || ".";
}
