#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const excluded = new Set([".git", "dist", "node_modules", "playwright-report", "test-results"]);
const failures = [];

function inspect(relativePath, maxBytes, maxLines) {
  const contents = readFileSync(path.join(root, relativePath), "utf8");
  const bytes = Buffer.byteLength(contents);
  const lines = contents.split(/\r?\n/).length;

  if (bytes > maxBytes) failures.push(`${relativePath}: ${bytes} bytes exceeds ${maxBytes}`);
  if (lines > maxLines) failures.push(`${relativePath}: ${lines} lines exceeds ${maxLines}`);
}

function findAgentFiles(directory, relative = "") {
  const results = [];
  for (const entry of readdirSync(directory)) {
    if (excluded.has(entry)) continue;
    const absolute = path.join(directory, entry);
    const childRelative = path.join(relative, entry);
    if (statSync(absolute).isDirectory()) results.push(...findAgentFiles(absolute, childRelative));
    if (entry === "AGENTS.md") results.push(childRelative);
  }
  return results;
}

inspect("AGENTS.md", 6_000, 60);
inspect("STATE.md", 3_000, 40);
inspect("DECISIONS.md", 8_000, 100);

for (const agentFile of findAgentFiles(root)) {
  if (agentFile !== "AGENTS.md") inspect(agentFile, 16_000, 140);
}

if (failures.length > 0) {
  console.error("Context budget check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Context budget check passed.");
