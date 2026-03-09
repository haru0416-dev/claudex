export interface ParsedClaudexArgs {
  claudeArgs: string[];
  safeMode: boolean;
  hasSettingsArg: boolean;
  modelOverride?: string;
}

function parseModelOverrideArg(
  rawArgs: string[],
  index: number
): { value: string; consumeNext: boolean } | undefined {
  const arg = rawArgs[index];
  for (const flag of ["--model", "--upstream-model"]) {
    if (arg === flag) {
      const next = rawArgs[index + 1];
      if (typeof next === "string" && next.length > 0 && !next.startsWith("-")) {
        return { value: next, consumeNext: true };
      }
      return undefined;
    }

    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      if (value.length > 0) {
        return { value, consumeNext: false };
      }
    }
  }

  return undefined;
}

export function hasEffortFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--effort" || arg.startsWith("--effort="));
}

export function parseClaudexArgs(rawArgs: string[]): ParsedClaudexArgs {
  let safeMode = true;
  let hasSettingsArg = false;
  let modelOverride: string | undefined;
  const claudeArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    const parsedModelOverride = parseModelOverrideArg(rawArgs, i);

    if (parsedModelOverride) {
      modelOverride = parsedModelOverride.value;
      if (parsedModelOverride.consumeNext) {
        i += 1;
      }
      continue;
    }

    if (arg === "--no-safe") {
      safeMode = false;
      continue;
    }
    if (arg === "--settings" || arg.startsWith("--settings=")) {
      hasSettingsArg = true;
    }
    claudeArgs.push(arg);
  }

  return { claudeArgs, safeMode, hasSettingsArg, modelOverride };
}
