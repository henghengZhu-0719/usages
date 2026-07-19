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

# AI Chat：OpenAI 兼容服务（与 config.toml 保持一致）
CHAT_BASE_URL = os.environ.get("CHAT_BASE_URL", "http://107.174.167.44:8080/v1")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "gpt-5.6-sol")
# 密钥只从环境变量读，不要写进代码仓库
CHAT_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# 发给模型前保留的最大上下文 token，超长时裁掉最早的对话
CHAT_MAX_TOKENS = int(os.environ.get("CHAT_MAX_TOKENS", "8000"))
