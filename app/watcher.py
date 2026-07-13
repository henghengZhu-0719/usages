import asyncio
import threading
from pathlib import Path
from typing import Optional

from watchdog.events import FileSystemEventHandler
from watchdog.observers.polling import PollingObserver

from app.config import WATCH_DEBOUNCE_SECONDS, WATCH_POLL_SECONDS
from app.notes_index import NotesIndex
from app.ws_manager import ConnectionManager


class _DebouncedHandler(FileSystemEventHandler):
    """把短时间内的多个文件事件合并成一次回调，避免编辑器保存时触发的
    多次 created/modified/moved 事件导致重复重建索引。"""

    def __init__(self, on_change):
        super().__init__()
        self._on_change = on_change
        self._timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()

    def _schedule(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(WATCH_DEBOUNCE_SECONDS, self._on_change)
            self._timer.daemon = True
            self._timer.start()

    def on_created(self, event):
        self._schedule()

    def on_deleted(self, event):
        self._schedule()

    def on_modified(self, event):
        if event.is_directory:
            return
        self._schedule()

    def on_moved(self, event):
        self._schedule()


class NotesWatcher:
    def __init__(
        self,
        root_dir: Path,
        index: NotesIndex,
        manager: ConnectionManager,
        loop: asyncio.AbstractEventLoop,
    ):
        self._root_dir = root_dir
        self._index = index
        self._manager = manager
        self._loop = loop
        # NAS 上的 bind mount、网络盘和同步软件经常无法可靠传递 inotify
        # 事件。PollingObserver 通过比较目录快照检测变化，兼容性更好。
        self._observer = PollingObserver(timeout=WATCH_POLL_SECONDS)
        self._started = False

    def _handle_change(self) -> None:
        self._index.rebuild()
        print("[notes] 检测到文件变化，索引已更新", flush=True)
        asyncio.run_coroutine_threadsafe(
            self._manager.broadcast({"event": "notes_changed"}), self._loop
        )

    def start(self) -> None:
        handler = _DebouncedHandler(self._handle_change)
        self._observer.schedule(handler, str(self._root_dir), recursive=True)
        self._observer.start()
        self._started = True
        print(
            f"[notes] 正在轮询 {self._root_dir}，间隔 {WATCH_POLL_SECONDS:g} 秒",
            flush=True,
        )

    def stop(self) -> None:
        if self._started:
            self._observer.stop()
            self._observer.join(timeout=5)
