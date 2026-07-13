import os
import tempfile
import unittest
from pathlib import Path

from app.notes_index import NotesIndex


class NotesIndexTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.index = NotesIndex(self.root)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write(self, relative_path: str, content: str) -> Path:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_rebuild_reports_real_changes_and_supports_uppercase_extension(self):
        first = self.write("folder/one.md", "# One\nold")
        second = self.write("TWO.MD", "# Two")

        changes = self.index.rebuild()

        self.assertEqual(changes.added, ("TWO.MD", "folder/one.md"))
        self.assertEqual(changes.revision, 1)
        self.assertIsNotNone(self.index.get_note("TWO.MD"))
        self.assertFalse(self.index.rebuild().changed)
        self.assertEqual(self.index.revision, 1)

        first.write_text("# One\nnew", encoding="utf-8")
        changes = self.index.rebuild()
        self.assertEqual(changes.modified, ("folder/one.md",))
        self.assertEqual(changes.revision, 2)
        self.assertIn("new", self.index.get_note("folder/one.md")["html"])
        self.assertTrue(second.exists())

    def test_incremental_add_modify_move_and_delete(self):
        old_path = self.write("old.md", "# Old")
        self.index.rebuild()

        old_path.write_text("# Updated", encoding="utf-8")
        changes = self.index.update_paths({old_path})
        self.assertEqual(changes.modified, ("old.md",))

        new_path = self.root / "nested/new.md"
        new_path.parent.mkdir()
        old_path.rename(new_path)
        changes = self.index.update_paths({old_path, new_path})
        self.assertEqual(changes.added, ("nested/new.md",))
        self.assertEqual(changes.deleted, ("old.md",))

        new_path.unlink()
        changes = self.index.update_paths({new_path})
        self.assertEqual(changes.deleted, ("nested/new.md",))
        self.assertIsNone(self.index.get_note("nested/new.md"))

    def test_touch_updates_mtime_and_revision(self):
        path = self.write("note.md", "same")
        self.index.rebuild()
        before = self.index.get_note("note.md")["mtime"]

        stat = path.stat()
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
        changes = self.index.update_paths({path})

        self.assertEqual(changes.modified, ("note.md",))
        self.assertGreater(self.index.get_note("note.md")["mtime"], before)


if __name__ == "__main__":
    unittest.main()
