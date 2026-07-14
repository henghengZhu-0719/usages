import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.auth import require_auth
from app.config import NOTES_DIR
from app.notes_index import NotesIndex
from app.watcher import NotesWatcher
from app.ws_manager import ConnectionManager

root_dir = Path(NOTES_DIR)
index = NotesIndex(root_dir)
manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    index.rebuild()

    watcher = NotesWatcher(root_dir, index, manager, asyncio.get_running_loop())
    if root_dir.is_dir():
        watcher.start()
    else:
        print(f"[warn] NOTES_DIR 不存在，跳过文件监听: {root_dir}")

    yield

    watcher.stop()


app = FastAPI(title="NAS Markdown 笔记浏览器", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/notes")
async def api_get_tree(_: bool = Depends(require_auth)):
    tree, revision = index.get_tree_snapshot()
    return {"tree": tree, "revision": revision}


@app.get("/api/notes/{note_path:path}")
async def api_get_note(note_path: str, _: bool = Depends(require_auth)):
    note = index.get_note(note_path)
    if note is None:
        raise HTTPException(status_code=404, detail="笔记不存在")
    return note


@app.get("/api/search")
async def api_search(q: str = "", _: bool = Depends(require_auth)):
    return {"results": index.search(q)}


@app.websocket("/ws/updates")
async def ws_updates(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await websocket.send_json({"event": "connected", "revision": index.revision})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
