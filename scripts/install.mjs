#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const skillSource = path.join(repoRoot, "skills", "codex-dsh-bridge");
const pluginSource = path.join(repoRoot, "bridge", "dsh-plugin", "index.mjs");
const options = parseArgs(process.argv.slice(2));
const target = String(options.target ?? "Both").toLowerCase();
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");

if (!new Set(["codex", "dsh", "both"]).has(target)) {
  fail("--target must be Codex, DSH, or Both");
}
if (!fs.existsSync(skillSource)) fail(`Skill source not found: ${skillSource}`);
if (!fs.existsSync(pluginSource)) fail(`DSH plugin not found: ${pluginSource}`);

if (target === "codex" || target === "both") {
  const codexHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
  installSkill(path.join(codexHome, "skills"));
}
if (target === "dsh" || target === "both") {
  const agentsHome = process.env.AGENTS_HOME ? path.resolve(process.env.AGENTS_HOME) : path.join(os.homedir(), ".agents");
  installSkill(path.join(agentsHome, "skills"));
}
if (!options["skip-dsh-plugin"]) installDshPlugin();

console.log("Installation complete. Restart Codex and the DSH Web process.");

function installSkill(parent) {
  const destination = path.join(parent, "codex-dsh-bridge");
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(destination)) {
    const backup = `${destination}.backup-${stamp}`;
    fs.renameSync(destination, backup);
    console.log(`Backed up existing skill to ${backup}`);
  }
  fs.cpSync(skillSource, destination, { recursive: true, errorOnExist: true });
  console.log(`Installed skill: ${destination}`);
}

function installDshPlugin() {
  const dshHome = process.env.DSH_HOME ? path.resolve(process.env.DSH_HOME) : path.join(os.homedir(), ".dsh");
  const profileDir = path.join(dshHome, "profiles", "web");
  const patchPath = path.join(profileDir, "cordis.patch.yml");
  fs.mkdirSync(profileDir, { recursive: true });
  const existing = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
  if (/^\s*-\s+id:\s+codex-appserver-bridge\s*$/m.test(existing)) {
    console.log(`DSH plugin entry already exists: ${patchPath}`);
    return;
  }
  if (existing) {
    const backup = `${patchPath}.backup-${stamp}`;
    fs.copyFileSync(patchPath, backup);
    console.log(`Backed up existing DSH patch to ${backup}`);
  }
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  const entry = [
    "- insert:",
    "    - id: codex-appserver-bridge",
    `      name: '${pathToFileURL(pluginSource).href.replaceAll("'", "''")}'`,
    "",
  ].join("\n");
  fs.writeFileSync(patchPath, `${existing}${separator}${entry}`, "utf8");
  console.log(`Added persistent DSH plugin: ${patchPath}`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      result[key] = true;
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
