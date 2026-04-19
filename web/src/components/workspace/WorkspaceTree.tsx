import { memo } from 'react';
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import type { WorkspaceFile } from '../../types';

type WorkspaceTreeVariant = 'compact' | 'detail';
type WorkspaceTreeExpandMode = 'animated' | 'static';

interface WorkspaceTreeProps {
  files: WorkspaceFile[];
  treeCache: Record<string, WorkspaceFile[]>;
  expandedDirs: Set<string>;
  onToggleDir: (dirPath: string) => void;
  onFileSelect?: (path: string) => void;
  variant: WorkspaceTreeVariant;
  expandMode?: WorkspaceTreeExpandMode;
}

type WorkspaceTreeNodeProps = Omit<WorkspaceTreeProps, 'files'> & {
  file: WorkspaceFile;
  level: number;
};

const TREE_VARIANTS = {
  compact: {
    buttonClassName: 'w-full flex items-center gap-1.5 py-1 text-left hover:bg-nc-elevated transition-colors disabled:cursor-default',
    chevronSize: 12,
    iconSize: 12,
    spacerClassName: 'w-3 flex-shrink-0',
    nameClassName: 'flex-1 text-xs font-mono text-nc-text truncate',
  },
  detail: {
    buttonClassName: 'w-full flex items-center gap-1.5 py-1.5 text-left hover:bg-nc-elevated transition-colors border-b border-nc-border/30 last:border-b-0',
    chevronSize: 14,
    iconSize: 14,
    spacerClassName: 'w-3.5 flex-shrink-0',
    nameClassName: 'flex-1 text-sm font-mono text-nc-text-bright truncate',
  },
} satisfies Record<WorkspaceTreeVariant, {
  buttonClassName: string;
  chevronSize: number;
  iconSize: number;
  spacerClassName: string;
  nameClassName: string;
}>;

const INFO_ROW_CLASS_NAME = 'text-2xs text-nc-muted font-mono py-1';
const SIZE_CLASS_NAME = 'text-2xs text-nc-muted flex-shrink-0 font-mono';

const WorkspaceTreeNode = memo(function WorkspaceTreeNode({
  file,
  level,
  treeCache,
  expandedDirs,
  onToggleDir,
  onFileSelect,
  variant,
  expandMode,
}: WorkspaceTreeNodeProps) {
  const config = TREE_VARIANTS[variant];
  const dirPath = file.path || file.name;
  const isDir = file.isDirectory;
  const isExpanded = isDir && expandedDirs.has(dirPath);
  const children = isDir ? treeCache[dirPath] : undefined;
  const contentPadding = { paddingLeft: `${12 + (level + 1) * 16}px` };

  const childrenContent = children ? (
    children.length > 0 ? (
      children.map((child) => (
        <WorkspaceTreeNode
          key={child.path || child.name}
          file={child}
          level={level + 1}
          treeCache={treeCache}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onFileSelect={onFileSelect}
          variant={variant}
          expandMode={expandMode}
        />
      ))
    ) : (
      <div className={INFO_ROW_CLASS_NAME} style={contentPadding}>
        (empty)
      </div>
    )
  ) : (
    <div className={`${INFO_ROW_CLASS_NAME} animate-pulse`} style={contentPadding}>
      loading...
    </div>
  );

  return (
    <>
      <button
        onClick={() => {
          if (isDir) {
            onToggleDir(dirPath);
            return;
          }
          onFileSelect?.(dirPath);
        }}
        disabled={!isDir && !onFileSelect}
        className={config.buttonClassName}
        style={{ paddingLeft: `${12 + level * 16}px`, paddingRight: '12px' }}
      >
        {isDir ? (
          <ChevronRight
            size={config.chevronSize}
            className={`flex-shrink-0 text-nc-muted transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className={config.spacerClassName} />
        )}
        {isDir
          ? (isExpanded
            ? <FolderOpen size={config.iconSize} className="flex-shrink-0 text-nc-yellow" />
            : <Folder size={config.iconSize} className="flex-shrink-0 text-nc-yellow" />)
          : <File size={config.iconSize} className="flex-shrink-0 text-nc-muted" />
        }
        <span className={config.nameClassName}>{file.name}</span>
        {!isDir && file.size !== undefined && (
          <span className={SIZE_CLASS_NAME}>
            {file.size < 1024 ? `${file.size}B` : `${(file.size / 1024).toFixed(1)}K`}
          </span>
        )}
      </button>
      {isDir && isExpanded && (
        expandMode === 'animated' ? (
          <div
            className="overflow-hidden transition-[grid-template-rows] duration-200"
            style={{ display: 'grid', gridTemplateRows: '1fr' }}
          >
            <div className="min-h-0">{childrenContent}</div>
          </div>
        ) : (
          <div className="min-h-0">{childrenContent}</div>
        )
      )}
    </>
  );
});

export function WorkspaceTree({
  files,
  treeCache,
  expandedDirs,
  onToggleDir,
  onFileSelect,
  variant,
  expandMode = 'animated',
}: WorkspaceTreeProps) {
  return (
    <>
      {files.map((file) => (
        <WorkspaceTreeNode
          key={file.path || file.name}
          file={file}
          level={0}
          treeCache={treeCache}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onFileSelect={onFileSelect}
          variant={variant}
          expandMode={expandMode}
        />
      ))}
    </>
  );
}
