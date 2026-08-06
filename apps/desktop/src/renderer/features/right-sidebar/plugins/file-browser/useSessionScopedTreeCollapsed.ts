/**
 * 文件浏览器树的 per-session 折叠偏好。
 *
 * 树默认展开；只记录收起态，展开时删除 key，让没有显式偏好的会话继续跟随默认值。
 * 它与树宽度分别持久化：收起不会丢掉用户先前设置的宽度，恢复时仍由
 * useSessionScopedTreeWidth 读取原来的宽度。
 */

import { useCallback, useSyncExternalStore } from 'react';

import { RSB_TREE_COLLAPSED_KEY_PREFIX } from '@/lib/sessionLayoutPrefs';

function readTreeCollapsed(sessionId: string | null): boolean {
  if (!sessionId) return transientTreeCollapsed;
  try {
    return localStorage.getItem(`${RSB_TREE_COLLAPSED_KEY_PREFIX}${sessionId}`) === 'true';
  } catch {
    return false;
  }
}

// localStorage 的 storage 事件不会在同一个 renderer 内触发；文件浏览器允许同一
// session 同时挂载多个 tab，因此这里用一个轻量的进程内订阅把主动写入广播给其它
// hook 实例。这样每个 tab 仍然只维护自己的 React 订阅，不需要把布局状态提升到
// FileBrowserBody。
const subscribers = new Set<() => void>();
let transientTreeCollapsed = false;

function subscribeTreeCollapsed(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function notifyTreeCollapsedChanged(): void {
  for (const listener of subscribers) listener();
}

function persistTreeCollapsed(sessionId: string | null, collapsed: boolean): void {
  if (!sessionId) {
    transientTreeCollapsed = collapsed;
    notifyTreeCollapsedChanged();
    return;
  }
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
  notifyTreeCollapsedChanged();
}

export function useSessionScopedTreeCollapsed(sessionId: string | null) {
  const subscribe = useCallback(subscribeTreeCollapsed, []);
  const getSnapshot = useCallback(() => readTreeCollapsed(sessionId), [sessionId]);
  const isTreeCollapsed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    // FileBrowserBody is not rendered during SSR, but keep the hook safe for SSR callers.
    () => false,
  );

  const setTreeCollapsed = useCallback(
    (collapsed: boolean) => {
      persistTreeCollapsed(sessionId, collapsed);
    },
    [sessionId],
  );

  const toggleTreeCollapsed = useCallback(() => {
    persistTreeCollapsed(sessionId, !readTreeCollapsed(sessionId));
  }, [sessionId]);

  return { isTreeCollapsed, setTreeCollapsed, toggleTreeCollapsed };
}
