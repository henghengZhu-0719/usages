import asyncio
import threading
import time
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from watchdog.events import FileCreatedEvent, FileMovedEvent

from app.notes_index import NotesIndex
from app.watcher import NotesWatcher, _DebouncedHandler


class DebouncedHandlerTests(unittest.TestCase):
    def test_batches_source_and_destination_paths(self):
        received = []
        ready = threading.Event()

        def on_change(batch):
            received.append(batch)
            ready.set()

        with patch("app.watcher.WATCH_DEBOUNCE_SECONDS", 0.02):
            handler = _DebouncedHandler(on_change)
            handler.dispatch(FileCreatedEvent("/notes/one.md"))
            handler.dispatch(FileMovedEvent("/notes/one.md", "/notes/two.md"))
            self.assertTrue(ready.wait(1))
            handler.close()

        self.assertEqual(len(received), 1)
        self.assertEqual(
            received[0].paths,
            frozenset({Path("/notes/one.md"), Path("/notes/two.md")}),
        )

    def test_max_wait_flushes_continuous_events(self):
        ready = threading.Event()
        started = time.monotonic()

        with (
            patch("app.watcher.WATCH_DEBOUNCE_SECONDS", 0.2),
            patch("app.watcher.WATCH_MAX_WAIT_SECONDS", 0.05),
        ):
            handler = _DebouncedHandler(lambda batch: ready.set())
            for number in range(4):
                handler.dispatch(FileCreatedEvent(f"/notes/{number}.md"))
                time.sleep(0.02)
            self.assertTrue(ready.wait(1))
            handler.close()

        self.assertLess(time.monotonic() - started, 0.2)


class _RecordingManager:
    def __init__(self) -> None:
        self.messages = []
        self.received = asyncio.Event()

    async def broadcast(self, message):
        self.messages.append(message)
        self.received.set()


class NotesWatcherIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_polling_observer_updates_index_and_broadcasts_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            index = NotesIndex(root)
            index.rebuild()
            manager = _RecordingManager()

            with (
                patch("app.watcher.WATCH_POLL_SECONDS", 0.03),
                patch("app.watcher.WATCH_DEBOUNCE_SECONDS", 0.02),
            ):
                watcher = NotesWatcher(
                    root, index, manager, asyncio.get_running_loop()
                )
                watcher.start()
                try:
                    await asyncio.sleep(0.06)
                    (root / "live.md").write_text("# Live\nupdated", encoding="utf-8")
                    await asyncio.wait_for(manager.received.wait(), timeout=2)
                finally:
                    watcher.stop()

            self.assertIsNotNone(index.get_note("live.md"))
            self.assertEqual(manager.messages[-1]["event"], "notes_changed")
            self.assertEqual(manager.messages[-1]["changes"]["added"], ["live.md"])


if __name__ == "__main__":
    unittest.main()
