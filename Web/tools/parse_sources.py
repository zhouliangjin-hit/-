#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_sources.py — 将 uploads/ 下的 Markdown 素材统一转换为 web 应用使用的 JSON 数据。

对应原始 mindmap/README 的约定：「先把 markdown 素材上传，最后统一变成 json」。

产物（写入 mayuan-study/data/）：
  questions.json   全部客观题（判断/单选/多选，含答案与解析）
  subjective.json  全部主观题（简答/辨析/论述/材料论述，含参考答案与评分要点）
  chapters.json    思维导图知识树（由 chapter-01.md 标题层级解析而来）
  banks.json       题库索引（分组、题量、说明等元信息）

题目 JSON Schema 见 DOCUMENTATION.md「数据结构」一节。
"""
import json, re, os, sys

SRC = "/home/user/uploads"
OUT = "/home/user/mayuan-study/data"
os.makedirs(OUT, exist_ok=True)

def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()

def clean(s):
    """去掉 markdown 强调符号并压缩空白。"""
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = s.replace("**", "")
    return re.sub(r"\s+", " ", s).strip()

def opt_lines(lines, start_idx):
    """从 start_idx 开始收集 A-E 选项行（形如 'A. xxx' 或 '- **A．**xxx'），
    允许选项间空行与续行。返回 (options, next_idx)。"""
    opts, i = [], start_idx
    opt_re = re.compile(r"^(?:-\s*)?(?:\*\*)?([A-E])[．.、](?:\*\*)?\s*(.*)$")
    while i < len(lines):
        ln = lines[i].strip()
        if not ln:
            i += 1
            continue
        if ln.startswith("**答案") or ln.startswith("**参考答案") or ln.startswith("答案："):
            break
        if ln.startswith("**解析") or ln.startswith("---"):
            break
        m = opt_re.match(ln)
        if m:
            opts.append({"key": m.group(1), "text": clean(m.group(2))})
            i += 1
            continue
        if opts:  # 续行并入上一选项
            opts[-1]["text"] += " " + clean(ln)
        i += 1  # 尚未遇到选项时继续向下找（题干等材料行直接跳过）
    return opts, i

def extract_letters(ans_text, expect_type):
    t = clean(ans_text)
    if expect_type == "judge":
        return ["B"] if ("错误" in t or "×" in t or "✗" in t) else ["A"]
    m = re.match(r"\s*([A-E]{1,5})", t)
    if not m:
        return []
    return sorted(set(m.group(1)))

# ---------------------------------------------------------------- c1s1：第一章第一节（课堂小测1/2）
def parse_c1s1():
    text = read("Question 第一章 第一节.md")
    lines = text.splitlines()
    questions, quiz, qtype, i = [], None, None, 0
    quiz_names = {"课堂小测1": ("c1s1-q1", "第一章第一节 · 课堂小测1"),
                  "课堂小测2": ("c1s1-q2", "第一章第一节 · 课堂小测2")}
    while i < len(lines):
        ln = lines[i].strip()
        if re.match(r"^#\s*课堂小测", ln):
            quiz = quiz_names[re.sub(r"^#\s*", "", ln).strip()]
            i += 1; continue
        m2 = re.match(r"^##\s*[一二三四五六]、(.+题)", ln)
        if m2:
            t = m2.group(1)
            qtype = "judge" if "判断" in t else ("multi" if "多选" in t else "single")
            i += 1; continue
        mq = re.match(r"^###\s*第(\d+)题", ln)
        if mq and quiz:
            num = int(mq.group(1))
            block, i = [], i + 1
            while i < len(lines) and not lines[i].strip().startswith("###") \
                    and not re.match(r"^##\s*[一二三四五六]、", lines[i].strip()) \
                    and not re.match(r"^#\s*课堂小测", lines[i].strip()):
                block.append(lines[i]); i += 1
            body = [b for b in block]
            stem, j = "", 0
            while j < len(body):  # 题干：第一条整行加粗
                b = body[j].strip()
                if b.startswith("**") and b.endswith("**") and len(b) > 4:
                    stem = clean(b); j += 1; break
                j += 1
            if qtype == "judge":
                options = [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]
            else:
                options, _ = opt_lines(body, j)
            rest = "\n".join(body)
            ma = re.search(r"(?:参考|正确)答案\*{0,2}[：:]\*{0,2}\s*(.+)", rest)
            ans = extract_letters(ma.group(1).splitlines()[0], qtype) if ma else []
            man = re.search(r"解析\*{0,2}[：:]\*{0,2}\s*\n?(.*)", rest, re.S)
            analysis = man.group(1).replace("---", "").strip() if man else ""
            questions.append({
                "id": f"{quiz[0]}-{num:02d}", "bank": quiz[0], "bankName": quiz[1],
                "num": num, "type": qtype, "stem": stem, "options": options,
                "answer": ans, "analysis": analysis,
                "tags": ["第一章", "第一节", "世界的物质性"],
                "origin": quiz[1],
            })
            continue
        i += 1
    return questions

# ---------------------------------------------------------------- c1s23：第一章第二&三节
def parse_c1s23():
    text = read("Question 第一章 第二节&第三节.md")
    lines = text.splitlines()
    questions, subjectives, i = [], [], 0
    while i < len(lines):
        m = re.match(r"^##\s*(\d+)\.\s*(.+题)", lines[i].strip())
        if not m:
            i += 1; continue
        num, kind = int(m.group(1)), m.group(2)
        block, i = [], i + 1
        while i < len(lines) and not re.match(r"^##\s*\d+\.", lines[i].strip()):
            block.append(lines[i]); i += 1
        raw = "\n".join(block).strip()
        if "材料论述" in kind:
            mp = raw.find("**答案：**")
            man = raw.find("**解析：**")
            subjectives.append({
                "id": f"c1s23-m{num:02d}", "bank": "c1s23", "bankName": "第一章第二&三节 · 课堂练习",
                "kind": "材料论述题", "score": 10,
                "title": f"材料论述题（第{num}题）：黑天鹅/灰犀牛与辩证思维",
                "prompt": raw[:mp].strip() if mp > -1 else raw,
                "reference": raw[mp + len("**答案：**"):man].strip() if man > -1 else raw[mp + 6:].strip(),
                "rubric": raw[man:].replace("**解析：**", "").strip() if man > -1 else "",
                "origin": "第一章第二&三节 · 课堂练习",
            })
            continue
        qtype = "multi" if "多选" in kind else "single"
        ms = re.search(r"\*\*题干：\*\*\s*(.+?)(?=\n\s*-\s*\*\*[A-E])", raw, re.S)
        stem = clean(ms.group(1)) if ms else ""
        options, _ = opt_lines(raw.splitlines(), 0)
        ma = re.search(r"\*\*答案：\*{0,2}\s*([A-E]{1,5})", raw)
        man = re.search(r"\*\*解析：\*\*\s*(.*)", raw, re.S)
        questions.append({
            "id": f"c1s23-{num:02d}", "bank": "c1s23", "bankName": "第一章第二&三节 · 课堂练习",
            "num": num, "type": qtype, "stem": stem, "options": options,
            "answer": list(ma.group(1)) if ma else [],
            "analysis": man.group(1).replace("---", "").strip() if man else "",
            "tags": ["第一章", "第二&三节", "唯物辩证法"],
            "origin": f"第{num}题 · {kind}",
        })
    return questions, subjectives

# ---------------------------------------------------------------- 2024秋期末真题
def parse_final():
    qtext, atext = read("24秋-Question.md"), read("24秋-Answer.md")
    questions, subjectives = [], []

    def sections(text):
        """按 '## 一、xxx' 切块 -> {标题: 文本}"""
        parts = re.split(r"(?m)^##\s+", text)
        out = {}
        for p in parts[1:]:
            head, _, body = p.partition("\n")
            out[head.strip()] = body
        return out

    qs, ans = sections(qtext), sections(atext)

    def parse_choice(body, qtype):
        items = re.split(r"(?m)^(?=\d+\.\s)", body)
        res = []
        for it in items:
            it = it.strip()
            if not re.match(r"^\d+\.\s", it):
                continue
            num = int(re.match(r"^(\d+)\.", it).group(1))
            lines = it.splitlines()
            stem_parts = [re.sub(r"^\d+\.\s*", "", lines[0])]
            k = 1
            while k < len(lines) and not re.match(r"^[A-E]\.\s", lines[k].strip()):
                if lines[k].strip():
                    stem_parts.append(lines[k].strip())
                k += 1
            options, _ = opt_lines(lines, k)
            res.append({"num": num, "type": qtype, "stem": clean(" ".join(stem_parts)),
                        "options": options})
        return res

    def parse_answers(body):
        items = re.split(r"(?m)^(?=###\s*第\d+题)", body)
        out = {}
        for it in items:
            m = re.match(r"^###\s*第(\d+)题", it.strip())
            if not m:
                continue
            ma = re.search(r"\*\*答案：\*{0,2}\s*([A-E]{1,5})\**", it)
            man = re.search(r"\*\*解析\*\*\s*\n?(.*)", it, re.S)
            out[int(m.group(1))] = {
                "answer": list(ma.group(1)) if ma else [],
                "analysis": man.group(1).strip() if man else ""}
        return out

    TYPE_NAMES = {"一": ("单选题", "single"), "二": ("多选题", "multi")}
    for sec_key, body in qs.items():
        for cn, (tname, qtype) in TYPE_NAMES.items():
            if not sec_key.startswith(cn):
                continue
            ans_key = next((k for k in ans if k.startswith(cn)), None)
            ans_map = parse_answers(ans.get(ans_key, ""))
            for q in parse_choice(body, qtype):
                a = ans_map.get(q["num"], {"answer": [], "analysis": ""})
                questions.append({
                    "id": f"final24-{qtype[0]}{q['num']:02d}", "bank": "final-2024",
                    "bankName": "2024秋期末真题（一校三区）", "num": q["num"], "type": qtype,
                    "stem": q["stem"], "options": q["options"], "answer": a["answer"],
                    "analysis": a["analysis"], "tags": ["期末真题", tname],
                    "origin": f"2024秋期末 · {tname}第{q['num']}题",
                })

    # 主观题：简答 / 辨析 / 论述
    def parse_subjective(sec_body, kind, score):
        items = re.split(r"(?m)^(?=###(?!#)\s*)", sec_body)
        out = []
        for it in items:
            m = re.match(r"^###\s*\d*[\.、]?\s*(.+)", it.strip())
            if not m:
                continue
            title = m.group(1).strip().rstrip("。")
            mr = re.search(r"\*\*参考答案\*\*\s*\n?(.*?)(?=\*\*评分要点\*\*|$)", it, re.S)
            mu = re.search(r"\*\*评分要点[^*]*\*\*\s*\n?(.*)", it, re.S)
            out.append({"kind": kind, "score": score, "title": title,
                        "prompt": "", "reference": mr.group(1).strip() if mr else "",
                        "rubric": mu.group(1).strip() if mu else ""})
        return out

    for sec_key, body in ans.items():
        if sec_key.startswith("三"):
            subjectives += parse_subjective(body, "简答题", 7)
        elif sec_key.startswith("四"):
            subjectives += parse_subjective(body, "辨析题", 8)
        elif sec_key.startswith("五"):
            subjectives += parse_subjective(body, "论述题", 13)

    for idx, s in enumerate(subjectives, 1):
        s.update({"id": f"final24-sub-{idx}", "bank": "final-2024",
                  "bankName": "2024秋期末真题（一校三区）",
                  "origin": f"2024秋期末 · {s['kind']}"})
    return questions, subjectives

# ---------------------------------------------------------------- 考研真题
def parse_kaoyan():
    text = read("马原考研题（选择）.md")
    lines = text.splitlines()
    questions, part, sec, sub, i = [], "", "", "", 0
    while i < len(lines):
        ln = lines[i].strip()
        if re.match(r"^#(?!#)\s*[一二三四五六]、", ln):
            part = re.sub(r"^#\s*", "", ln); sec = sub = ""; i += 1; continue
        if ln.startswith("## "):
            sec = ln[3:].strip(); sub = ""; i += 1; continue
        if ln.startswith("### "):
            sub = ln[4:].strip(); i += 1; continue
        mq = re.match(r"^####\s*(\d+)\.\s*(.+?)（(单选|多选|改编多选)）", ln)
        if not mq:
            i += 1; continue
        num, title = int(mq.group(1)), mq.group(2).strip()
        qtype = "multi" if "多选" in mq.group(3) else "single"
        block, i = [], i + 1
        while i < len(lines) and not lines[i].strip().startswith("####") \
                and not lines[i].strip().startswith("## ") \
                and not re.match(r"^#(?!#)\s", lines[i].strip()):
            block.append(lines[i]); i += 1
        raw = "\n".join(block)
        ms = re.search(r"\*\*题干：\*\*\s*(.+?)(?=\n\s*-\s*\*\*[A-E])", raw, re.S)
        options, _ = opt_lines(raw.splitlines(), 0)
        ma = re.search(r"\*\*答案：\*{0,2}\s*([A-E]{1,5})", raw)
        man = re.search(r"\*\*解析：\*\*\s*(.*)", raw, re.S)
        questions.append({
            "id": f"ky-{num:03d}", "bank": "kaoyan", "bankName": "考研政治真题精选",
            "num": num, "type": qtype, "stem": clean(ms.group(1)) if ms else "",
            "options": options, "answer": list(ma.group(1)) if ma else [],
            "analysis": man.group(1).replace("---", "").strip() if man else "",
            "tags": [part, sec] + ([sub] if sub else []),
            "part": part, "section": sec, "subsection": sub,
            "origin": f"考研真题 · {title}",
        })
    return questions

# ---------------------------------------------------------------- 思维导图知识树
def parse_chapters():
    lines = read("chapter-01.md").splitlines()
    root = {"id": "root", "title": "马克思主义哲学 · 知识体系", "level": 0,
            "notes": ["依据 2024 秋课程笔记整理，覆盖导论、唯物论、辩证法三大板块。"], "children": []}
    stack = [root]
    counters = {}
    head_re = re.compile(r"^(#{1,4})\s+(.+)$")
    for ln in lines:
        m = head_re.match(ln)
        if m:
            level = len(m.group(1))
            title = m.group(2).strip()
            if title == "马克思主义哲学笔记":
                continue
            while stack and stack[-1]["level"] >= level:
                stack.pop()
            parent = stack[-1]
            key = parent["id"]
            counters[key] = counters.get(key, 0) + 1
            node = {"id": f"{parent['id']}.{counters[key]}", "title": title,
                    "level": level, "notes": [], "children": []}
            parent["children"].append(node)
            stack.append(node)
        else:
            s = ln.strip()
            if s:
                stack[-1]["notes"].append(re.sub(r"^[-*]\s*", "", s))
    # 裁剪过长笔记（侧栏只承担「导读」，保留前 40 条）
    def trim(n):
        n["notes"] = n["notes"][:40]
        for c in n["children"]:
            trim(c)
    trim(root)
    return root

# ---------------------------------------------------------------- 汇总输出
def main():
    q1 = parse_c1s1()
    q2, s2 = parse_c1s23()
    q3, s3 = parse_final()
    q4 = parse_kaoyan()
    questions = q1 + q2 + q3 + q4
    subjectives = s2 + s3

    # 质量检查
    bad = [q["id"] for q in questions if not q["answer"] or not q["stem"]
           or (q["type"] != "judge" and len(q["options"]) < 2)]
    if bad:
        print("!! 解析不完整的题目：", bad, file=sys.stderr)

    banks = [
        {"id": "c1s1-q1", "name": "第一章第一节 · 课堂小测1", "group": "课堂小测",
         "desc": "世界的多样性与物质的统一性（判断/单选/多选）",
         "count": sum(1 for q in q1 if q["bank"] == "c1s1-q1")},
        {"id": "c1s1-q2", "name": "第一章第一节 · 课堂小测2", "group": "课堂小测",
         "desc": "物质、意识与规律（单选/多选）",
         "count": sum(1 for q in q1 if q["bank"] == "c1s1-q2")},
        {"id": "c1s23", "name": "第一章第二&三节 · 课堂练习", "group": "课堂小测",
         "desc": "联系和发展 & 唯物辩证法（单选/多选）", "count": len(q2)},
        {"id": "final-2024", "name": "2024秋期末真题（一校三区）", "group": "期末真题",
         "desc": "回忆版期末卷客观题部分（单选10 + 多选5）", "count": len(q3)},
        {"id": "kaoyan", "name": "考研政治真题精选", "group": "考研真题",
         "desc": "马哲+政经分章真题（含解析），共 %d 题" % len(q4), "count": len(q4)},
    ]
    json.dump(questions, open(os.path.join(OUT, "questions.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(subjectives, open(os.path.join(OUT, "subjective.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(parse_chapters(), open(os.path.join(OUT, "chapters.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    json.dump(banks, open(os.path.join(OUT, "banks.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"客观题 {len(questions)}（小测 {len(q1)}+{len(q2)} / 期末 {len(q3)} / 考研 {len(q4)}），"
          f"主观题 {len(subjectives)}，思维导图节点已生成。")
    types = {}
    for q in questions:
        types[q["type"]] = types.get(q["type"], 0) + 1
    print("题型分布：", types)

if __name__ == "__main__":
    main()
