export interface NoteComment {
  id: string;
  notePath: string;
  /** 被评论的原文片段 */
  quote: string;
  text: string;
  createdAt: number;
}

const STORAGE_KEY = 'note-comments:v1';

export function loadComments(): NoteComment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as NoteComment[]) : [];
  } catch {
    return [];
  }
}

export function saveComments(list: NoteComment[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 存储满或不可用时静默失败，评论仍保留在内存中。
  }
}

export function createComment(notePath: string, quote: string, text: string): NoteComment {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    notePath,
    quote,
    text,
    createdAt: Date.now(),
  };
}
