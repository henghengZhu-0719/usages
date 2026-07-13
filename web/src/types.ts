export interface DirNode {
  name: string;
  path: string;
  type: 'dir';
  children: TreeNode[];
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file';
  title: string;
  mtime: number;
}

export type TreeNode = DirNode | FileNode;

export interface NoteDetail {
  path: string;
  title: string;
  html: string;
  mtime: number;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}
