import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function rel(path) {
  return path.replace(`${moduleRoot}/`, "");
}

function listDirs(root) {
  const abs = join(moduleRoot, root);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export const surfaceNames = [
  "skill_command",
  "spipe",
  "template",
  "project_expert",
  "domain_expert",
  "tool_expert"
];

function commandInfo() {
  console.log(`spipe_module=${moduleRoot}`);
  console.log(`spipe_skill=${join(moduleRoot, "doc/00_llm_process/spipe/skill.md")}`);
  for (const surface of surfaceNames) console.log(`surface=doc/00_llm_process/${surface}`);
}

function commandExperts() {
  const roots = {
    project_expert: "doc/00_llm_process/project_expert",
    domain_expert: "doc/00_llm_process/domain_expert",
    tool_expert: "doc/00_llm_process/tool_expert"
  };
  for (const [name, root] of Object.entries(roots)) {
    const dirs = listDirs(root);
    console.log(`${name}=${dirs.length ? dirs.join(",") : "(none)"}`);
  }
}

function commandSkill() {
  const path = join(moduleRoot, "doc/00_llm_process/spipe/skill.md");
  process.stdout.write(readFileSync(path, "utf8"));
}

export function runHostSurface(command) {
  switch (command) {
    case "info": commandInfo(); break;
    case "experts": commandExperts(); break;
    case "skill": commandSkill(); break;
    default: return false;
  }
  return true;
}
