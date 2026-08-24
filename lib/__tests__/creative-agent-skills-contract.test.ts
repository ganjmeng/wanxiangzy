import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260824193939_complete_agent_skill_runtime.sql");
const indexMigration = read("supabase/migrations/20260824203735_creative_runtime_fk_indexes.sql");
const runtime = read("lib/creative-skills.server.ts");
const importer = read("lib/github-creative-skill-import.server.ts") + read("lib/github-creative-skill-url.ts");
const importRefiner = read("lib/creative-skill-import-refiner.server.ts");
const runs = read("lib/creative-runs.server.ts");
const imageRoute = read("app/api/general-image/route.ts");
const videoRoute = read("app/api/video/image-to-video/route.ts");
const frameRoute = read("app/api/video/first-last-frame/route.ts");
const agent = read("features/creative-agent/AgentExperience.tsx");
const canvas = read("features/infinite-canvas/InfiniteCanvasEditor.tsx");
const adminApi = read("app/api/admin/creative-skills/route.ts");

describe("complete Agent Skill migration contract", () => {
  it("stores owner-scoped skills, immutable versions and run snapshots behind RLS", () => {
    expect(migration).toContain("create table if not exists public.creative_agent_skills");
    expect(migration).toContain("create table if not exists public.creative_agent_skill_versions");
    expect(migration).toContain("add column if not exists selected_skill_ids");
    expect(migration).toContain("add column if not exists skill_snapshot");
    expect(migration).toContain("for select to authenticated");
    expect(migration).toContain("(select auth.uid()) = owner_user_id");
    expect(migration).toContain("revoke all on public.creative_agent_skill_versions from public, anon, authenticated");
    expect(migration).toContain("unique (skill_id, version)");
    expect(migration).toContain("'disabled'");
    expect(indexMigration).toContain("creative_agent_skill_versions_created_by_idx");
    expect(indexMigration).toContain("creative_run_steps_parent_step_idx");
    expect(indexMigration).toContain("generations_creative_step_idx");
  });

  it("resolves only enabled server-owned definitions and freezes execution rules", () => {
    expect(runtime).toContain("includeDisabledOwn: false");
    expect(runtime).toContain("部分所选 Skill 不存在、未启用或不适用于当前创作入口");
    expect(runtime).toContain("snapshotSkill(skill, input.runMode, input.roleAssetIds)");
    expect(runtime).toContain("buildSkillExecutionPrompt");
    expect(runtime).toContain("referenceRoleAssetIds");
    expect(runs).toContain("skillSnapshot: skillExecution.snapshots");
    expect(runs).toContain("selected_skill_ids: selectedSkillIds");
  });

  it("injects trusted snapshots into every migrated image/video execution route", () => {
    for (const route of [imageRoute, videoRoute, frameRoute]) {
      expect(route).toContain("getCreativeRunExecutionContext");
      expect(route).toContain("creative_run_id");
    }
  });

  it("imports declarative SKILL.md safely without executing repository code", () => {
    expect(importer).toContain('url.protocol !== "https:"');
    expect(importer).toContain('"github.com", "www.github.com", "raw.githubusercontent.com"');
    expect(importer).toContain('redirect: "error"');
    expect(importer).toContain("resolveCommit");
    expect(importer).toContain('createHash("sha256")');
    expect(importer).toContain("parseDocument");
    expect(importer).not.toMatch(/child_process|execFile|spawn\(/);
    expect(importRefiner).toContain("<untrusted_skill_document>");
    expect(importRefiner).toContain("isTechnicalContent");
    expect(importRefiner).toContain("normalizeRefinedCreativeSkill");
  });

  it("supports reference roles in Agent and Canvas plus audited system governance", () => {
    expect(agent).toContain("skillReferenceRoleAssetIds");
    expect(agent).toContain("AgentSkillWorkspace");
    expect(agent).toContain("buildAgentGenerationIdempotencyKey(clientRequestId, index)");
    expect(agent).not.toContain("`agent:${clientRequestId}");
    expect(canvas).toContain("skillRoleAssignments");
    expect(canvas).toContain("selectRoleAssets");
    expect(canvas).toContain("buildCanvasGenerationIdempotencyKey(clientRequestId)");
    expect(canvas).not.toContain("`canvas:${clientRequestId}");
    expect(adminApi).toContain('requireAdminApi("prompts:write")');
    expect(adminApi).toContain("writeAdminAuditLog");
    expect(adminApi).toContain("saveSystemCreativeSkill");
  });
});
