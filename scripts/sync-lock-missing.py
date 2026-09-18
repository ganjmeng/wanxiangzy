"""把 npm ci 报告的 Missing 依赖逐个从 registry 合成进 package-lock.json。
用于修复平台可选依赖在本地生成锁时被省略的问题（npm/cli#4828 家族）。
幂等：可重复运行直到输出 NO MISSING。

步骤：
1. 从 /tmp/npm10-lock.json（git 20a814f 的 npm10 全量锁）移植 next-intl 子树闭包
2. 循环运行 npm@10 ci --dry-run，解析 Missing 列表
3. 用 npm view（失败时回退 curl registry）获取元数据合成条目
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[1])
LOCK = str(Path(ROOT) / "package-lock.json")
NPM10_LOCK = "/tmp/npm10-lock.json"


def run_ci():
    p = subprocess.run(
        ["npx", "-y", "npm@10.9.4", "ci", "--dry-run"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    return p.stdout + p.stderr


def missing_from(out):
    return re.findall(r"Missing: ([^\s]+)@([^\s]+)", out)


def fetch_meta(name, version):
    """优先 npm view，失败回退 curl registry（返回 dict 或 None）。

    npm view 单字段时返回解包的字段值（如 {"integrity":..., "tarball":...}），
    多字段时返回包裹对象（{"dist": {...}, "dependencies": {...}}），两者都要兼容。
    """
    p = subprocess.run(
        ["npm", "view", f"{name}@{version}", "dist", "dependencies", "--json"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    out = p.stdout.strip()
    if out.startswith("{"):
        try:
            doc = json.loads(out)
            if "tarball" in doc and "dist" not in doc:
                # 单字段解包（npm view 有时忽略第二个字段）
                doc = {"dist": doc}
            if "dist" in doc:
                return doc
        except Exception:
            pass
    # 回退 curl
    url = f"https://registry.npmjs.org/{name.replace('/', '%2F')}/{version}"
    p2 = subprocess.run(["curl", "-s", url], capture_output=True, text=True, cwd=ROOT)
    try:
        return json.loads(p2.stdout)
    except Exception:
        return None


def infer_platform(name):
    """从平台包名推断 os/cpu/libc（npm lock v3 字段），无法推断返回 {}。

    例如 @parcel/watcher-linux-x64-glibc -> os=linux cpu=x64 libc=glibc
    """
    fields = {}
    n = name.lower()
    if "-darwin-" in n:
        fields["os"] = ["darwin"]
    elif "-linux-" in n:
        fields["os"] = ["linux"]
    elif "-win32-" in n:
        fields["os"] = ["win32"]
    elif "-android-" in n:
        fields["os"] = ["android"]
    elif "-freebsd-" in n:
        fields["os"] = ["freebsd"]
    elif "-openharmony-" in n:
        fields["os"] = ["openharmony"]
    for cpu in ("arm64", "x64", "ia32", "arm", "s390x", "ppc64", "riscv64"):
        if f"-{cpu}" in n:
            fields["cpu"] = [cpu]
            break
    if "glibc" in n or "gnu" in n:
        fields["libc"] = ["glibc"]
    elif "musl" in n:
        fields["libc"] = ["musl"]
    return fields


def synthesize(name, version):
    doc = fetch_meta(name, version)
    if not doc or "dist" not in doc:
        print("FETCH FAILED:", name, version)
        return None
    entry = {
        "version": version,
        "resolved": doc["dist"]["tarball"],
        "integrity": doc["dist"].get("integrity"),
    }
    entry.update(infer_platform(name))
    if doc.get("dependencies"):
        entry["dependencies"] = doc["dependencies"]
    if doc.get("optionalDependencies"):
        entry["optionalDependencies"] = doc["optionalDependencies"]
    return entry


def closure_merge():
    """从 npm10 锁移植 next-intl 完整依赖闭包（含可选依赖）。"""
    if subprocess.run(["test", "-f", NPM10_LOCK]).returncode != 0:
        print("skip closure merge:", NPM10_LOCK, "missing")
        return
    npm10 = json.load(open(NPM10_LOCK))
    lock = json.load(open(LOCK))
    queue = ["node_modules/next-intl"]
    seen = set(queue)
    while queue:
        key = queue.pop(0)
        entry = npm10["packages"].get(key)
        if not entry:
            continue
        deps = {}
        deps.update(entry.get("dependencies", {}))
        deps.update(entry.get("optionalDependencies", {}))
        for dep in deps:
            cands = [f"node_modules/{dep}"]
            cands += [k for k in npm10["packages"] if k.endswith(f"/node_modules/{dep}")]
            for cand in cands:
                if cand in npm10["packages"] and cand not in seen:
                    seen.add(cand)
                    queue.append(cand)
    moved = 0
    for key in seen:
        if key not in lock["packages"]:
            lock["packages"][key] = npm10["packages"][key]
            moved += 1
    json.dump(lock, open(LOCK, "w"), indent=2)
    with open(LOCK, "a") as f:
        f.write("\n")
    print(f"closure merge: {len(seen)} entries, copied {moved}")


def main():
    closure_merge()
    for round_ in range(8):
        out = run_ci()
        missing = missing_from(out)
        if not missing:
            print(f"round {round_}: NO MISSING - lock in sync")
            return
        print(f"round {round_}: {len(missing)} missing:", [f"{n}@{v}" for n, v in missing][:10])
        lock = json.load(open(LOCK))
        added = 0
        for name, version in missing:
            key = f"node_modules/{name}"
            # 版本不同也要升级（替换旧条目）
            if lock["packages"].get(key, {}).get("version") == version:
                continue
            entry = synthesize(name, version)
            if entry:
                lock["packages"][key] = entry
                added += 1
        json.dump(lock, open(LOCK, "w"), indent=2)
        with open(LOCK, "a") as f:
            f.write("\n")
        if added == 0:
            print("no progress, stopping")
            sys.exit(1)
    sys.exit(1)


if __name__ == "__main__":
    main()
