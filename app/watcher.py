import asyncio
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from watchdog.events import FileSystemEventHandler
from watchdog.observers.polling import PollingObserver

from app.config import (
    WATCH_DEBOUNCE_SECONDS,
    WATCH_MAX_WAIT_SECONDS,
    WATCH_POLL_SECONDS,
)
from app.notes_index import NotesIndex
from app.ws_manager import ConnectionManager


@dataclass(frozen=True)
class WatchBatch:
    paths: frozenset[Path]
    full_rescan: bool = False


class _DebouncedHandler(FileSystemEventHandler):
    """把短时间内的多个文件事件合并成一次回调，避免编辑器保存时触发的
    多次 created/modified/moved 事件导致重复重建索引。"""

    def __init__(self, on_change):
        super().__init__()
        self._on_change = on_change
        self._timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()
        self._paths: set[Path] = set()
        self._full_rescan = False
        self._first_event_at: Optional[float] = None
        self._closed = False

    def _schedule(self, event) -> None:
        with self._lock:
            if self._closed:
                return
            now = time.monotonic()
            if self._first_event_at is None:
                self._first_event_at = now

            if event.is_directory:
                self._full_rescan = True
            else:
                self._paths.add(Path(event.src_path))
                dest_path = getattr(event, "dest_path", None)
                if dest_path:
                    self._paths.add(Path(dest_path))

            if self._timer is not None:
                self._timer.cancel()
            elapsed = now - self._first_event_at
            delay = min(
                WATCH_DEBOUNCE_SECONDS,
                max(0.0, WATCH_MAX_WAIT_SECONDS - elapsed),
            )
            self._timer = threading.Timer(delay, self._flush)
            self._timer.daemon = True
            self._timer.start()

    def _flush(self) -> None:
        with self._lock:
            if self._closed:
                return
            batch = WatchBatch(frozenset(self._paths), self._full_rescan)
            self._paths.clear()
            self._full_rescan = False
            self._first_event_at = None
            self._timer = None
        self._on_change(batch)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def on_created(self, event):
        self._schedule(event)

    def on_deleted(self, event):
        self._schedule(event)

    def on_modified(self, event):
        self._schedule(event)

    def on_moved(self, event):
        self._schedule(event)


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
        self._handler: Optional[_DebouncedHandler] = None

    def _handle_change(self, batch: WatchBatch) -> None:
        changes = (
            self._index.rebuild()
            if batch.full_rescan
            else self._index.update_paths(set(batch.paths))
        )
        if not changes.changed:
            return
        print(
            "[notes] 索引已更新 "
            f"revision={changes.revision} "
            f"added={len(changes.added)} modified={len(changes.modified)} "
            f"deleted={len(changes.deleted)}",
            flush=True,
        )
        future = asyncio.run_coroutine_threadsafe(
            self._manager.broadcast(changes.as_message()), self._loop
        )
        future.add_done_callback(self._log_broadcast_error)

    @staticmethod
    def _log_broadcast_error(future) -> None:
        error = future.exception()
        if error is not None:
            print(f"[notes] 推送更新失败: {error}", flush=True)

    def start(self) -> None:
        self._handler = _DebouncedHandler(self._handle_change)
        self._observer.schedule(self._handler, str(self._root_dir), recursive=True)
        self._observer.start()
        self._started = True
        print(
            f"[notes] 正在轮询 {self._root_dir}，间隔 {WATCH_POLL_SECONDS:g} 秒",
            flush=True,
        )

    def stop(self) -> None:
        if self._handler is not None:
            self._handler.close()
        if self._started:
            self._observer.stop()
            self._observer.join(timeout=5)
