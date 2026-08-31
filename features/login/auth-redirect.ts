/**
 * 计算登录/注册后的安全跳转目标。
 *
 * 规则：
 *   1. SSR / 无 window：返回默认 "/create"
 *   2. 从 ?next= 读取目标；
 *   3. 只接受同源相对路径（必须以 "/" 开头、不能以 "//" 开头、不能落到 /api/）；
 *   4. 非法 / 空 → 回落默认 "/create"
 *
 * 设计动机：任何重定向入口都必须防止 open-redirect 攻击。
 */
export function getSafeAuthRedirectTarget(): string {
  if (typeof window === "undefined") return "/create";
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/api/")) return "/create";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/auth/")) return "/create";
  return next;
}

/**
 * 邀请链接预填：/login?invite=CODE 落地时把邀请码规范化并返回。
 *
 * 规则：
 *   - 去除前后空白
 *   - 全部转大写（邀请码天然不区分大小写，便于展示与粘贴）
 *   - 去掉所有空白与 "-"（容忍 "ABC 123" / "ABC-123"）
 *   - 截断到 64 字符（DB 列宽）
 *   - 读 SSR 时 / 无 window → 返回空串
 */
export function getNormalizedInviteCode(): string {
  if (typeof window === "undefined") return "";
  const raw = new URLSearchParams(window.location.search).get("invite") || "";
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "").slice(0, 64);
}
