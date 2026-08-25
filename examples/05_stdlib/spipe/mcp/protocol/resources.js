import { readDoc } from "./tools.js";

export const resources = Object.freeze([{
  uri: "spipe://skill",
  name: "SPipe Skill",
  mimeType: "text/markdown",
  description: "Canonical SPipe skill guide."
}]);

export function readResource(moduleRoot, uri) {
  if (uri !== "spipe://skill") throw new Error(`unknown resource: ${uri}`);
  return {
    contents: [{
      uri,
      mimeType: "text/markdown",
      text: readDoc(moduleRoot, "doc/00_llm_process/spipe/skill.md")
    }]
  };
}
