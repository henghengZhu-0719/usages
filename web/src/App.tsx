import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layout, Tree, Input, Spin, Typography, Empty, List } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { connectUpdatesSocket, fetchNote, fetchTree, searchNotes } from './api';
import type { NoteDetail, SearchResult, TreeNode } from './types';
import './App.css';

const { Sider, Content, Header } = Layout;

function toAntdTree(nodes: TreeNode[]): DataNode[] {
  return nodes.map((node) =>
    node.type === 'dir'
      ? {
          title: node.name,
          key: `dir:${node.path}`,
          children: toAntdTree(node.children),
        }
      : {
          title: node.title || node.name,
          key: `file:${node.path}`,
          isLeaf: true,
        },
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

  const loadTree = useCallback(async () => {
    const { tree: data } = await fetchTree();
    setTree(data);
    setExpandedKeys((prev) => (prev.length ? prev : collectExpandedKeys(data)));
  }, []);

  const openNote = useCallback(async (path: string) => {
    setSelectedPath(path);
    setNoteLoading(true);
    try {
      const data = await fetchNote(path);
      setNote(data);
    } finally {
      setNoteLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTree();
    const disconnect = connectUpdatesSocket(() => {
      loadTree();
      setSelectedPath((current) => {
        if (current) openNote(current);
        return current;
      });
    });
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const antdTree = useMemo(() => toAntdTree(tree), [tree]);

  const handleSelect = (keys: React.Key[]) => {
    const key = keys[0];
    if (typeof key === 'string' && key.startsWith('file:')) {
      openNote(key.slice('file:'.length));
    }
  };

  const handleSearch = async (value: string) => {
    if (!value.trim()) {
      setSearchResults(null);
      return;
    }
    const { results } = await searchNotes(value);
    setSearchResults(results);
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Header
        style={{
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Typography.Title level={4} style={{ margin: 0, marginRight: 24 }}>
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
      <Layout>
        <Sider width={300} style={{ background: '#fff', overflow: 'auto', padding: 12 }}>
          {searchResults ? (
            <List
              size="small"
              dataSource={searchResults}
              locale={{ emptyText: '没有找到匹配的笔记' }}
              renderItem={(item) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSearchResults(null);
                    openNote(item.path);
                  }}
                >
                  <List.Item.Meta title={item.title} description={item.snippet} />
                </List.Item>
              )}
            />
          ) : tree.length === 0 ? (
            <Empty description="没有找到 Markdown 笔记" />
          ) : (
            <Tree
              treeData={antdTree}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys as string[])}
              selectedKeys={selectedPath ? [`file:${selectedPath}`] : []}
              onSelect={handleSelect}
            />
          )}
        </Sider>
        <Content style={{ padding: 24, overflow: 'auto', background: '#fff' }}>
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
