import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin/auth";
import { listAdminTasks } from "@/lib/admin/data";
import { parseAdminListQuery } from "@/lib/admin/query";

const TASK_PAGE_SIZE_OPTIONS = [20, 50] as const;

export async function GET(request: Request) {
  const auth = await requireAdminApi("tasks:read");
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const query = parseAdminListQuery(params, {
    defaultPageSize: 20,
    minPageSize: 20,
    maxPageSize: 100,
    allowedPageSizes: TASK_PAGE_SIZE_OPTIONS,
    allowedSorts: ["createdAt", "updatedAt", "status", "module"],
  });
  const tasks = await listAdminTasks({
    q: query.q,
    module: query.module,
    status: query.status,
    sourceType: normalizeSourceType(params.get("sourceType")),
    stale: params.get("stale") === "1" || params.get("stale") === "true",
    page: query.page,
    pageSize: query.pageSize,
    hydratePreviews: true,
  });

  return NextResponse.json({ ...tasks, query }, { headers: { "Cache-Control": "no-store" } });
}

function normalizeSourceType(value: string | null): "generation" | "all" {
  return value === "generation" ? value : "all";
}
