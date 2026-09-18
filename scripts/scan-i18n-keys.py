"""扫描 labelKey/badgeKey/descKey/descriptionKey 的定义与消费点，检测键格式错配。

规则（docs/i18n.md）：
- 消费端用全局 t（useTranslations() 无参数）→ 键必须是全路径（Ns.xxx）
- 消费端用命名空间 t（useTranslations("Ns")）→ 键必须是相对路径（xxx）
- 数据跨入共享组件边界前用 qualifyOptionKeys 转全路径
"""
import re
import os
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[1])
EXCLUDE = {"node_modules", ".next", "messages", "admin"}

key_def_re = re.compile(r"(labelKey|badgeKey|descKey|descriptionKey|titleKey|hintKey|countLabelKey)\s*[:=]\s*[\"'`]([^\"'`]+)[\"'`]")
key_use_re = re.compile(r"t\(([a-zA-Z0-9_.\[\]'\"`$]+)\)")

results = []

for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE and not d.startswith(".")]
    for fn in filenames:
        if not fn.endswith((".ts", ".tsx")):
            continue
        path = os.path.join(dirpath, fn)
        rel = os.path.relpath(path, ROOT)
        try:
            src = open(path, encoding="utf-8").read()
        except Exception:
            continue
        lines = src.split("\n")

        # 收集本文件内的 key 定义（值 + 是否全路径）
        defs = []
        for i, line in enumerate(lines, 1):
            for m in key_def_re.finditer(line):
                defs.append((i, m.group(1), m.group(2)))

        # 找到每个 t 声明（全局 or 命名空间）
        t_scopes = []  # (line, namespace or None)
        for i, line in enumerate(lines, 1):
            m = re.search(r'const\s+t(?:Any)?\s*=\s*useTranslations\((\s*\)|"([^"]+)"\))', line)
            if m:
                t_scopes.append((i, m.group(2) or None))
        # 也找 getTranslations（server）——同样规则
        for i, line in enumerate(lines, 1):
            m = re.search(r'getTranslations\(\s*"([^"]+)"\s*\)', line)
            if m:
                t_scopes.append((i, m.group(1)))

        if not defs and not t_scopes:
            continue

        # 对每个 key 定义，尝试找消费（同文件内 t("...") 引用该 key 名字，或传给共享组件）
        for dline, field, value in defs:
            if not re.match(r"^[A-Za-z_][\w-]*$", value) and not value.startswith("Ns."):
                is_full = "." in value
                # 尝试在同文件找消费 t(<value>)
                used_here = value in src.replace('t("', 't("').replace("t('", "t('")
                # 找共享组件传参（models={...} / options={...}）需要手动核对；先报告定义供人工检查
                results.append((rel, dline, field, value, "full" if is_full else "relative", "def"))

        # 对每个 t 消费点，若其参数含点且 t 是命名空间 → 错配；若参数无点且 t 是全局 → 错配
        for i, line in enumerate(lines, 1):
            for m in re.finditer(r"\bt(?:Any)?\(([\"'`][^\"'`]+[\"'`])", line):
                key = m.group(1)[1:-1]
                if key.startswith("$") or key.startswith("{"):
                    continue
                # 找到该行之前最近的 t 声明
                scope = None
                for sl, ns in t_scopes:
                    if sl < i:
                        scope = ns
                    else:
                        break
                # scope None 且函数内可能用全局 tAny——无法静态精确，跳过无声明情况
                if scope is None:
                    continue
                if "." in key and scope is not None:
                    results.append((rel, i, "t", key, f"namespaced({scope})", "USE_FULL_KEY_IN_NAMESPACED_T"))
                elif "." not in key and scope is None:
                    results.append((rel, i, "t", key, "global", "USE_RELATIVE_KEY_IN_GLOBAL_T"))

# 输出
print("== 键定义清单（人工核对消费端） ==")
seen = set()
for row in results:
    if row[5] == "def":
        key = (row[0], row[1], row[2], row[3])
        if key not in seen:
            seen.add(key)
            print(f"{row[0]}:{row[1]} {row[2]} = \"{row[3]}\" ({row[4]})")

print("\n== 疑似错配（自动检测） ==")
mismatches = [r for r in results if r[5] != "def"]
dedup = set()
for row in mismatches:
    k = (row[0], row[1], row[2], row[3], row[4], row[5])
    if k not in dedup:
        dedup.add(k)
        print(f"{row[0]}:{row[1]} t(\"{row[3]}\") scope={row[4]} → {row[5]}")
if not mismatches:
    print("(none detected by static rules)")
