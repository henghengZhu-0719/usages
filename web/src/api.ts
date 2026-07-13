import type { NoteDetail, SearchResult, TreeNode } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`请求失败: ${res.status} ${url}`);
  }
  return res.json() as Promise<T>;
}

export function fetchTree(): Promise<{ tree: TreeNode[] }> {
  return getJson('/api/notes');
}

export function fetchNote(path: string): Promise<NoteDetail> {
  return getJson(`/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`);
}

export function searchNotes(query: string): Promise<{ results: SearchResult[] }> {
  return getJson(`/api/search?q=${encodeURIComponent(query)}`);
}

export function connectUpdatesSocket(onChange: () => void): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/updates`);
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.event === 'notes_changed') {
        onChange();
      }
    } catch {
      // 忽略无法解析的消息
    }
  };
  return () => socket.close();
}
