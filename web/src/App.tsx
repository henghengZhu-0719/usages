import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Input, Spin } from 'antd';
import {
  ArrowLeftOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  HomeOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { connectUpdatesSocket, fetchNote, fetchTree, searchNotes } from './api';
import type { FileNode, NoteDetail, SearchResult, TreeNode } from './types';
import './App.css';

interface FolderItem {
  name: string;
  path: string;
  depth: number;
  count: number;
}

function collectFiles(nodes: TreeNode[]): FileNode[] {
  return nodes.flatMap((node) => (node.type === 'file' ? [node] : collectFiles(node.children)));
}

function collectFolders(nodes: TreeNode[], depth = 0): FolderItem[] {
  return nodes.flatMap((node) => {
    if (node.type === 'file') return [];
    return [
      { name: node.name, path: node.path, depth, count: collectFiles(node.children).length },
      ...collectFolders(node.children, depth + 1),
    ];
  });
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    year: new Date(timestamp * 1000).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(new Date(timestamp * 1000));
}

function getParentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '根目录' : path.slice(0, index);
}

function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const revisionRef = useRef<number | null>(null);
  const searchQueryRef = useRef('');

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

  useEffect(() => {
    const refresh = async (serverRevision?: number) => {
      if (serverRevision !== undefined && serverRevision === revisionRef.current) return;
      try {
        const changed = await loadTree();
        const current = selectedPathRef.current;
        if (changed && current) await openNote(current);
        if (changed && searchQueryRef.current) {
          const { results } = await searchNotes(searchQueryRef.current);
          setSearchResults(results);
        }
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

  const allNotes = useMemo(
    () => collectFiles(tree).sort((a, b) => b.mtime - a.mtime),
    [tree],
  );
  const folders = useMemo(() => collectFolders(tree), [tree]);
  const visibleNotes = useMemo(
    () =>
      selectedFolder
        ? allNotes.filter(
            (item) => item.path.startsWith(`${selectedFolder}/`) || item.path === selectedFolder,
          )
        : allNotes,
    [allNotes, selectedFolder],
  );
  const currentFolderName =
    folders.find((folder) => folder.path === selectedFolder)?.name || '全部笔记';

  useEffect(() => {
    if (selectedFolder && !folders.some((folder) => folder.path === selectedFolder)) {
      setSelectedFolder('');
    }
  }, [folders, selectedFolder]);

  const handleSearch = async (value: string) => {
    const query = value.trim();
    setSearchText(value);
    searchQueryRef.current = query;
    if (!query) {
      setSearchResults(null);
      return;
    }
    const { results } = await searchNotes(query);
    setSearchResults(results);
  };

  const clearSearchAndOpen = (path: string) => {
    setSearchText('');
    searchQueryRef.current = '';
    setSearchResults(null);
    void openNote(path);
  };

  return (
    <main className={`app-shell${note ? ' app-shell--reading' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <span className="brand__mark"><FileTextOutlined /></span>
          <span className="brand__name">我的笔记</span>
        </div>
        <Input
          className="global-search"
          prefix={<SearchOutlined />}
          placeholder="搜索你的笔记"
          value={searchText}
          allowClear
          onChange={(event) => {
            setSearchText(event.target.value);
            if (!event.target.value) void handleSearch('');
          }}
          onPressEnter={(event) => void handleSearch(event.currentTarget.value)}
        />
        <div className="header-count">共 {allNotes.length} 篇</div>
      </header>

      <div className="workspace">
        <section className="library-panel" aria-label="笔记库">
          <nav className="folder-panel" aria-label="文件夹">
            <div className="panel-heading">
              <span>文件夹</span>
              <span className="panel-heading__count">{folders.length}</span>
            </div>
            <div className="folder-list">
              <button
                className={`folder-item${selectedFolder === '' ? ' is-active' : ''}`}
                onClick={() => setSelectedFolder('')}
              >
                <HomeOutlined />
                <span className="folder-item__name">全部笔记</span>
                <span className="folder-item__count">{allNotes.length}</span>
              </button>
              {folders.map((folder) => (
                <button
                  key={folder.path}
                  className={`folder-item${selectedFolder === folder.path ? ' is-active' : ''}`}
                  style={{ '--folder-depth': folder.depth } as React.CSSProperties}
                  onClick={() => setSelectedFolder(folder.path)}
                  title={folder.path}
                >
                  {selectedFolder === folder.path ? <FolderOpenOutlined /> : <FolderOutlined />}
                  <span className="folder-item__name">{folder.name}</span>
                  <span className="folder-item__count">{folder.count}</span>
                </button>
              ))}
            </div>
          </nav>

          <section className="notes-panel" aria-label="笔记列表">
            <div className="notes-panel__header">
              <div>
                <span className="eyebrow">{searchResults ? '搜索结果' : '当前文件夹'}</span>
                <h1>{searchResults ? `“${searchQueryRef.current}”` : currentFolderName}</h1>
              </div>
              <span className="notes-total">
                {searchResults ? searchResults.length : visibleNotes.length} 篇
              </span>
            </div>

            <div className="note-list">
              {searchResults ? (
                searchResults.length ? (
                  searchResults.map((item, index) => (
                    <button
                      key={item.path}
                      className={`note-card${selectedPath === item.path ? ' is-active' : ''}`}
                      onClick={() => clearSearchAndOpen(item.path)}
                    >
                      <span className={`note-card__cover cover-${index % 5}`}>
                        <SearchOutlined />
                      </span>
                      <span className="note-card__body">
                        <strong>{item.title}</strong>
                        <span className="note-card__snippet">{item.snippet}</span>
                        <small>{getParentPath(item.path)}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的笔记" />
                )
              ) : visibleNotes.length ? (
                visibleNotes.map((item, index) => (
                  <button
                    key={item.path}
                    className={`note-card${selectedPath === item.path ? ' is-active' : ''}`}
                    onClick={() => void openNote(item.path)}
                  >
                    <span className={`note-card__cover cover-${index % 5}`}>
                      <FileTextOutlined />
                    </span>
                    <span className="note-card__body">
                      <strong>{item.title || item.name}</strong>
                      <span className="note-card__meta">
                        <span>{formatDate(item.mtime)}</span>
                        <span>{getParentPath(item.path)}</span>
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个文件夹里还没有笔记" />
              )}
            </div>
          </section>
        </section>

        <section className="note-detail" aria-label="笔记详情">
          {noteLoading ? (
            <div className="detail-state"><Spin /></div>
          ) : note ? (
            <>
              <div className="detail-toolbar">
                <button className="back-button" onClick={() => {
                  setNote(null);
                  setSelectedPath(null);
                  selectedPathRef.current = null;
                }}>
                  <ArrowLeftOutlined /> 返回笔记列表
                </button>
                <span>{getParentPath(note.path)}</span>
              </div>
              <article className="markdown-body" dangerouslySetInnerHTML={{ __html: note.html }} />
            </>
          ) : (
            <div className="detail-placeholder">
              <span className="detail-placeholder__icon"><FileTextOutlined /></span>
              <h2>打开一篇笔记</h2>
              <p>从左侧文件夹中选择笔记，在这里阅读完整内容</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
