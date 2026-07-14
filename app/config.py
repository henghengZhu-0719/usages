import os

NOTES_DIR = os.environ.get("NOTES_DIR", "/notes")

# 留空则不启用鉴权
AUTH_USER = os.environ.get("AUTH_USER", "")
AUTH_PASS = os.environ.get("AUTH_PASS", "")

# 文件变化后合并事件、触发重建索引前的等待时间（秒）
WATCH_DEBOUNCE_SECONDS = float(os.environ.get("WATCH_DEBOUNCE_SECONDS", "0.5"))

# 持续有文件写入时，普通 debounce 会被不断推迟。达到该时间后强制处理一批事件。
WATCH_MAX_WAIT_SECONDS = float(os.environ.get("WATCH_MAX_WAIT_SECONDS", "2"))

# NAS 的 bind mount / 同步软件不一定可靠转发 inotify 事件，默认轮询更稳妥
WATCH_POLL_SECONDS = float(os.environ.get("WATCH_POLL_SECONDS", "2"))
