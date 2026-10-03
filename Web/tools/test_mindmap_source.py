"""Content and hierarchy regressions for the authoritative course-note source."""

from collections import Counter
from pathlib import Path
import tempfile
import unittest

from mindmap_source import parse_mindmap


SOURCE = Path(__file__).resolve().parents[2] / "mindmap" / "chapter-01.md"


def walk(node):
    yield node
    for child in node["children"]:
        yield from walk(child)


class CourseNoteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = parse_mindmap(SOURCE)
        cls.nodes = list(walk(cls.root))
        cls.by_line = {node["source"]["line"]: node for node in cls.nodes}
        cls.lines = SOURCE.read_text(encoding="utf-8-sig").splitlines()

    def test_every_nonempty_source_line_is_retained_exactly_once(self):
        # Compare source content, rather than duplicating the parser's token
        # rules: every note and every native diagram's source must account for
        # the entire document, including the old parser's lost late sections.
        retained = Counter(note.strip() for node in self.nodes for note in node["notes"])
        for node in self.nodes:
            for diagram in node.get("diagrams", []):
                retained.update(line.strip() for line in diagram["sourceMarkdown"].splitlines() if line.strip())
        expected = Counter(line.strip() for line in self.lines if line.strip())
        self.assertEqual(retained, expected)

    def test_firstness_identity_and_practice_keep_their_branches(self):
        question = self.by_line[20]
        self.assertEqual([node["source"]["line"] for node in question["children"]], [22, 30, 34])
        materialism = self.by_line[23]
        self.assertEqual([node["source"]["line"] for node in materialism["children"]], [24, 25, 26])
        self.assertEqual([node["source"]["line"] for node in self.by_line[40]["children"]], [41, 42, 43])

    def test_ascii_property_group_has_clean_labels_and_complete_source(self):
        self.assertEqual(self.by_line[14]["title"], "人民性（本质属性）")
        self.assertEqual(self.by_line[15]["title"], "实践性（基本观点）")
        self.assertEqual(self.by_line[16]["title"], "发展性")
        self.assertEqual(self.by_line[15]["notes"], [self.lines[14].strip()])
        self.assertIn("+->革命性", self.by_line[15]["notes"][0])
        self.assertEqual(self.by_line[59]["title"], "物 —决定→ 意;意 —反作用→ 物")

    def test_material_numbered_headings_belong_to_material(self):
        self.assertEqual([node["source"]["line"] for node in self.by_line[46]["children"]], [48, 53, 57])
        self.assertIn(self.by_line[46], self.by_line[18]["children"])
        self.assertNotIn(self.by_line[48], self.by_line[18]["children"])

    def test_combined_definitions_label_all_three_terms(self):
        definition = self.by_line[154]
        self.assertEqual(definition["title"], "质、量、度的含义")
        self.assertEqual(definition["notes"], [self.lines[153].strip()])

    def test_five_categories_four_methods_and_seven_abilities(self):
        self.assertEqual(
            [node["title"] for node in self.by_line[221]["children"]],
            ["内容与形式", "本质与现象", "原因与结果", "必然与偶然", "现实与可能"],
        )
        self.assertEqual([node["source"]["line"] for node in self.by_line[254]["children"]], [255, 256, 277])
        self.assertEqual(
            [node["title"] for node in self.by_line[256]["children"]],
            ["归纳与演绎", "分析与综合", "抽象与具体", "逻辑与历史"],
        )
        self.assertEqual(
            [node["title"] for node in self.by_line[277]["children"]],
            ["辩证思维能力", "历史思维能力", "系统思维能力", "创新思维能力", "战略思维能力", "底线思维能力", "法治思维能力"],
        )
        self.assertEqual(self.by_line[277]["notes"], ["1. **不断增强思维能力**"])

    def test_long_ai_and_negation_explanations_are_complete(self):
        self.assertEqual([node["source"]["line"] for node in self.by_line[74]["children"]], [75, 76, 77, 78])
        for source_line in (75, 76, 77, 78, 146, 196, 197, 312):
            self.assertEqual(self.by_line[source_line]["notes"], [self.lines[source_line - 1].strip()])
        self.assertIn("不存在不被否定的终点", self.by_line[196]["notes"][0])

    def test_mermaid_is_attached_to_its_law_and_keeps_actual_source(self):
        quantity = self.by_line[152]["diagrams"][0]
        negation = self.by_line[183]["diagrams"][0]
        self.assertEqual(quantity["type"], "quantity-change")
        self.assertEqual(negation["type"], "negation")
        self.assertEqual(quantity["source"], "\n".join(self.lines[156:171]))
        self.assertEqual(negation["source"], "\n".join(self.lines[199:209]))
        self.assertEqual(quantity["sourceLocation"]["line"], 156)
        self.assertEqual(negation["sourceLocation"]["endLine"], 210)
        self.assertFalse(any("style self" in note for node in self.nodes for note in node["notes"]))

    def test_schema_depth_unique_ids_and_source_ranges(self):
        self.assertEqual(self.root["id"], "root")
        self.assertEqual(len({node["id"] for node in self.nodes}), len(self.nodes))
        for node in self.nodes:
            self.assertEqual(node["source"]["file"], "mindmap/chapter-01.md")
            self.assertIn(node["kind"], {"heading", "concept", "detail"})
            self.assertTrue(node["title"])
            self.assertNotIn("**", node["title"])
            self.assertGreaterEqual(node["source"]["endLine"], node["source"]["line"])
            for child in node["children"]:
                self.assertEqual(child["level"], node["level"] + 1)
                self.assertLessEqual(child["source"]["endLine"], node["source"]["endLine"])
        metadata = self.root["metadata"]
        diagram_lines = sum(
            len([line for line in diagram["sourceMarkdown"].splitlines() if line.strip()])
            for node in self.nodes for diagram in node.get("diagrams", [])
        )
        self.assertEqual(metadata["nodeCount"], len(self.nodes))
        self.assertEqual(metadata["sourceLines"], sum(bool(line.strip()) for line in self.lines) - diagram_lines)
        self.assertEqual(metadata["totalLines"], len(self.lines))
        self.assertEqual(metadata["diagramCount"], 2)


