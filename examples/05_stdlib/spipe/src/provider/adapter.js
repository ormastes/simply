import { CONTRACTS, searchFail } from "../index/contracts.js";
import { healthProbe, validateInitialization, validateInProcessPayload } from "./protocol.js";

export class InProcessSearchProviderAdapter {
  #provider; #state = "new";
  constructor(provider) { this.#provider = provider; }
  initialize(request) {
    if (this.#state !== "new") searchFail("invalid_request", "adapter generation is already initialized");
    this.#state = "initializing";
    try { const result = this.#provider.initialize(request); validateInitialization(result); this.#state = "healthy"; return result; }
    catch (error) { this.#state = "quarantined"; throw error; }
  }
  open(input) { return this.#validatedCall("open", input); }
  apply(input) { return this.#validatedCall("apply", input); }
  publish(input) { this.#requireHealthy(); const valid = validateInProcessPayload("publish", input); return this.#call("publish", valid.candidate, valid.expected_base_logical_root); }
  stageApply(input) { return this.#call("stageApply", input); }
  publishCandidate(input) { return this.#call("publishCandidate", input); }
  search(input) { return this.#validatedCall("search", input); }
  explain(input) { return this.#validatedCall("explain", input); }
  stats(input) { this.#requireHealthy(); const valid = validateInProcessPayload("stats", input); const result = this.#call("stats"); if (result.logical_root !== valid.logical_root) searchFail("binding_mismatch", "stats logical root mismatch"); return result; }
  health(expectedRoot = null) { this.#requireHealthy(); return healthProbe(this.#provider, expectedRoot); }
  shutdown() { const result = this.#provider.shutdown(); this.#state = "closed"; return result; }
  #call(method, ...values) { this.#requireHealthy(); try { return this.#provider[method](...values); } catch (error) { if (["binding_mismatch", "incompatible_contract", "noncanonical_json"].includes(error.code)) this.#state = "quarantined"; throw error; } }
  #validatedCall(method, input) { this.#requireHealthy(); return this.#call(method, validateInProcessPayload(method, input)); }
  #requireHealthy() { if (this.#state !== "healthy") searchFail("provider_unavailable", `adapter is ${this.#state}`); }
  get implementation() { return "spipe_js"; }
  get contract() { return CONTRACTS.provider; }
}
