import { CommandResult } from "../core/result.js";
import { runFineTuneRequirements } from "./fine_tune_requirements.js";
import { runFineTuneSetup } from "./fine_tune_setup.js";
import { runFineTuneStatus } from "./fine_tune_status.js";

export function runFineTuneCommand(command, args = []) {
  const handled = runFineTuneSetup(command, args)
    || runFineTuneRequirements(command, args)
    || runFineTuneStatus(command, args);
  return handled ? CommandResult.handled(command) : CommandResult.unhandled(command);
}
