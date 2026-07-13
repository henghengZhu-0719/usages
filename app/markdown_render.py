import re

import markdown

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


def render_markdown(raw_text: str) -> str:
    return markdown.markdown(
        raw_text,
        extensions=_MD_EXTENSIONS,
        extension_configs=_MD_EXTENSION_CONFIGS,
    )
