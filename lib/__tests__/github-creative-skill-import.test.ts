import { describe, expect, it } from "vitest";

import {
  GithubCreativeSkillImportError,
  parseGithubLocation,
} from "@/lib/github-creative-skill-url";

describe("GitHub creative Skill URL parser", () => {
  it("accepts repositories, directories and immutable raw SKILL.md inputs", () => {
    expect(parseGithubLocation("https://github.com/openai/skills")).toMatchObject({ owner: "openai", repository: "skills", mode: "repository" });
    expect(parseGithubLocation("https://github.com/openai/skills/tree/main/skills/docs")).toMatchObject({ ref: "main", path: "skills/docs", mode: "tree" });
    expect(parseGithubLocation("https://raw.githubusercontent.com/openai/skills/main/example/SKILL.md")).toMatchObject({ ref: "main", path: "example/SKILL.md", mode: "blob" });
  });

  it("rejects non-GitHub hosts, non-HTTPS URLs and arbitrary blob files", () => {
    for (const url of [
      "http://github.com/openai/skills",
      "https://example.com/openai/skills",
      "https://github.com/openai/skills/blob/main/package.json",
    ]) {
      expect(() => parseGithubLocation(url)).toThrow(GithubCreativeSkillImportError);
    }
  });
});
