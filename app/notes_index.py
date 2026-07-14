import posixpath
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.markdown_render import extract_title, render_markdown


@dataclass(frozen=True)
class IndexChanges:
    revision: int
    added: tuple[str, ...] = ()
    modified: tuple[str, ...] = ()
    deleted: tuple[str, ...] = ()

    @property
    def changed(self) -> bool:
        return bool(self.added or self.modified or self.deleted)

    def as_message(self) -> dict:
        return {
            "event": "notes_changed",
            "revision": self.revision,
            "changes": {
                "added": list(self.added),
                "modified": list(self.modified),
                "deleted": list(self.deleted),
            },
        }


class NotesIndex:
    """扫描 root_dir 下的所有 .md 文件，维护目录树 + 笔记内容的内存索引。

    启动时全量扫描；监听到文件事件后只重读受影响的 Markdown。
    目录级变化仍可以通过 rebuild() 安全地全量对齐。
    """

    def __init__(self, root_dir: Path):
        self.root_dir = root_dir
        self._lock = threading.RLock()
        self._update_lock = threading.Lock()
        self._tree: list = []
        self._notes: dict = {}
        self._revision = 0

    @property
    def revision(self) -> int:
        with self._lock:
            return self._revision

    @staticmethod
    def _read_note(path: Path) -> Optional[dict]:
        """读取一个稳定的文件快照。

        编辑器原子替换、同步软件和 NAS 上的写入都可能让文件在
        stat/read 之间消失或变化；这种情况不应该让整次更新失败。
        """
        for _ in range(2):
            try:
                before = path.stat()
                if not path.is_file():
                    return None
                raw = path.read_text(encoding="utf-8")
                after = path.stat()
            except (UnicodeDecodeError, OSError):
                return None
            if (before.st_mtime_ns, before.st_size) == (
                after.st_mtime_ns,
                after.st_size,
            ):
                return {
                    "title": extract_title(raw, path.stem),
                    "raw": raw,
                    "mtime": after.st_mtime,
                    "mtime_ns": after.st_mtime_ns,
                    "size": after.st_size,
                }
        return None

    def rebuild(self) -> IndexChanges:
        # watchdog 的 timer 在高频事件下可能前后交叠，防止旧快照
        # 晚于新快照提交，把已经处理的更新覆盖掉。
        with self._update_lock:
            return self._rebuild()

    def _rebuild(self) -> IndexChanges:
        notes = {}
        with self._lock:
            old_snapshot = dict(self._notes)
        if self.root_dir.is_dir():
            for path in self.root_dir.rglob("*"):
                if path.suffix.lower() != ".md":
                    continue
                rel_path = path.relative_to(self.root_dir).as_posix()
                info = self._read_note(path)
                if info is not None:
                    notes[rel_path] = info
                elif rel_path in old_snapshot:
                    # 文件仍在目录快照中，只是正在写入或暂时无法读取。
                    # 保留上一个可用版本，避免短暂从索引中消失。
                    notes[rel_path] = old_snapshot[rel_path]

        tree = self._build_tree(notes)
        with self._lock:
            old_notes = self._notes
            added = sorted(notes.keys() - old_notes.keys())
            deleted = sorted(old_notes.keys() - notes.keys())
            modified = sorted(
                path
                for path in notes.keys() & old_notes.keys()
                if self._note_changed(old_notes[path], notes[path])
            )
            if added or modified or deleted:
                self._revision += 1
            self._notes = notes
            self._tree = tree
            return IndexChanges(
                self._revision, tuple(added), tuple(modified), tuple(deleted)
            )

    @staticmethod
    def _note_changed(old: dict, new: dict) -> bool:
        # raw 是内容依据，mtime_ns 则让“内容相同但文件已替换”
        # 也能正确更新目录中的修改时间。
        return (
            old["raw"] != new["raw"]
            or old["title"] != new["title"]
            or old.get("mtime_ns") != new.get("mtime_ns")
        )

    def update_paths(self, paths: set[Path]) -> IndexChanges:
        """对一批可能新增、修改或删除的路径做增量对齐。"""
        with self._update_lock:
            return self._update_paths(paths)

    def _update_paths(self, paths: set[Path]) -> IndexChanges:
        candidates: dict[str, Optional[dict]] = {}
        for path in paths:
            try:
                rel_path = path.relative_to(self.root_dir).as_posix()
            except ValueError:
                continue
            if path.suffix.lower() != ".md":
                continue
            info = self._read_note(path)
            if info is None and path.exists():
                # 正在写入或暂时不可读；等下一个轮询事件，不把它误判为删除。
                continue
            candidates[rel_path] = info

        with self._lock:
            notes = dict(self._notes)
            added: list[str] = []
            modified: list[str] = []
            deleted: list[str] = []
            for rel_path, info in candidates.items():
                old = notes.get(rel_path)
                if info is None:
                    if old is not None:
                        del notes[rel_path]
                        deleted.append(rel_path)
                elif old is None:
                    notes[rel_path] = info
                    added.append(rel_path)
                elif self._note_changed(old, info):
                    notes[rel_path] = info
                    modified.append(rel_path)
                else:
                    # 内容未变，仍同步更精确的元数据。
                    notes[rel_path] = info

            added.sort()
            modified.sort()
            deleted.sort()
            if added or modified or deleted:
                self._revision += 1
                self._notes = notes
                self._tree = self._build_tree(notes)
            return IndexChanges(
                self._revision, tuple(added), tuple(modified), tuple(deleted)
            )

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

    def get_tree_snapshot(self) -> tuple[list, int]:
        """返回相同索引快照的目录树和版本号。"""
        with self._lock:
            return self._tree, self._revision

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
            "html": render_markdown(raw, posixpath.dirname(rel_path)),
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
