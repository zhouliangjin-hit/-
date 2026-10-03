#!/usr/bin/env python3
"""Parse course-note Markdown into a complete, source-traceable knowledge tree.

Headings and list items are nodes; their own Markdown is retained in ``notes``.
``level`` is tree depth, not the sometimes inconsistent Markdown heading level.
Two narrowly scoped repairs reflect the supplied note's layout: numbered headings
after ``物质`` belong to that heading, and the flat list after ``学习运用辩证思维
方法`` belongs to that ordered item. No philosophical relationships are inferred
from tree edges. Recognized Mermaid diagrams retain their complete source apart
from the prose tree, allowing the browser to draw them without a Mermaid runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
_LIST = re.compile(r"^([ \t]*)(?:(?P<bullet>[-+*])|(?P<number>\d+)[.)、．])\s+(?P<body>.+)$")
_FENCE = re.compile(r"^[ \t]*(`{3,}|~{3,})([^\n]*)$")
_NUMBER = re.compile(
    r"^(?:(?:\d+[.)、．]|[（(]\d+[）)]|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*)+"
)
_CHINESE_NUMBER = re.compile(r"^[一二三四五六七八九十]+(?:、|\s+)\s*")


def _plain(text: str) -> str:
    """Render inline Markdown for labels, leaving the source in notes intact."""
    text = re.sub(r"!?\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.I)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    text = re.sub(r"(?<!\w)[*_]([^*_]+)[*_](?!\w)", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def _without_number(text: str) -> str:
    text = _NUMBER.sub("", text)
    text = _CHINESE_NUMBER.sub("", text)
    text = re.sub(r"^第[一二三四五六七八九十]+[，、:：]\s*", "", text)
    return re.sub(r"^[⭐★✓✅]+\s*", "", text).strip()


def _title(text: str, *, heading: bool = False) -> str:
    """Choose a complete label or clause; never cut a sentence at a length limit."""
    cleaned = _without_number(_plain(text))
    cleaned = re.sub(r"\s*(?:-{2,}\+?|[-+]\+|✓)\s*$", "", cleaned)
    # This source line is the middle of an ASCII brace grouping three
    # properties. Keep the property label clean; its arrow remains in notes.
    cleaned = re.sub(
        r"^(实践性[（(]基本观点[）)])\s*\+->\s*革命性$", r"\1", cleaned,
    )
    if heading:
        # The law headings end with an explanatory scope, retained in notes.
        return re.sub(r"[（(]事物发展的[^）)]*[）)]$", "", cleaned).strip() or cleaned

    # One source item defines several terms separated by semicolons. Naming
    # only its first term would hide the other definitions from the tree.
    definitions = re.findall(r"(?:^|[；;])\s*([^；;:：。]{1,8})[：:]", cleaned)
    if len(definitions) > 1:
        return "、".join(dict.fromkeys(term.strip() for term in definitions)) + "的含义"

    emphasized = re.match(r"^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩]\s*)?\*\*(.+?)\*\*", text)
    if emphasized:
        label = _without_number(_plain(emphasized.group(1))).rstrip("：:")
        if label and len(label) <= 38:
            return label

    # Definitions have a natural term/description boundary. Colons inside a
    # parenthesis belong to that parenthesis, rather than defining the label.
    depth = 0
    for index, char in enumerate(cleaned):
        if char in "（(":
            depth += 1
        elif char in "）)":
            depth = max(0, depth - 1)
        elif char in "：:" and depth == 0 and index > 0:
            return cleaned[:index].rstrip("?？ ") or cleaned

    if len(cleaned) > 32:
        opening = re.search(r"[（(]", cleaned)
        if opening and opening.start() >= 2:
            prefix = cleaned[:opening.start()].strip()
            if len(prefix) <= 32:
                return prefix
        # A whole first clause is a readable label for long prose. The full
        # sentence, including later clauses, is always retained in notes.
        for boundary in re.finditer(r"[。；;，,]", cleaned):
            clause = cleaned[:boundary.start()]
            if 10 <= len(clause) <= 50:
                return clause
    return cleaned or _plain(text)


def _source_name(path: Path) -> str:
    for directory in path.parents:
        if directory.name == "mindmap":
            return path.relative_to(directory.parent).as_posix()
    return path.name


@dataclass
class _ListFrame:
    indent: int
    content_indent: int
    node: dict


class _Parser:
    def __init__(self, path: Path):
        self.lines = path.read_text(encoding="utf-8-sig").splitlines()
        self.file = _source_name(path)
        self.root = self._node(path.stem, "heading", 1)
        self.root["id"] = "root"
        self.headings: list[tuple[int, dict]] = [(0, self.root)]
        self.container = self.root
        self.lists: list[_ListFrame] = []
        self.material: tuple[int, dict] | None = None
        self.flat_list_owner: _ListFrame | None = None
        self.paragraph: dict | None = None
        self.blank = True
        self.text_lines = 0
        self.diagram_count = 0

    def _node(self, title: str, kind: str, line: int) -> dict:
        return {
            "id": "", "title": title, "level": 0, "kind": kind,
            "notes": [], "children": [],
            "source": {"file": self.file, "line": line, "endLine": line},
        }

    def _record(self, node: dict, raw: str, line: int) -> None:
        if raw.strip():
            node["notes"].append(raw.strip())
            node["source"]["endLine"] = line
            self.text_lines += 1

    def _heading(self, match: re.Match, raw: str, line: int) -> None:
        raw_level, body = len(match[1]), match[2]
        title = _title(body, heading=True)
        # The first H1 is the document title, rather than a redundant child.
        if raw_level == 1 and not self.root["notes"] and not self.root["children"]:
            node = self.root
            node["title"] = title
            node["source"]["line"] = line
        else:
            material_child = (
                self.material is not None
                and raw_level == self.material[0]
                and bool(_NUMBER.match(_plain(body)))
            )
            if material_child:
                while self.headings[-1][1] is not self.material[1]:
                    self.headings.pop()
            else:
                if self.material and raw_level <= self.material[0]:
                    self.material = None
                while len(self.headings) > 1 and self.headings[-1][0] >= raw_level:
                    self.headings.pop()
            node = self._node(title, "heading", line)
            self.headings[-1][1]["children"].append(node)
            self.headings.append((raw_level, node))
            if title == "物质":
                self.material = (raw_level, node)
        self._record(node, raw, line)
        self.container = node
        self.lists = []
        self.flat_list_owner = None
        self.paragraph = None
        self.blank = False

    def _list(self, match: re.Match, raw: str, line: int) -> None:
        source_indent = len(match[1].expandtabs(4))
        body = match["body"]
        ordered = match["number"] is not None
        # The supplied method list is flush with its ordered owner. Shift only
        # that owner's unordered run, so the next ordered task remains a peer.
        if ordered:
            self.flat_list_owner = None
        indent = source_indent + (1 if self.flat_list_owner else 0)
        while self.lists and self.lists[-1].indent >= indent:
            self.lists.pop()
        parent = self.lists[-1].node if self.lists else self.container
        node = self._node(_title(body), "concept", line)
        parent["children"].append(node)
        self._record(node, raw, line)
        frame = _ListFrame(indent, match.start("body"), node)
        self.lists.append(frame)
        if ordered and node["title"] == "学习运用辩证思维方法":
            self.flat_list_owner = frame
        self.paragraph = None
        self.blank = False

    def _next_is_list(self, index: int) -> bool:
        for raw in self.lines[index + 1:]:
            if raw.strip():
                return _LIST.match(raw) is not None
        return False

    def _prose(self, raw: str, index: int) -> None:
        line = index + 1
        stripped = raw.strip()
        indent = len(raw) - len(raw.lstrip(" \t"))
        lead_in = bool(re.fullmatch(r"\*\*.+\*\*", stripped)) and self._next_is_list(index)
        if lead_in:
            node = self._node(_title(stripped), "concept", line)
            self.headings[-1][1]["children"].append(node)
            self.container = node
            self.lists = []
            self.flat_list_owner = None
            self.paragraph = None
        elif self.lists and (not self.blank or indent >= self.lists[-1].content_indent):
            # Markdown permits adjacent lazy continuations. An unindented
            # paragraph after a blank line stays at the section level instead.
            node = self.lists[-1].node
        elif self.paragraph is not None and not self.blank:
            node = self.paragraph
        else:
            node = self._node(_title(stripped), "detail", line)
            self.headings[-1][1]["children"].append(node)
            self.paragraph = node
            self.container = self.headings[-1][1]
            self.lists = []
            self.flat_list_owner = None
        self._record(node, raw, line)
        self.blank = False

    def _code(self, index: int, match: re.Match) -> int:
        fence, language = match[1], match[2].strip().lower()
        end = index + 1
        closing = re.compile(r"^[ \t]*" + re.escape(fence[0]) + "{" + str(len(fence)) + r",}\s*$")
        while end < len(self.lines) and not closing.match(self.lines[end]):
            end += 1
        has_closing = end < len(self.lines)
        stop = end + 1 if has_closing else end
        source = "\n".join(self.lines[index + 1:end])
        diagram_type = None
        if language == "mermaid":
            if "否定之否定" in source:
                diagram_type = "negation"
            elif "量变" in source and "质变" in source:
                diagram_type = "quantity-change"
        owner = self.headings[-1][1]
        if diagram_type:
            owner.setdefault("diagrams", []).append({
                "type": diagram_type,
                "title": owner["title"],
                "source": source,
                "sourceMarkdown": "\n".join(self.lines[index:stop]),
                "sourceLocation": {"file": self.file, "line": index + 1, "endLine": stop},
            })
            owner["source"]["endLine"] = stop
            self.diagram_count += 1
        else:
            # Unknown diagrams and ordinary code are preserved as notes, not
            # guessed into one of the two supported diagram semantics.
            for offset in range(index, stop):
                self._record(owner, self.lines[offset], offset + 1)
        self.paragraph = None
        self.blank = True
        return stop

    def parse(self) -> dict:
        index = 0
        while index < len(self.lines):
            raw = self.lines[index]
            if not raw.strip():
                self.blank = True
                index += 1
                continue
            fence = _FENCE.match(raw)
            if fence:
                index = self._code(index, fence)
                continue
            heading = _HEADING.match(raw)
            item = _LIST.match(raw)
            if heading:
                self._heading(heading, raw, index + 1)
            elif item:
                self._list(item, raw, index + 1)
            else:
                self._prose(raw, index)
            index += 1

        node_count = 0

        def finish(node: dict, node_id: str, depth: int) -> None:
            nonlocal node_count
            node_count += 1
            node["id"], node["level"] = node_id, depth
            if node["kind"] != "heading" and not node["children"] and len(node["title"]) > 32:
                node["kind"] = "detail"
            for child_index, child in enumerate(node["children"], 1):
                finish(child, f"{node_id}.{child_index}", depth + 1)
                node["source"]["endLine"] = max(node["source"]["endLine"], child["source"]["endLine"])

        finish(self.root, "root", 0)
        self.root["metadata"] = {
            "source": self.file,
            # Nonempty source text lines, including headings/list/prose/code,
            # excluding supported Mermaid blocks (both fences and their code).
            "sourceLines": self.text_lines,
            "totalLines": len(self.lines),
            "nodeCount": node_count,
            "diagramCount": self.diagram_count,
        }
        return self.root


def parse_mindmap(path: Path) -> dict:
    """Return the complete knowledge tree from one UTF-8 Markdown source file."""
    return _Parser(Path(path)).parse()
