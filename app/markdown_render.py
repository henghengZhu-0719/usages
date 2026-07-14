import posixpath
import re
from urllib.parse import quote, urlsplit

import markdown
from markdown.extensions import Extension
from markdown.treeprocessors import Treeprocessor

_TITLE_RE = re.compile(r"^\s*#\s+(.+?)\s*$", re.MULTILINE)

_MD_EXTENSIONS = ["extra", "codehilite", "toc", "sane_lists"]
_MD_EXTENSION_CONFIGS = {
    "codehilite": {"guess_lang": False},
}


def extract_title(raw_text: str, fallback: str) -> str:
    match = _TITLE_RE.search(raw_text)
    if match:
        return match.group(1)
    return fallback


def _is_relative_url(url: str) -> bool:
    if not url or url.startswith(("#", "data:", "mailto:", "tel:", "/")):
        return False
    return not urlsplit(url).scheme


def _resolve_relative_url(note_dir: str, url: str) -> str:
    """把笔记正文里的相对路径（图片/附件）改写成 /api/files/ 下的可访问地址。"""
    split = urlsplit(url)
    resolved = posixpath.normpath(posixpath.join(note_dir, split.path))
    if resolved == "." or resolved.startswith(".."):
        # 越出笔记根目录，不改写，交由浏览器按原样处理（大概率访问不到）。
        return url
    suffix = f"#{split.fragment}" if split.fragment else ""
    return f"/api/files/{quote(resolved)}{suffix}"


class _RelativeLinkTreeprocessor(Treeprocessor):
    def __init__(self, md, note_dir: str):
        super().__init__(md)
        self.note_dir = note_dir

    def run(self, root):
        for img in root.iter("img"):
            src = img.get("src")
            if src and _is_relative_url(src):
                img.set("src", _resolve_relative_url(self.note_dir, src))
        for anchor in root.iter("a"):
            href = anchor.get("href")
            if href and _is_relative_url(href):
                anchor.set("href", _resolve_relative_url(self.note_dir, href))
        return root


class _RelativeLinkExtension(Extension):
    def __init__(self, note_dir: str):
        self.note_dir = note_dir

    def extendMarkdown(self, md):
        md.treeprocessors.register(
            _RelativeLinkTreeprocessor(md, self.note_dir), "relative_links", 5
        )


def render_markdown(raw_text: str, note_dir: str = "") -> str:
    return markdown.markdown(
        raw_text,
        extensions=[*_MD_EXTENSIONS, _RelativeLinkExtension(note_dir)],
        extension_configs=_MD_EXTENSION_CONFIGS,
    )
