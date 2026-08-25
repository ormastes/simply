import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
import { linkPlan, readConfiguredDocRoot } from "./host_links.js";
import { surfaceNames } from "./host_surface.js";
function commandDoctor(hostRoot) {
  const root = resolve(hostRoot || resolve(moduleRoot, "..", ".."));
  let failures = 0;
  for (const surface of surfaceNames) {
    const source = join(moduleRoot, "doc/00_llm_process", surface);
    if (!existsSync(source)) {
      failures += 1;
      console.log(`missing_source doc/00_llm_process/${surface}`);
    } else {
      console.log(`source_ok doc/00_llm_process/${surface}`);
    }
  }

  for (const item of linkPlan(hostRoot)) {
    if (!existsSync(item.target)) {
      console.log(`target_missing ${item.surface}`);
      continue;
    }
    const stat = lstatSync(item.target);
    const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file";
    console.log(`target_${kind} ${item.surface}`);
  }

  const docRoot = readConfiguredDocRoot(root);
  const docLink = join(root, ".spipe/doc");
  const docTarget = relative(dirname(docLink), join(root, docRoot));
  const hostChecks = [
    ["compatibility_submodule", join(root, ".spipe/spipe"), "exists"],
    ["example_project_submodule", join(root, "examples/spipe"), "exists"],
    ["spipe_project_link", join(root, ".spipe/spipe_project"), relative(join(root, ".spipe"), join(root, "examples/spipe"))],
    ["doc_link", docLink, docTarget],
    ["domain_expert_link", join(root, ".spipe/domain_expert"), relative(join(root, ".spipe"), join(root, "examples/spipe/doc/00_llm_process/domain_expert"))],
    ["template_link", join(root, ".spipe/template"), relative(join(root, ".spipe"), join(root, "examples/spipe/doc/00_llm_process/template"))],
    ["spipe_docs_link", join(root, ".spipe/spipe_docs"), relative(join(root, ".spipe"), join(root, "examples/spipe/doc/00_llm_process/spipe"))],
    ["project_expert_spipe_link", join(root, ".spipe/project_expert/spipe"), relative(join(root, ".spipe/project_expert"), join(root, "examples/spipe/doc/00_llm_process/project_expert/simple"))],
    ["tool_expert_spipe_link", join(root, ".spipe/tool_expert/spipe_submodule"), relative(join(root, ".spipe/tool_expert"), join(root, "examples/spipe/doc/00_llm_process/tool_expert/spipe_submodule"))]
  ];
  for (const [name, path, expected] of hostChecks) {
    if (!existsSync(path)) {
      failures += 1;
      console.log(`host_missing ${name} ${path}`);
      continue;
    }
    const stat = lstatSync(path);
    if (expected !== "exists") {
      if (!stat.isSymbolicLink()) {
        failures += 1;
        console.log(`host_not_link ${name} ${path}`);
        continue;
      }
      const current = readlinkSync(path);
      if (current !== expected) {
        failures += 1;
        console.log(`host_bad_link ${name} expected=${expected} actual=${current}`);
        continue;
      }
    }
    console.log(`host_ok ${name}`);
  }

  console.log(failures === 0 ? "spipe_doctor=pass" : `spipe_doctor=fail missing=${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

export function runHostDoctor(command, args = []) {
  if (command !== "doctor") return false;
  commandDoctor(args[0]);
  return true;
}
