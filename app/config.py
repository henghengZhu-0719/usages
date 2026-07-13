import os

NOTES_DIR = os.environ.get("NOTES_DIR", "/notes")
STATIC_DIR = os.environ.get("STATIC_DIR", "web/dist")

# 留空则不启用鉴权
AUTH_USER = os.environ.get("AUTH_USER", "")
AUTH_PASS = os.environ.get("AUTH_PASS", "")

# 文件变化后合并事件、触发重建索引前的等待时间（秒）
WATCH_DEBOUNCE_SECONDS = float(os.environ.get("WATCH_DEBOUNCE_SECONDS", "0.5"))

# NAS 的 bind mount / 同步软件不一定可靠转发 inotify 事件，默认轮询更稳妥
WATCH_POLL_SECONDS = float(os.environ.get("WATCH_POLL_SECONDS", "2"))
