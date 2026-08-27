import { printUsage } from "./usage.js";
import { releaseCapabilities, releaseContractHash, releaseSchemas } from "../release/contract.js";
import { runReleaseCommand } from "./release_commands.js";

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log("0.2.0");
    return;
  }
  if (command === "release-guide") {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    console.log(readFileSync(join(here, "../../doc/00_llm_process/skill_command/command/release.md"), "utf8"));
    return;
  }
  if (command === "release-capabilities") {
    for (const [name, value] of Object.entries(releaseSchemas)) console.log(`schema.${name}=${value}`);
    for (const [name, value] of Object.entries(releaseCapabilities)) console.log(`capability.${name}=${value}`);
    console.log(`contract.sha256=${releaseContractHash()}`);
    return;
  }
  try {
    const releaseResult = runReleaseCommand(command, args);
    if (releaseResult.handled) return releaseResult;
  } catch (error) {
    console.error(`spipe: ${error.message}`);
    process.exitCode = 2;
    return { handled: true, error: error.message };
  }
  const { runHostCommand } = await import("./host_commands.js");
  const hostResult = runHostCommand(command, args);
  if (hostResult.handled) return hostResult;
  const { runFineTuneCommand } = await import("./fine_tune_commands.js");
  const fineTuneResult = runFineTuneCommand(command, args);
  if (fineTuneResult.handled) return fineTuneResult;

  console.error(`spipe: unknown command: ${command}`);
  printUsage();
  process.exitCode = 2;
  return fineTuneResult;
}
