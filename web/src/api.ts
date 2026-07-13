import type { NoteDetail, SearchResult, TreeResponse, UpdateMessage } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`请求失败: ${res.status} ${url}`);
  }
  return res.json() as Promise<T>;
}

export function fetchTree(): Promise<TreeResponse> {
  return getJson('/api/notes');
}

export function fetchNote(path: string): Promise<NoteDetail> {
  return getJson(`/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`);
}

export function searchNotes(query: string): Promise<{ results: SearchResult[] }> {
  return getJson(`/api/search?q=${encodeURIComponent(query)}`);
}

export function connectUpdatesSocket(onChange: (message: UpdateMessage) => void): () => void {
  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let retryDelay = 1000;
  let stopped = false;

  const connect = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws/updates`);

    socket.onopen = () => {
      retryDelay = 1000;
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'notes_changed' || data.event === 'connected') {
          onChange(data as UpdateMessage);
        }
      } catch {
        // 忽略无法解析的消息
      }
    };

    socket.onclose = () => {
      socket = null;
      if (stopped) return;
      retryTimer = window.setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };

    socket.onerror = () => socket?.close();
  };

  connect();

  return () => {
    stopped = true;
    if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    socket?.close();
  };
}
