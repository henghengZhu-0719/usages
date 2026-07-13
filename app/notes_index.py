import threading
from pathlib import Path
from typing import Optional

from app.markdown_render import extract_title, render_markdown


class NotesIndex:
    """扫描 root_dir 下的所有 .md 文件，维护目录树 + 笔记内容的内存索引。

    rebuild() 每次做全量重扫，笔记规模不大（个人笔记）时足够快，
    避免维护增量更新逻辑的复杂度。
    """

    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self._lock = threading.RLock()
        self._tree: list = []
        self._notes: dict = {}

    def rebuild(self) -> None:
        notes = {}
        if self.root_dir.is_dir():
            for path in self.root_dir.rglob("*.md"):
                if not path.is_file():
                    continue
                rel_path = path.relative_to(self.root_dir).as_posix()
                try:
                    raw = path.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                notes[rel_path] = {
                    "title": extract_title(raw, path.stem),
                    "raw": raw,
                    "mtime": path.stat().st_mtime,
                }

        tree = self._build_tree(notes)
        with self._lock:
            self._notes = notes
            self._tree = tree

    @staticmethod
    def _build_tree(notes: dict) -> list:
        root: dict = {}
        for rel_path, info in notes.items():
            parts = rel_path.split("/")
            node = root
            for i, part in enumerate(parts):
                if i == len(parts) - 1:
                    node.setdefault("__files__", []).append((part, rel_path, info))
                else:
                    node = node.setdefault("__dirs__", {}).setdefault(part, {})

        def to_list(node: dict, prefix: str) -> list:
            items = []
            for name, child in sorted(node.get("__dirs__", {}).items()):
                child_prefix = f"{prefix}{name}/"
                items.append(
                    {
                        "name": name,
                        "path": child_prefix.rstrip("/"),
                        "type": "dir",
                        "children": to_list(child, child_prefix),
                    }
                )
            for name, rel_path, info in sorted(
                node.get("__files__", []), key=lambda x: x[0]
            ):
                items.append(
                    {
                        "name": name,
                        "path": rel_path,
                        "type": "file",
                        "title": info["title"],
                        "mtime": info["mtime"],
                    }
                )
            return items

        return to_list(root, "")

    def get_tree(self) -> list:
        with self._lock:
            return self._tree

    def get_note(self, rel_path: str) -> Optional[dict]:
        with self._lock:
            info = self._notes.get(rel_path)
            if info is None:
                return None
            raw = info["raw"]
            title = info["title"]
            mtime = info["mtime"]
        return {
            "path": rel_path,
            "title": title,
            "html": render_markdown(raw),
            "mtime": mtime,
        }

    def search(self, query: str, limit: int = 30) -> list:
        query = query.strip().lower()
        if not query:
            return []

        with self._lock:
            items = list(self._notes.items())

        results = []
        for rel_path, info in items:
            title_l = info["title"].lower()
            raw_l = info["raw"].lower()
            idx = raw_l.find(query)
            if query not in title_l and idx < 0:
                continue
            if idx >= 0:
                start = max(0, idx - 40)
                snippet = info["raw"][start : idx + 40].replace("\n", " ")
            else:
                snippet = info["raw"][:80].replace("\n", " ")
            results.append({"path": rel_path, "title": info["title"], "snippet": snippet})

        results.sort(key=lambda r: (query not in r["title"].lower(), r["path"]))
        return results[:limit]
