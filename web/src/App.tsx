import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Spin, message } from 'antd';
import {
  ArrowLeftOutlined,
  CommentOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderFilled,
  HomeOutlined,
  RightOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { connectUpdatesSocket, fetchNote, fetchTree } from './api';
import type { DirNode, FileNode, NoteDetail, TreeNode } from './types';
import Chat from './Chat';
import { createComment, loadComments, saveComments, type NoteComment } from './commentStore';
import { applyHighlight, clearHighlights } from './highlight';
import './App.css';

function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + (node.type === 'file' ? 1 : countFiles(node.children)),
    0,
  );
}

/** 按路径找到某个目录下的直接子节点，'' 表示根目录。 */
function childrenAt(tree: TreeNode[], dirPath: string): TreeNode[] {
  if (!dirPath) return tree;
  let nodes = tree;
  for (const part of dirPath.split('/')) {
    const dir = nodes.find(
      (node): node is DirNode => node.type === 'dir' && node.name === part,
    );
    if (!dir) return [];
    nodes = dir.children;
  }
  return nodes;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp * 1000).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(new Date(timestamp * 1000));
}

function formatCommentTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [comments, setComments] = useState<NoteComment[]>(() => loadComments());
  const [selection, setSelection] = useState<{ top: number; left: number; text: string } | null>(null);
  // 评论输入框（选中文字后弹出）
  const [composer, setComposer] = useState<{ top: number; left: number; quote: string } | null>(null);
  const [draft, setDraft] = useState('');
  // 点击高亮后查看的评论
  const [viewing, setViewing] = useState<{ id: string; top: number; left: number } | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const revisionRef = useRef<number | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  const loadTree = useCallback(async () => {
    const { tree: data, revision } = await fetchTree();
    setTree(data);
    const changed = revisionRef.current !== revision;
    revisionRef.current = revision;
    return changed;
  }, []);

  const openNote = useCallback(async (path: string) => {
    setSelectedPath(path);
    selectedPathRef.current = path;
    setNoteLoading(true);
    try {
      setNote(await fetchNote(path));
    } catch {
      setSelectedPath(null);
      selectedPathRef.current = null;
      setNote(null);
    } finally {
      setNoteLoading(false);
    }
  }, []);

  const closeNote = useCallback(() => {
    setNote(null);
    setSelectedPath(null);
    selectedPathRef.current = null;
    setSelection(null);
    setComposer(null);
    setViewing(null);
  }, []);

  // 选中正文文字后，在选区上方弹出「评论」按钮
  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    const article = articleRef.current;
    const text = sel?.toString().trim();
    if (
      !sel ||
      sel.isCollapsed ||
      !text ||
      !article ||
      !article.contains(sel.anchorNode) ||
      !article.contains(sel.focusNode)
    ) {
      setSelection(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setViewing(null);
    setSelection({
      top: Math.max(rect.top, 90),
      left: Math.min(Math.max(rect.left + rect.width / 2, 160), window.innerWidth - 160),
      text,
    });
  }, []);

  // 选区被清除或页面滚动时收起浮动按钮和查看气泡
  useEffect(() => {
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) setSelection(null);
    };
    const onScroll = () => {
      setSelection(null);
      setViewing(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  const openComposer = useCallback(() => {
    if (!selection) return;
    setComposer({ top: selection.top, left: selection.left, quote: selection.text });
    setDraft('');
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [selection]);

  const saveComment = useCallback(() => {
    const text = draft.trim();
    if (!composer || !note || !text) return;
    setComments((prev) => {
      const next = [...prev, createComment(note.path, composer.quote, text)];
      saveComments(next);
      return next;
    });
    setComposer(null);
    setDraft('');
    void message.success('已添加评论');
  }, [composer, draft, note]);

  const removeComment = useCallback((id: string) => {
    setComments((prev) => {
      const next = prev.filter((item) => item.id !== id);
      saveComments(next);
      return next;
    });
    setViewing(null);
  }, []);

  // 笔记内容或评论变化后，把每条评论对应的原文用 <mark> 高亮出来
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !note) return;
    clearHighlights(article);
    for (const item of comments) {
      if (item.notePath === note.path) applyHighlight(article, item.id, item.quote);
    }
  }, [note, comments]);

  // 点击高亮文字时弹出评论气泡
  const handleArticleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>('mark[data-comment-id]');
    if (!mark) {
      setViewing(null);
      return;
    }
    const rect = mark.getBoundingClientRect();
    setViewing({
      id: mark.dataset.commentId as string,
      top: Math.max(rect.top, 90),
      left: Math.min(Math.max(rect.left + rect.width / 2, 160), window.innerWidth - 160),
    });
  }, []);

  const scrollToHighlight = useCallback((id: string) => {
    articleRef.current
      ?.querySelector(`mark[data-comment-id="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    const refresh = async (serverRevision?: number) => {
      if (serverRevision !== undefined && serverRevision === revisionRef.current) return;
      try {
        const changed = await loadTree();
        const current = selectedPathRef.current;
        if (changed && current) await openNote(current);
      } catch {
        // WebSocket 重连和定时对齐会继续尝试。
      }
    };

    void refresh();
    const disconnect = connectUpdatesSocket((message) => void refresh(message.revision));
    const refreshTimer = window.setInterval(() => void refresh(), 10000);
    return () => {
      disconnect();
      window.clearInterval(refreshTimer);
    };
  }, [loadTree, openNote]);

  const level = useMemo(() => childrenAt(tree, currentDir), [tree, currentDir]);
  const folders = useMemo(
    () => level.filter((node): node is DirNode => node.type === 'dir'),
    [level],
  );
  const notes = useMemo(
    () =>
      level
        .filter((node): node is FileNode => node.type === 'file')
        .sort((a, b) => b.mtime - a.mtime),
    [level],
  );
  const noteCount = useMemo(() => countFiles(tree), [tree]);
  const noteComments = useMemo(
    () =>
      note
        ? comments
            .filter((item) => item.notePath === note.path)
            .sort((a, b) => a.createdAt - b.createdAt)
        : [],
    [comments, note],
  );
  const viewingComment = useMemo(
    () => (viewing ? comments.find((item) => item.id === viewing.id) ?? null : null),
    [viewing, comments],
  );

  // 文件变化导致当前目录消失时退回根目录
  useEffect(() => {
    if (currentDir && !childrenAt(tree, currentDir).length && tree.length) {
      setCurrentDir('');
    }
  }, [tree, currentDir]);

  const crumbs = currentDir ? currentDir.split('/') : [];

  return (
    <main className={`app-shell${selectedPath ? ' app-shell--reading' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark"><FileTextOutlined /></span>
          <span className="brand__name">我的笔记</span>
        </div>
        <div className="header-right">
          <span className="header-count">共 {noteCount} 篇</span>
          <button
            className={`chat-toggle${chatOpen ? ' is-active' : ''}`}
            onClick={() => setChatOpen((v) => !v)}
          >
            <RobotOutlined /> AI 助手
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="browser" aria-label="文件夹浏览">
          <nav className="crumbs" aria-label="路径">
            <button
              className={`crumb${currentDir ? '' : ' is-current'}`}
              onClick={() => setCurrentDir('')}
            >
              <HomeOutlined /> 全部
            </button>
            {crumbs.map((name, i) => {
              const path = crumbs.slice(0, i + 1).join('/');
              return (
                <span className="crumb-seg" key={path}>
                  <RightOutlined className="crumb-sep" />
                  <button
                    className={`crumb${i === crumbs.length - 1 ? ' is-current' : ''}`}
                    onClick={() => setCurrentDir(path)}
                  >
                    {name}
                  </button>
                </span>
              );
            })}
          </nav>

          {folders.length > 0 && (
            <div className="folder-grid">
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  className="folder-card"
                  onClick={() => setCurrentDir(folder.path)}
                >
                  <FolderFilled className="folder-card__icon" />
                  <span className="folder-card__name">{folder.name}</span>
                  <span className="folder-card__count">{countFiles(folder.children)} 篇</span>
                </button>
              ))}
            </div>
          )}

          {notes.length > 0 && (
            <div className="note-list">
              {notes.map((item) => (
                <button
                  key={item.path}
                  className={`note-row${selectedPath === item.path ? ' is-active' : ''}`}
                  onClick={() => void openNote(item.path)}
                >
                  <FileTextOutlined className="note-row__icon" />
                  <span className="note-row__title">{item.title || item.name}</span>
                  <span className="note-row__date">{formatDate(item.mtime)}</span>
                </button>
              ))}
            </div>
          )}

          {!folders.length && !notes.length && (
            <Empty
              className="browser-empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="这个文件夹是空的"
            />
          )}
        </section>

        <section className="note-detail" aria-label="笔记详情">
          {noteLoading ? (
            <div className="detail-state"><Spin /></div>
          ) : note ? (
            <>
              <div className="detail-toolbar">
                <button className="back-button" onClick={closeNote}>
                  <ArrowLeftOutlined /> 返回
                </button>
                <span>{note.path}</span>
              </div>
              <article
                ref={articleRef}
                className="markdown-body"
                onMouseUp={handleTextSelection}
                onTouchEnd={handleTextSelection}
                onClick={handleArticleClick}
                dangerouslySetInnerHTML={{ __html: note.html }}
              />
              {noteComments.length > 0 && (
                <section className="note-comments" aria-label="评论">
                  <h3 className="note-comments__title">
                    <CommentOutlined /> 评论 · {noteComments.length}
                  </h3>
                  {noteComments.map((item) => (
                    <div className="comment-card" key={item.id}>
                      <button
                        className="comment-card__quote"
                        onClick={() => scrollToHighlight(item.id)}
                        title="定位到原文"
                      >
                        {item.quote}
                      </button>
                      <p className="comment-card__text">{item.text}</p>
                      <div className="comment-card__meta">
                        <span>{formatCommentTime(item.createdAt)}</span>
                        <button
                          className="comment-card__remove"
                          onClick={() => removeComment(item.id)}
                          title="删除评论"
                        >
                          <DeleteOutlined />
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
            </>
          ) : null}
        </section>

        <Chat open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>

      {selection && (
        <button
          className="selection-record"
          style={{ top: selection.top, left: selection.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openComposer}
        >
          <CommentOutlined /> 评论
        </button>
      )}

      {composer && (
        <div className="comment-popover" style={{ top: composer.top, left: composer.left }}>
          <blockquote className="comment-popover__quote">{composer.quote}</blockquote>
          <textarea
            autoFocus
            value={draft}
            rows={2}
            placeholder="写下你的评论…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                saveComment();
              }
              if (e.key === 'Escape') setComposer(null);
            }}
          />
          <div className="comment-popover__actions">
            <button className="comment-popover__cancel" onClick={() => setComposer(null)}>
              取消
            </button>
            <button
              className="comment-popover__save"
              onClick={saveComment}
              disabled={!draft.trim()}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {viewing && viewingComment && (
        <div className="comment-popover" style={{ top: viewing.top, left: viewing.left }}>
          <p className="comment-popover__text">{viewingComment.text}</p>
          <div className="comment-popover__meta">
            <span>{formatCommentTime(viewingComment.createdAt)}</span>
            <button
              className="comment-card__remove"
              onClick={() => removeComment(viewingComment.id)}
              title="删除评论"
            >
              <DeleteOutlined />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
