import { mkdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const directory = new URL("../.artifacts/backups/", import.meta.url);
await mkdir(directory, { recursive: true });

function dump(name, args) {
  const file = new URL(`${stamp}-${name}.sql`, directory);
  const command = process.platform === "win32" ? "supabase.exe" : "supabase";
  const result = spawnSync(command, ["db", "dump", "--linked", "--file", fileURLToPath(file), ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Supabase ${name} backup failed.`);
  return file;
}

const roles = dump("roles", ["--role-only"]);
const schema = dump("schema", []);
const data = dump("data", [
  "--data-only",
  "--use-copy",
  "--exclude",
  "storage.buckets_vectors",
  "--exclude",
  "storage.vector_indexes",
]);
for (const file of [roles, schema, data]) {
  const info = await stat(file);
  if (info.size === 0) throw new Error(`Empty backup: ${file.pathname}`);
  console.log(`${fileURLToPath(file)} (${info.size} bytes)`);
}
