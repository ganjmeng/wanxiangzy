export type GithubCreativeSkillLocation = {
  owner: string;
  repository: string;
  ref?: string;
  path?: string;
  mode: "repository" | "tree" | "blob";
};

export class GithubCreativeSkillImportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "GithubCreativeSkillImportError";
    this.status = status;
  }
}

export function parseGithubLocation(value: string): GithubCreativeSkillLocation {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new GithubCreativeSkillImportError("请输入有效的 GitHub 公开地址"); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !["github.com", "www.github.com", "raw.githubusercontent.com"].includes(hostname)) throw new GithubCreativeSkillImportError("只支持 github.com 的公开仓库、目录或 SKILL.md 地址");
  let parts: string[];
  try { parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent); } catch { throw new GithubCreativeSkillImportError("GitHub 地址包含无效路径"); }
  if (parts.length < 2 || !isGithubSegment(parts[0]) || !isGithubSegment(parts[1])) throw new GithubCreativeSkillImportError("GitHub 地址缺少公开仓库信息");
  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");
  if (!repository) throw new GithubCreativeSkillImportError("GitHub 仓库地址无效");
  if (hostname === "raw.githubusercontent.com") {
    if (parts.length < 4) throw new GithubCreativeSkillImportError("Raw GitHub 地址缺少分支和 SKILL.md 路径");
    const path = parts.slice(3).join("/");
    if (!isSkillPath(path)) throw new GithubCreativeSkillImportError("地址必须指向 SKILL.md");
    return { owner, repository, ref: parts[2], path, mode: "blob" };
  }
  if (!parts[2]) return { owner, repository, mode: "repository" };
  if (parts[2] !== "tree" && parts[2] !== "blob") throw new GithubCreativeSkillImportError("请粘贴仓库、tree 目录或 SKILL.md 文件地址");
  if (parts.length < 4) throw new GithubCreativeSkillImportError("GitHub 地址缺少分支信息");
  const path = parts.slice(4).join("/");
  if (parts[2] === "blob" && !isSkillPath(path)) throw new GithubCreativeSkillImportError("地址必须指向 SKILL.md");
  return { owner, repository, ref: parts[3], path, mode: parts[2] };
}

function isSkillPath(value: string) { return value.split("/").at(-1)?.toLowerCase() === "skill.md"; }
function isGithubSegment(value: string) { return /^[a-z0-9_.-]+$/i.test(value); }
