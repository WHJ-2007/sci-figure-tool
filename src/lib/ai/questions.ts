const OTHER_OPTION_PATTERN = /^(其他|其它|other)$/iu;

export function isOtherOption(option: string): boolean {
  return OTHER_OPTION_PATTERN.test(option.trim());
}

/**
 * Selectable AI questions always end with one canonical “其他” entry.
 * Keep the tool's 5-option ceiling and remove duplicate/foreign spellings.
 */
export function ensureOtherOption(options?: string[]): string[] | undefined {
  if (!options?.length) return undefined;
  const seen = new Set<string>();
  const choices: string[] = [];
  for (const raw of options) {
    const option = raw.trim();
    if (!option || isOtherOption(option) || seen.has(option)) continue;
    seen.add(option);
    choices.push(option);
  }
  return [...choices.slice(0, 4), "其他"];
}
