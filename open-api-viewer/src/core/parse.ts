// Dispatch to the JSON or YAML parser based on language. Pure, no vscode dependency.

import { SpecLang, ParseResult } from "./types";
import { parseJson } from "./parseJson";
import { parseYaml } from "./parseYaml";

export function parseSpec(text: string, lang: SpecLang): ParseResult {
  return lang === "yaml" ? parseYaml(text) : parseJson(text);
}
