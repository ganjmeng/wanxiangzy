import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

import { CreditError, createDebitedGeneration, errorToResponsePayload } from "@/lib/api/credits";

describe("CreditError", () => {
  it("stores status and details", () => {
    const err = new CreditError("灵点不足。需要 10，余额 5", 402, {
      required: 10,
      balance: 5,
    });
    expect(err.name).toBe("CreditError");
    expect(err.status).toBe(402);
    expect(err.required).toBe(10);
    expect(err.balance).toBe(5);
    expect(err.message).toContain("灵点不足");
  });

  it("defaults to status 500", () => {
    const err = new CreditError("unknown error");
    expect(err.status).toBe(500);
    expect(err.required).toBeUndefined();
    expect(err.balance).toBeUndefined();
  });
});

describe("errorToResponsePayload", () => {
  it("returns CreditError fields", () => {
    const err = new CreditError("灵点不足", 402, { required: 10, balance: 3 });
    const payload = errorToResponsePayload(err);
    expect(payload.status).toBe(402);
    expect(payload.body.error).toBe("灵点不足");
    expect(payload.body.required).toBe(10);
    expect(payload.body.balance).toBe(3);
  });

  it("returns 500 for generic Error", () => {
    const err = new Error("something broke");
    const payload = errorToResponsePayload(err);
    expect(payload.status).toBe(500);
    expect(payload.body.error).toBe("something broke");
  });

  it("returns 500 for non-Error values", () => {
    const payload = errorToResponsePayload("string error");
    expect(payload.status).toBe(500);
    expect(payload.body.error).toBe("Internal server error");
  });
});

describe("createDebitedGeneration", () => {
  it("turns the database auth guard into an actionable login error", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "NOT_ALLOWED" } }),
    };

    await expect(createDebitedGeneration(supabase, {
      userId: "00000000-0000-4000-8000-000000000001",
      clothingUrls: ["https://assets.example.com/source.png"],
      creditsCost: 4,
      aiModel: "nano-banana-2",
      imageSize: "2K",
      reason: "AI 消除",
    })).rejects.toMatchObject({
      name: "CreditError",
      status: 401,
      message: "登录状态校验失败，请刷新页面后重新登录",
    });
  });
});
