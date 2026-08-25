import { printUsage } from "./usage.js";

export async function runCli(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    printUsage();
    return;
  }
  if (command === "--version" || command === "-v") {
    console.log("0.1.0");
    return;
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
