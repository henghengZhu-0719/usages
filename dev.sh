#!/usr/bin/env bash
# 本地开发：同时启动后端 FastAPI (8000) 和前端 Vite dev server (5173)
# 用法: ./dev.sh            # 用 sample-notes 作为笔记目录
#       NOTES_DIR=/your/notes ./dev.sh   # 指定自己的笔记目录
set -euo pipefail
cd "$(dirname "$0")"

export NOTES_DIR="${NOTES_DIR:-$(pwd)/sample-notes}"
echo "NOTES_DIR=$NOTES_DIR"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

if [ ! -d web/node_modules ]; then
  (cd web && npm install)
fi

uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

(cd web && npm run dev) &
FRONTEND_PID=$!

cleanup() {
  echo "停止服务..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "后端: http://localhost:8000"
echo "前端: http://localhost:5173"
wait
