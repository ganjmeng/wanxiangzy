import { describe, expect, it } from "vitest";
import { replaceLegacyCanvasBrand, SITE_NAME } from "@/lib/site-brand";

describe("site brand", () => {
  it("renames legacy VOZEB canvas titles to the website name", () => {
    expect(replaceLegacyCanvasBrand("VOZEB PRO 画布 1")).toBe(`${SITE_NAME} 画布 1`);
    expect(replaceLegacyCanvasBrand("自定义画布")).toBe("自定义画布");
  });
});
