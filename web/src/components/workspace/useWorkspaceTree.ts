import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/AppContext';
import type { ServerAgent, WorkspaceFile } from '../../types';

type WorkspaceTreeCache = Record<string, WorkspaceFile[]>;

export function useWorkspaceTree(agent: ServerAgent) {
  const { wsTreeCache, requestWorkspaceFiles } = useApp();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const treeCache = useMemo<WorkspaceTreeCache>(() => wsTreeCache[agent.id] || {}, [wsTreeCache, agent.id]);
  const rootFiles = useMemo(() => treeCache[''] || [], [treeCache]);

  useEffect(() => {
    if (agent.status === 'active') {
      requestWorkspaceFiles(agent.id);
    }
  }, [agent.id, agent.status, requestWorkspaceFiles]);

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((previous) => {
      const next = new Set(previous);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
        if (!treeCache[dirPath]) {
          requestWorkspaceFiles(agent.id, dirPath);
        }
      }
      return next;
    });
  }, [agent.id, treeCache, requestWorkspaceFiles]);

  const refresh = useCallback(() => {
    requestWorkspaceFiles(agent.id);
    setExpandedDirs(new Set());
  }, [agent.id, requestWorkspaceFiles]);

  return {
    expandedDirs,
    refresh,
    rootFiles,
    toggleDir,
    treeCache,
  };
}
