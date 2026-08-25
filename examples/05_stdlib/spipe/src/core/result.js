import { stableJson, stableSdn } from "../format/stable.js";

export class CommandResult {
  constructor(handled, command) {
    this.handled = handled;
    this.command = command ?? "";
    const receipt = { command: this.command, handled: this.handled };
    this.json = stableJson(receipt);
    this.sdn = stableSdn(receipt);
    Object.freeze(this);
  }

  static handled(command) { return new CommandResult(true, command); }
  static unhandled(command) { return new CommandResult(false, command); }
}
