/**
 * 文件浏览器树的 per-session 折叠偏好。
 *
 * 树默认展开；只记录收起态，展开时删除 key，让没有显式偏好的会话继续跟随默认值。
 * 它与树宽度分别持久化：收起不会丢掉用户先前设置的宽度，恢复时仍由
 * useSessionScopedTreeWidth 读取原来的宽度。
 */

import { useCallback, useEffect, useState } from 'react';

import { RSB_TREE_COLLAPSED_KEY_PREFIX } from '@/lib/sessionLayoutPrefs';

function readTreeCollapsed(sessionId: string | null): boolean {
  if (!sessionId) return false;
  try {
    return localStorage.getItem(`${RSB_TREE_COLLAPSED_KEY_PREFIX}${sessionId}`) === 'true';
  } catch {
    return false;
  }
}

function persistTreeCollapsed(sessionId: string | null, collapsed: boolean): void {
  if (!sessionId) return;
  try {
    const key = `${RSB_TREE_COLLAPSED_KEY_PREFIX}${sessionId}`;
    if (collapsed) {
      localStorage.setItem(key, 'true');
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage 在 private mode 等环境可能不可用；界面状态仍可在当前运行期切换。
  }
}

export function useSessionScopedTreeCollapsed(sessionId: string | null) {
  const [state, setState] = useState(() => ({
    sessionId,
    isTreeCollapsed: readTreeCollapsed(sessionId),
  }));

  // sessionId 更新时先从当前 session 的偏好派生渲染结果，避免 effect 同步前短暂显示
  // 上一个 session 的状态；effect 仅负责让下一次交互也使用最新 session 的 state。
  const isTreeCollapsed =
    state.sessionId === sessionId ? state.isTreeCollapsed : readTreeCollapsed(sessionId);

  // 同一 tab 切换会话时，折叠状态也必须切回对应会话的偏好。
  useEffect(() => {
    setState({ sessionId, isTreeCollapsed: readTreeCollapsed(sessionId) });
  }, [sessionId]);

  const setTreeCollapsed = useCallback(
    (collapsed: boolean) => {
      setState({ sessionId, isTreeCollapsed: collapsed });
      persistTreeCollapsed(sessionId, collapsed);
    },
    [sessionId],
  );

  const toggleTreeCollapsed = useCallback(() => {
    setState((current) => {
      const currentCollapsed =
        current.sessionId === sessionId ? current.isTreeCollapsed : readTreeCollapsed(sessionId);
      const next = !currentCollapsed;
      persistTreeCollapsed(sessionId, next);
      return { sessionId, isTreeCollapsed: next };
    });
  }, [sessionId]);

  return { isTreeCollapsed, setTreeCollapsed, toggleTreeCollapsed };
}
