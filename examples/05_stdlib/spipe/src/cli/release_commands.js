import { createReleasePlan } from "../release/planner.js";

const commandOperations = Object.freeze({
  "release-session-plan": "isolated-session",
  "release-beta-backport-plan": "beta-backport",
  "release-candidate-plan": "candidate",
  "release-promotion-plan": "promotion"
  ,"release-main-fix-discovery-plan": "main-fix-discovery"
  ,"release-forward-port-plan": "forward-port"
});

export function runReleaseCommand(command, args) {
  const operation = commandOperations[command];
  if (!operation) return { handled: false };
  if (args.length !== 1) throw new Error(`${command} requires exactly one JSON object argument`);
  let input;
  try {
    input = JSON.parse(args[0]);
  } catch {
    throw new Error(`${command} input must be valid JSON`);
  }
  console.log(JSON.stringify(createReleasePlan(operation, input), null, 2));
  return { handled: true };
}
