import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

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


@app.get("/api/files/{file_path:path}")
async def api_get_file(file_path: str, _: bool = Depends(require_auth)):
    """给笔记正文里引用的图片/附件提供原文件访问，路径限定在笔记根目录内。"""
    target = (root_dir / file_path).resolve()
    try:
        target.relative_to(root_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not target.is_file() or target.suffix.lower() == ".md":
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(target)


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
