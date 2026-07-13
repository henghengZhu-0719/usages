import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Tree, Input, Spin, Typography, Empty, List, Button } from 'antd';
import {
  BookOutlined,
  FileTextOutlined,
  FolderOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type { DataNode } from 'antd/es/tree';
import { connectUpdatesSocket, fetchNote, fetchTree, searchNotes } from './api';
import type { NoteDetail, SearchResult, TreeNode } from './types';
import './App.css';

const { Sider, Content, Header } = Layout;

function toAntdTree(nodes: TreeNode[]): DataNode[] {
  return nodes.map((node) =>
    node.type === 'dir'
      ? {
          title: (
            <span className="tree-title tree-title--directory" title={node.name}>
              {node.name}
            </span>
          ),
          key: `dir:${node.path}`,
          icon: <FolderOutlined className="tree-icon tree-icon--folder" />,
          children: toAntdTree(node.children),
        }
      : {
          title: (
            <span className="tree-title tree-title--file" title={node.title || node.name}>
              {node.title || node.name}
            </span>
          ),
          key: `file:${node.path}`,
          icon: <FileTextOutlined className="tree-icon tree-icon--file" />,
          isLeaf: true,
        },
  );
}

function countNotes(nodes: TreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.type === 'file' ? 1 : countNotes(node.children)),
    0,
  );
}

function collectExpandedKeys(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'dir' ? [`dir:${node.path}`, ...collectExpandedKeys(node.children)] : [],
  );
}

function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const revisionRef = useRef<number | null>(null);
  const searchQueryRef = useRef('');

  const loadTree = useCallback(async () => {
    const { tree: data, revision } = await fetchTree();
    setTree(data);
    setExpandedKeys((prev) => (prev.length ? prev : collectExpandedKeys(data)));
    const changed = revisionRef.current !== revision;
    revisionRef.current = revision;
    return changed;
  }, []);

  const openNote = useCallback(async (path: string) => {
    setSelectedPath(path);
    selectedPathRef.current = path;
    setNoteLoading(true);
    try {
      const data = await fetchNote(path);
      setNote(data);
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
    // connected 消息携带当前 revision，可补齐 WebSocket 断线期间的更新。
    const disconnect = connectUpdatesSocket((message) => void refresh(message.revision));
    // 即使反向代理完全不支持 WebSocket，也能最终同步到最新内容。
    const refreshTimer = window.setInterval(() => void refresh(), 10000);

    return () => {
      disconnect();
      window.clearInterval(refreshTimer);
    };
  }, [loadTree, openNote]);

  const antdTree = useMemo(() => toAntdTree(tree), [tree]);
  const noteCount = useMemo(() => countNotes(tree), [tree]);

  const handleSelect = (keys: React.Key[]) => {
    const key = keys[0];
    if (typeof key === 'string' && key.startsWith('file:')) {
      openNote(key.slice('file:'.length));
    } else if (typeof key === 'string' && key.startsWith('dir:')) {
      setExpandedKeys((current) =>
        current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
      );
    }
  };

  const handleSearch = async (value: string) => {
    const query = value.trim();
    searchQueryRef.current = query;
    if (!query) {
      setSearchResults(null);
      return;
    }
    const { results } = await searchNotes(query);
    setSearchResults(results);
  };

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <Typography.Title level={4} className="app-title">
          笔记浏览器
        </Typography.Title>
        <Input.Search
          placeholder="搜索笔记标题或内容"
          allowClear
          style={{ maxWidth: 360 }}
          onSearch={handleSearch}
          onChange={(e) => {
            if (!e.target.value) handleSearch('');
          }}
        />
      </Header>
      <Layout className="app-main">
        <Sider width={320} theme="light" className="notes-sider">
          <div className="tree-toolbar">
            <div className="tree-toolbar__title">
              <span className="tree-toolbar__icon"><BookOutlined /></span>
              <div>
                <Typography.Text strong>文档库</Typography.Text>
                <Typography.Text type="secondary" className="tree-toolbar__count">
                  {noteCount} 篇文档
                </Typography.Text>
              </div>
            </div>
            {!searchResults && expandedKeys.length > 0 && (
              <Button type="text" size="small" onClick={() => setExpandedKeys([])}>
                全部折叠
              </Button>
            )}
          </div>
          <div className="tree-content">
          {searchResults ? (
            <List
              size="small"
              className="search-results"
              dataSource={searchResults}
              locale={{ emptyText: '没有找到匹配的笔记' }}
              renderItem={(item) => (
                <List.Item
                  className="search-result"
                  onClick={() => {
                    searchQueryRef.current = '';
                    setSearchResults(null);
                    openNote(item.path);
                  }}
                >
                  <SearchOutlined className="search-result__icon" />
                  <List.Item.Meta
                    title={<span title={item.title}>{item.title}</span>}
                    description={item.snippet}
                  />
                </List.Item>
              )}
            />
          ) : tree.length === 0 ? (
            <Empty description="没有找到 Markdown 笔记" />
          ) : (
            <Tree
              className="note-tree"
              treeData={antdTree}
              showIcon
              blockNode
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys as string[])}
              selectedKeys={selectedPath ? [`file:${selectedPath}`] : []}
              onSelect={handleSelect}
            />
          )}
          </div>
        </Sider>
        <Content className="note-content">
          {noteLoading ? (
            <Spin />
          ) : note ? (
            <article className="markdown-body" dangerouslySetInnerHTML={{ __html: note.html }} />
          ) : (
            <Empty description="从左侧选择一篇笔记" />
          )}
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
