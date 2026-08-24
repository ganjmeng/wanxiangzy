import { AdminAgentSkillsClient } from "@/components/admin/AdminAgentSkillsClient";
import { AdminPageHeader } from "@/components/admin/AdminPrimitives";
import { requireAdmin } from "@/lib/admin/auth";
import { hasAdminPermission } from "@/lib/admin/permissions";
import { listSystemCreativeSkills } from "@/lib/creative-skills.server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AdminAgentSkillsPage() {
  const admin = await requireAdmin("prompts:read");
  const warnings: string[] = [];
  const skills = await listSystemCreativeSkills(getAdminClient()).catch((error) => {
    warnings.push(error instanceof Error ? error.message : "系统 Skill 加载失败");
    return [];
  });
  return <div className="space-y-5"><AdminPageHeader eyebrow="Agent 运行时" title="官方 Skill 管理" description="统一管理 Agent 与无限画布共用的声明式 Skill。配置不会执行仓库代码；新任务按已发布版本生成不可变快照。" /><AdminAgentSkillsClient initialSkills={skills} canManage={hasAdminPermission(admin.role, "prompts:write")} warnings={warnings} /></div>;
}
