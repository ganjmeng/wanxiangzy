import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredProcessorSecrets,
  getConfiguredPublicBaseUrl,
  validateEnv,
} from "@/lib/env";
import { getPublicBaseUrlFromRequest } from "@/lib/api/image-inputs.server";

const ORIGINAL_ENV = { ...process.env };

describe("environment contract", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test" };
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.SITE_URL;
    delete process.env.APP_URL;
    delete process.env.URL;
    delete process.env.LINGYA_API_KEY;
    delete process.env.GPT_IMAGE_PROVIDER;
    delete process.env.CATROUTER_API_KEY;
    delete process.env.PLATO_API_KEY;
    delete process.env.NANO_BANANA_PROVIDER;
    delete process.env.YUNWU_NATIVE_API_KEY;
    delete process.env.LAOZHANG_API_KEY;
    delete process.env.HAPPYHORSE_API_KEY;
    delete process.env.YUNWU_HAPPYHORSE_API_KEY;
    delete process.env.YUNWU_API_KEY;
    delete process.env.XIAOMI_MIMO_API_KEY;
    delete process.env.ANALYZE_LLM_PROVIDER;
    delete process.env.AI_TOOLS_EXECUTION_MODE;
    delete process.env.AI_TOOLS_PROVIDER_GATEWAY_URL;
    delete process.env.AI_TOOLS_PROVIDER_GATEWAY_TOKEN;
    delete process.env.AI_TOOLS_PROVIDER_OPERATIONS;
    delete process.env.AI_TOOLS_PROVIDER_TIMEOUT_MS;
    delete process.env.AI_TOOL_ASSET_REF_SECRET;
    delete process.env.RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET;
    delete process.env.AI_TOOL_MASK_REF_TTL_SECONDS;
    delete process.env.ALIYUN_OSS_MIRROR_ENABLED;
    delete process.env.ALIYUN_OSS_MIRROR_RESOLVER_SECRET;
    delete process.env.ALIYUN_OSS_MIRROR_SIGNING_SECRET;
    delete process.env.ALIYUN_OSS_MIRROR_ALLOWED_HOSTS;
    delete process.env.ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL;
    delete process.env.ALIYUN_OSS_MIRROR_TTL_SECONDS;
    delete process.env.ALIYUN_OSS_MIRROR_TRIGGER_TIMEOUT_MS;
    delete process.env.ALIYUN_OSS_MIRROR_MAX_BYTES;
    delete process.env.ALIYUN_OSS_MIRROR_MAX_ATTEMPTS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports production-required variables as errors only in production", () => {
    const developmentIssues = validateEnv({ nodeEnv: "development" });
    expect(developmentIssues.some((issue) => issue.severity === "error")).toBe(false);

    const productionIssues = validateEnv({ nodeEnv: "production" });
    expect(productionIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "NEXT_PUBLIC_APP_URL",
          category: "production-required",
          severity: "error",
        }),
      ])
    );
  });

  it("prefers NEXT_PUBLIC_APP_URL for public base URLs", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/path?ignored=1";
    process.env.NEXT_PUBLIC_SITE_URL = "https://site.example.com";

    expect(getConfiguredPublicBaseUrl()).toBe("https://app.example.com");
  });

  it("does not use fallback public URL variables in production", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://site.example.com";

    expect(getConfiguredPublicBaseUrl({ nodeEnv: "production" })).toBeUndefined();
  });

  it("requires NEXT_PUBLIC_APP_URL instead of trusting forwarded headers in production", () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    const request = new Request("https://internal.example.com/api", {
      headers: {
        "x-forwarded-host": "attacker.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(() => getPublicBaseUrlFromRequest(request)).toThrow("NEXT_PUBLIC_APP_URL");
  });

  it("uses forwarded headers only as a non-production fallback", () => {
    const request = new Request("http://localhost:3000/api", {
      headers: {
        "x-forwarded-host": "preview.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(getPublicBaseUrlFromRequest(request)).toBe("https://preview.example.com");
  });

  it("rejects placeholder and weak processor secrets in production", () => {
    expect(
      getConfiguredProcessorSecrets(
        [{ name: "JOB_PROCESSOR_SECRET", value: "change-me" }],
        "Generation job processor",
        { nodeEnv: "production" }
      )
    ).toMatchObject({ ok: false });

    expect(
      getConfiguredProcessorSecrets(
        [{ name: "JOB_PROCESSOR_SECRET", value: "short-secret" }],
        "Generation job processor",
        { nodeEnv: "production" }
      )
    ).toMatchObject({ ok: false });
  });

  it("accepts a strong fallback processor secret while ignoring weak defaults", () => {
    const strongSecret = "0123456789abcdef0123456789abcdef";

    expect(
      getConfiguredProcessorSecrets(
        [
          { name: "JOB_PROCESSOR_SECRET", value: "change-me" },
          { name: "CRON_SECRET", value: strongSecret },
        ],
        "Generation job processor",
        { nodeEnv: "production" }
      )
    ).toEqual({ ok: true, secrets: [strongSecret] });
  });

  it("does not require a HappyHorse env fallback now that video is admin-configured", () => {
    process.env.YUNWU_API_KEY = "shared-yunwu-key";

    expect(validateEnv({ nodeEnv: "development" })).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "HAPPYHORSE_API_KEY or YUNWU_API_KEY" }),
      ])
    );
  });

  // 供应商密钥（Lingya/CatRouter/Xiaomi/MiniMax/Yunwu/Laozhang 等）已改为
  // 后台加密配置（lib/api/model-provider-secrets.ts），env 仅作开发回退，
  // validateEnv 不再对它们发出启动告警。
  it("does not warn about provider keys now managed in admin config", () => {
    process.env.ANALYZE_LLM_PROVIDER = "yunwu";
    process.env.NANO_BANANA_PROVIDER = "laozhang";
    process.env.GPT_IMAGE_PROVIDER = "plato";

    const issues = validateEnv({ nodeEnv: "development" });
    const providerKeyNames = new Set([
      "LINGYA_API_KEY",
      "CATROUTER_API_KEY",
      "XIAOMI_MIMO_API_KEY",
      "MINIMAX_API_KEY",
      "IMGBB_API_KEY",
      "YUNWU_API_KEY",
      "YUNWU_NATIVE_API_KEY",
      "LAOZHANG_API_KEY",
      "PLATO_API_KEY",
      "YUNWU_API_KEY or YUNWU_NATIVE_API_KEY",
      "YUNWU_NATIVE_API_KEY or YUNWU_API_KEY",
      "LAOZHANG_API_KEY",
      "PLATO_API_KEY or LINGYA_API_KEY",
    ]);

    for (const issue of issues) {
      expect(providerKeyNames.has(issue.name)).toBe(false);
    }
  });

  it("still enforces production-required variables", () => {
    const issues = validateEnv({ nodeEnv: "development" });
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "SUPABASE_SERVICE_ROLE_KEY" }),
      ])
    );
  });

  it("allows explicit mock AI toolbox mode only outside production", () => {
    process.env.AI_TOOLS_EXECUTION_MODE = "mock";

    expect(validateEnv({ nodeEnv: "development" })).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "AI_TOOLS_EXECUTION_MODE" }),
      ])
    );
    expect(validateEnv({ nodeEnv: "production" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "AI_TOOLS_EXECUTION_MODE",
          severity: "error",
        }),
      ])
    );
  });

  it("requires an explicit live operation allowlist", () => {
    process.env.AI_TOOLS_EXECUTION_MODE = "live";

    expect(validateEnv({ nodeEnv: "production" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "AI_TOOLS_PROVIDER_OPERATIONS",
          severity: "error",
        }),
      ])
    );

    process.env.AI_TOOLS_PROVIDER_OPERATIONS = "";
    const disabledRemoteIssues = validateEnv({ nodeEnv: "production" });
    expect(disabledRemoteIssues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AI_TOOLS_PROVIDER_GATEWAY_URL" }),
    ]));
    expect(disabledRemoteIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AI_TOOL_ASSET_REF_SECRET" }),
      expect.objectContaining({ name: "RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET" }),
    ]));
  });

  it("validates live AI toolbox gateway, secrets, timeout, and operation names", () => {
    process.env.AI_TOOLS_EXECUTION_MODE = "live";
    process.env.AI_TOOLS_PROVIDER_OPERATIONS = "outpaint,resize";
    process.env.AI_TOOLS_PROVIDER_GATEWAY_URL = "http://gateway.example.com";
    process.env.AI_TOOLS_PROVIDER_GATEWAY_TOKEN = "short";
    process.env.AI_TOOL_ASSET_REF_SECRET = "replace-with-secret";
    process.env.RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET = "replace-with-secret";
    process.env.AI_TOOLS_PROVIDER_TIMEOUT_MS = "999999";
    process.env.AI_TOOL_MASK_REF_TTL_SECONDS = "10";

    const invalidIssues = validateEnv({ nodeEnv: "production" });
    expect(invalidIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AI_TOOLS_PROVIDER_OPERATIONS" }),
    ]));

    process.env.AI_TOOLS_PROVIDER_OPERATIONS = "matting,upscale";
    const gatewayIssues = validateEnv({ nodeEnv: "production" });
    expect(gatewayIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AI_TOOLS_PROVIDER_GATEWAY_URL" }),
      expect.objectContaining({ name: "AI_TOOLS_PROVIDER_GATEWAY_TOKEN" }),
      expect.objectContaining({ name: "AI_TOOL_ASSET_REF_SECRET" }),
      expect.objectContaining({ name: "RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET" }),
      expect.objectContaining({ name: "AI_TOOLS_PROVIDER_TIMEOUT_MS" }),
      expect.objectContaining({ name: "AI_TOOL_MASK_REF_TTL_SECONDS" }),
    ]));

    process.env.AI_TOOLS_PROVIDER_GATEWAY_URL = "https://gateway.example.com/v1/";
    process.env.AI_TOOLS_PROVIDER_GATEWAY_TOKEN = "a".repeat(32);
    process.env.AI_TOOL_ASSET_REF_SECRET = "b".repeat(64);
    process.env.RESOURCE_LIBRARY_UPLOAD_TOKEN_SECRET = "c".repeat(64);
    process.env.AI_TOOLS_PROVIDER_TIMEOUT_MS = "45000";
    process.env.AI_TOOL_MASK_REF_TTL_SECONDS = "1800";
    expect(validateEnv({ nodeEnv: "production" })).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.stringMatching(/^AI_TOOL/) }),
      ])
    );
  });

  it("requires a strong public OSS mirror configuration when enabled", () => {
    process.env.IMAGE_STORAGE_PROVIDER = "aliyun-oss";
    process.env.ALIYUN_OSS_MIRROR_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.ALIYUN_OSS_MIRROR_SIGNING_SECRET = "short";
    process.env.ALIYUN_OSS_MIRROR_ALLOWED_HOSTS = "*";
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = "short";
    process.env.ALIYUN_OSS_MIRROR_MAX_ATTEMPTS = "99";

    expect(validateEnv({ nodeEnv: "production" })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "ALIYUN_OSS_MIRROR_SIGNING_SECRET", severity: "error" }),
      expect.objectContaining({ name: "ALIYUN_OSS_MIRROR_ALLOWED_HOSTS", severity: "error" }),
      expect.objectContaining({ name: "ADMIN_SECRETS_ENCRYPTION_KEY", severity: "error" }),
      expect.objectContaining({ name: "ALIYUN_OSS_MIRROR_RESOLVER_BASE_URL", severity: "error" }),
      expect.objectContaining({ name: "ALIYUN_OSS_MIRROR_MAX_ATTEMPTS", severity: "error" }),
    ]));

    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    process.env.ALIYUN_OSS_MIRROR_SIGNING_SECRET = "m".repeat(40);
    process.env.ALIYUN_OSS_MIRROR_ALLOWED_HOSTS = "provider.example.com,*.trusted.example.com";
    process.env.ADMIN_SECRETS_ENCRYPTION_KEY = "a".repeat(64);
    process.env.ALIYUN_OSS_MIRROR_MAX_ATTEMPTS = "8";
    const issues = validateEnv({ nodeEnv: "production" });
    expect(issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: expect.stringMatching(/^ALIYUN_OSS_MIRROR_/) }),
    ]));
  });
});
