import { CommandResult } from "../core/result.js";
import { runHostDoctor } from "./host_doctor.js";
import { runHostLinks } from "./host_links.js";
import { runHostSurface } from "./host_surface.js";

export function runHostCommand(command, args = []) {
  const handled = runHostSurface(command, args)
    || runHostLinks(command, args)
    || runHostDoctor(command, args);
  return handled ? CommandResult.handled(command) : CommandResult.unhandled(command);
}
