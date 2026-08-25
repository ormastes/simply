import { existsSync, lstatSync, mkdirSync, readlinkSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
import { surfaceNames } from "./host_surface.js";
export function linkPlan(hostRoot = resolve(moduleRoot, "..", "..")) {
  const root = resolve(hostRoot);
  const docRoot = readConfiguredDocRoot(root);
  return surfaceNames.map((surface) => ({
    surface: `${docRoot}/${surface}`,
    source: join(moduleRoot, "doc/00_llm_process", surface),
    target: join(root, docRoot, surface)
  }));
}

function commandLinkPlan(hostRoot) {
  for (const item of linkPlan(hostRoot)) {
    console.log(`${item.surface}`);
    console.log(`  source=${item.source}`);
    console.log(`  target=${item.target}`);
  }
}

export function readConfiguredDocRoot(hostRoot) {
  const configPath = join(resolve(hostRoot), ".spipe/config.sdn");
  if (!existsSync(configPath)) return "doc/llm_process";
  const content = readFileSync(configPath, "utf8");
  const match = content.match(/^\s*host_process_doc:\s*([^\s#]+)\s*$/m);
  return match ? match[1] : "doc/llm_process";
}

function commandDocRoot(hostRoot = resolve(moduleRoot, "..", "..")) {
  console.log(readConfiguredDocRoot(hostRoot));
}

function commandDocLink(hostRoot = resolve(moduleRoot, "..", ".."), docRoot) {
  const root = resolve(hostRoot);
  const configuredDocRoot = docRoot || readConfiguredDocRoot(root);
  const docAbs = join(root, configuredDocRoot);
  const linkPath = join(root, ".spipe/doc");

  if (!existsSync(docAbs)) {
    console.error(`spipe doc-link: doc root does not exist: ${configuredDocRoot}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(linkPath), { recursive: true });
  const nextTarget = relative(dirname(linkPath), docAbs);
  if (existsSync(linkPath) || lstatSync(dirname(linkPath)).isDirectory()) {
    if (existsSync(linkPath)) {
      const stat = lstatSync(linkPath);
      if (!stat.isSymbolicLink()) {
        console.error(`spipe doc-link: refusing to replace non-symlink: ${linkPath}`);
        process.exitCode = 1;
        return;
      }
      const current = readlinkSync(linkPath);
      if (current === nextTarget) {
        console.log(`doc_link=ok ${linkPath} -> ${current}`);
        return;
      }
      unlinkSync(linkPath);
    }
  }

  symlinkSync(nextTarget, linkPath);
  console.log(`doc_link=linked ${linkPath} -> ${nextTarget}`);
}

export function runHostLinks(command, args = []) {
  const arg = args[0];
  switch (command) {
    case "link-plan": commandLinkPlan(arg); break;
    case "doc-root": commandDocRoot(arg); break;
    case "doc-link": commandDocLink(arg, args[1]); break;
    default: return false;
  }
  return true;
}
