"""Distribution guarantees, including untrusted note text in inline scripts."""
import json
import unittest
from html.parser import HTMLParser
from unittest.mock import patch

import build_offline


class ResourceReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.external = []
        self.portraits = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        reference = attrs.get("src") if tag in ("script", "img") else None
        if tag == "link" and attrs.get("rel") == "stylesheet":
            reference = attrs.get("href")
        if reference and not reference.startswith("data:"):
            self.external.append(reference)
        if tag == "img" and attrs.get("src", "").startswith("data:image/png;base64,"):
            self.portraits += 1


class OfflineBuildTests(unittest.TestCase):
    def test_note_text_cannot_close_inline_script(self):
        data = {"notes": ["</script><script>throw 'injected'</script>", "a\u2028b\u2029c", "<物质> & 意识"]}
        script = build_offline.javascript_data(data)
        self.assertNotIn("</script", script.lower())
        self.assertNotIn("\u2028", script)
        self.assertNotIn("\u2029", script)
        recovered = json.loads(script.split("window.MAYUAN_DATA = ", 1)[1].removesuffix(";\n"))
        self.assertEqual(data, recovered)

    def test_resource_audit_ignores_application_markup_strings(self):
        template = '<html><script src="assets/app.js"></script></html>'
        source = 'const portrait = "data:image/png;base64,test"; const ui = `<img src="${portrait}">`;'
        with patch.object(build_offline, "read_web_asset", return_value=source):
            result = build_offline.standalone_html(template)
        parser = ResourceReferences()
        parser.feed(result)
        self.assertEqual([], parser.external)
        self.assertIn(source, result)

    def test_single_file_has_no_external_resource_references(self):
        output = build_offline.OFFLINE_ROOT / build_offline.OUTPUT_NAME
        self.assertTrue(output.is_file(), "Run build_offline.py before checking the distribution")
        parser = ResourceReferences()
        parser.feed(output.read_text(encoding="utf-8"))
        self.assertEqual([], parser.external)
        self.assertEqual(1, parser.portraits, "The homepage should reuse the same embedded PNG")


if __name__ == "__main__":
    unittest.main()