class GeneralMarkdownTests(unittest.TestCase):
    def parse(self, text):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "notes.md"
            path.write_text(text, encoding="utf-8")
            return parse_mindmap(path)

    def test_arbitrary_nested_ordered_and_unordered_lists(self):
        root = self.parse("# Notes\n## Topic\n1. First\n   - Child\n      1. Grandchild\n   - Peer\n2. Second\n\n### Subtopic\n- Last\n")
        topic = root["children"][0]
        first, second, subtopic = topic["children"]
        self.assertEqual([child["title"] for child in first["children"]], ["Child", "Peer"])
        self.assertEqual(first["children"][0]["children"][0]["title"], "Grandchild")
        self.assertEqual(second["title"], "Second")
        self.assertEqual(subtopic["children"][0]["title"], "Last")

    def test_irregular_indentation_does_not_drop_items(self):
        root = self.parse("# Notes\n - Parent\n      - Child\n        - Grandchild\n    - Second child\n- Peer\n")
        parent, peer = root["children"]
        self.assertEqual([child["title"] for child in parent["children"]], ["Child", "Second child"])
        self.assertEqual(parent["children"][0]["children"][0]["title"], "Grandchild")
        self.assertEqual(peer["title"], "Peer")

    def test_more_than_forty_continuation_lines_are_not_trimmed(self):
        continuations = [f"  explanation {index}" for index in range(1, 65)]
        root = self.parse("# Notes\n- Concept\n" + "\n".join(continuations) + "\n")
        node = root["children"][0]
        self.assertEqual(len(node["notes"]), 65)
        self.assertEqual(node["notes"][-1], "explanation 64")
        self.assertEqual(node["source"]["endLine"], 66)

    def test_prose_and_unrecognized_code_are_preserved(self):
        text = "# Notes\n## Topic\nA paragraph.\nIts next line.\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n```python\nprint('hello')\n```\n"
        root = self.parse(text)
        topic = root["children"][0]
        self.assertNotIn("diagrams", topic)
        self.assertEqual(topic["children"][0]["notes"], ["A paragraph.", "Its next line."])
        retained = [note for node in walk(root) for note in node["notes"]]
        self.assertEqual(Counter(retained), Counter(line.strip() for line in text.splitlines() if line.strip()))


if __name__ == "__main__":
    unittest.main()
