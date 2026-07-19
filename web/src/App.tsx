import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Spin } from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  FolderFilled,
  HomeOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { connectUpdatesSocket, fetchNote, fetchTree } from './api';
import type { DirNode, FileNode, NoteDetail, TreeNode } from './types';
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

function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const selectedPathRef = useRef<string | null>(null);
  const revisionRef = useRef<number | null>(null);

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
        <div className="header-count">共 {noteCount} 篇</div>
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
              <article className="markdown-body" dangerouslySetInnerHTML={{ __html: note.html }} />
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

export default App;
