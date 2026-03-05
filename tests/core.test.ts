import { describe, expect, test } from "bun:test";
import {
  applyDefaultEffort,
  approxTokenCount,
  hasEffortFlag,
  parseChatgptTokenCandidatesFromAuthJson,
  parseChatgptTokenFromAuthJson,
  parseClaudexArgs,
  parseApiKeyFromAuthJson,
  parseCodexConfig,
  resolveUpstreamFromCodexConfig,
  sanitizeToolFields,
} from "../src/core.ts";

function buildJwtWithExp(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("hasEffortFlag", () => {
  test("detects --effort and --effort=", () => {
    expect(hasEffortFlag(["--foo", "--effort"])).toBe(true);
    expect(hasEffortFlag(["--effort=xhigh"])).toBe(true);
    expect(hasEffortFlag(["--model", "x"])).toBe(false);
  });
});

describe("parseClaudexArgs", () => {
  test("default safe mode is true", () => {
    const parsed = parseClaudexArgs(["-p", "hello"]);
    expect(parsed.safeMode).toBe(true);
    expect(parsed.hasSettingsArg).toBe(false);
    expect(parsed.claudeArgs).toEqual(["-p", "hello"]);
  });

  test("consumes --no-safe and disables safe mode", () => {
    const parsed = parseClaudexArgs(["--no-safe", "-p", "hello"]);
    expect(parsed.safeMode).toBe(false);
    expect(parsed.hasSettingsArg).toBe(false);
    expect(parsed.claudeArgs).toEqual(["-p", "hello"]);
  });

  test("detects --settings argument", () => {
    expect(parseClaudexArgs(["--settings", "{\"a\":1}"]).hasSettingsArg).toBe(true);
    expect(parseClaudexArgs(["--settings={\"a\":1}"]).hasSettingsArg).toBe(true);
  });
});

describe("parseCodexConfig", () => {
  const configToml = `
model_provider = "unlimitex"
model = "gpt-5.3-codex"

[model_providers.voids]
name = "voids"
base_url = "https://voids.example/v1"
wire_api = "responses"

[model_providers.unlimitex]
name = "unlimitex"
base_url = "https://unlimitex.example/v1"
wire_api = "responses"
`;

  test("parses model and providers", () => {
    const parsed = parseCodexConfig(configToml);
    expect(parsed.modelProvider).toBe("unlimitex");
    expect(parsed.model).toBe("gpt-5.3-codex");
    expect(parsed.providers.unlimitex.baseUrl).toBe("https://unlimitex.example/v1");
  });

  test("resolves selected provider base url", () => {
    const resolved = resolveUpstreamFromCodexConfig(configToml);
    expect(resolved.baseUrl).toBe("https://unlimitex.example/v1");
    expect(resolved.model).toBe("gpt-5.3-codex");
  });

  test("base url override wins", () => {
    const resolved = resolveUpstreamFromCodexConfig(configToml, {
      baseUrlOverride: "https://override.example/v1",
    });
    expect(resolved.baseUrl).toBe("https://override.example/v1");
  });
});

describe("parseApiKeyFromAuthJson", () => {
  test("reads OPENAI_API_KEY", () => {
    const authJson = JSON.stringify({ OPENAI_API_KEY: "sk-test" });
    expect(parseApiKeyFromAuthJson(authJson)).toBe("sk-test");
  });

  test("env override wins", () => {
    const authJson = JSON.stringify({ OPENAI_API_KEY: "sk-file" });
    expect(parseApiKeyFromAuthJson(authJson, "sk-env")).toBe("sk-env");
  });

  test("throws without key", () => {
    const authJson = JSON.stringify({ tokens: { access_token: "x" } });
    expect(() => parseApiKeyFromAuthJson(authJson)).toThrow("failed to read OPENAI API key");
  });
});

describe("parseChatgptTokenFromAuthJson", () => {
  test("prefers tokens.id_token and reads account_id", () => {
    const authJson = JSON.stringify({
      tokens: {
        id_token: "id-token-value",
        access_token: "access-token-value",
        account_id: "acct_123",
      },
    });
    const parsed = parseChatgptTokenFromAuthJson(authJson);
    expect(parsed.bearerToken).toBe("id-token-value");
    expect(parsed.accountId).toBe("acct_123");
    expect(parsed.source).toBe("tokens.id_token");
  });

  test("prefers non-expired token when id_token is expired", () => {
    const now = Math.floor(Date.now() / 1000);
    const authJson = JSON.stringify({
      tokens: {
        id_token: buildJwtWithExp(now - 60),
        access_token: buildJwtWithExp(now + 3600),
      },
    });
    const parsed = parseChatgptTokenFromAuthJson(authJson);
    expect(parsed.source).toBe("tokens.access_token");
  });

  test("falls back to tokens.access_token", () => {
    const authJson = JSON.stringify({
      tokens: {
        access_token: "access-token-value",
      },
    });
    const parsed = parseChatgptTokenFromAuthJson(authJson);
    expect(parsed.bearerToken).toBe("access-token-value");
    expect(parsed.source).toBe("tokens.access_token");
  });

  test("env bearer token wins", () => {
    const authJson = JSON.stringify({
      tokens: {
        id_token: "id-token-value",
      },
    });
    const parsed = parseChatgptTokenFromAuthJson(authJson, {
      envBearerToken: "env-token-value",
      envAccountId: "acct_env",
    });
    expect(parsed.bearerToken).toBe("env-token-value");
    expect(parsed.accountId).toBe("acct_env");
    expect(parsed.source).toBe("env");
  });

  test("throws without token fields", () => {
    const authJson = JSON.stringify({ OPENAI_API_KEY: "sk-test" });
    expect(() => parseChatgptTokenFromAuthJson(authJson)).toThrow("failed to read ChatGPT token");
  });
});

describe("parseChatgptTokenCandidatesFromAuthJson", () => {
  test("keeps expired tokens as fallback candidates", () => {
    const now = Math.floor(Date.now() / 1000);
    const authJson = JSON.stringify({
      tokens: {
        id_token: buildJwtWithExp(now - 60),
        access_token: buildJwtWithExp(now + 3600),
      },
    });

    const candidates = parseChatgptTokenCandidatesFromAuthJson(authJson);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].source).toBe("tokens.access_token");
    expect(candidates[1].source).toBe("tokens.id_token");
    expect(candidates[1].expired).toBe(true);
  });

  test("env token remains the sole candidate", () => {
    const authJson = JSON.stringify({
      tokens: {
        id_token: "id-token-value",
        access_token: "access-token-value",
      },
    });

    const candidates = parseChatgptTokenCandidatesFromAuthJson(authJson, {
      envBearerToken: "env-token-value",
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe("env");
    expect(candidates[0].bearerToken).toBe("env-token-value");
  });
});

describe("approxTokenCount", () => {
  test("counts text parts", () => {
    const count = approxTokenCount({
      messages: [{ content: "abcd" }, { content: [{ text: "1234" }, { content: "abcd" }] }],
    });
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("returns at least one", () => {
    expect(approxTokenCount({})).toBe(1);
  });
});

describe("applyDefaultEffort", () => {
  test("sets xhigh for gpt-5.3-codex by default", () => {
    const body: Record<string, any> = {};
    applyDefaultEffort(body, {
      forcedModel: "gpt-5.3-codex",
      defaultReasoningEffort: "xhigh",
      preserveClientEffort: false,
    });
    expect(body.output_config.effort).toBe("xhigh");
    expect(body.reasoning.effort).toBe("xhigh");
  });

  test("does not overwrite when preserving client effort", () => {
    const body: Record<string, any> = {};
    applyDefaultEffort(body, {
      forcedModel: "gpt-5.3-codex",
      defaultReasoningEffort: "xhigh",
      preserveClientEffort: true,
    });
    expect(body.output_config).toBeUndefined();
  });
});

describe("sanitizeToolFields", () => {
  test("removes defer_loading from each tool", () => {
    const body: Record<string, any> = {
      tools: [{ name: "a", defer_loading: true }, { name: "b" }],
    };
    const removed = sanitizeToolFields(body);
    expect(removed).toBe(1);
    expect(body.tools[0].defer_loading).toBeUndefined();
  });
});
