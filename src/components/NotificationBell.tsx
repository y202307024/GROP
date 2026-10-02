import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import Icon from './Icon';
import {
  fetchMyNotifications,
  formatNoticeTime,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '../utils/notifications';

/**
 * 상단바 알림 종.
 * 새 알림이 오면 빨간 점을 띄우고, 목록에서 문서/그룹/요약/회의 알림을 보여줍니다.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [userId, setUserId] = useState('');

  openRef.current = open;
  const unread = items.filter((n) => !n.read).length;

  const load = async () => {
    const list = await fetchMyNotifications();
    setItems(list);
  };

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!mounted || !data.user) return;
      setUserId(data.user.id);
    });
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;

    const applyIncoming = (row: AppNotification) => {
      if (row.user_id && row.user_id !== userId) return;
      setItems((prev) => {
        if (prev.some((n) => n.id === row.id)) return prev;
        return [row, ...prev].slice(0, 40);
      });
      // 드롭다운을 열어 둔 상태면 바로 읽음 처리해서 빨간 점이 남지 않게 합니다.
      if (openRef.current) {
        void markNotificationRead(row.id);
        setItems((prev) => prev.map((n) => (n.id === row.id ? { ...n, read: true } : n)));
      }
    };

    // user_id 필터는 PK가 아니라 Realtime에서 빠질 수 있어, RLS로 걸러진 INSERT를 그대로 받습니다.
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => applyIncoming(payload.new as AppNotification),
      )
      .subscribe();

    // Realtime이 꺼져 있어도 포커스·주기 조회로 빨간 점이 뜨게 합니다.
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 4000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      void load();
      if (unread > 0) {
        void markAllNotificationsRead();
        setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      }
    }
  };

  const openItem = (item: AppNotification) => {
    void markNotificationRead(item.id);
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    setOpen(false);
    if (item.link) navigate(item.link);
  };

  return (
    <div className="notification-wrapper" ref={wrapRef}>
      <button
        className="icon-btn"
        type="button"
        aria-label={unread > 0 ? `알림 ${unread}개` : '알림'}
        onClick={toggleOpen}
      >
        <Icon name="bell" />
        {unread > 0 ? (
          <span className={`notification-badge${unread > 1 ? ' has-count' : ''}`}>
            {unread > 1 ? (unread > 9 ? '9+' : unread) : ''}
          </span>
        ) : null}
      </button>
      <div className="notification-dropdown" hidden={!open}>
        <div className="notification-dropdown-arrow" />
        <div className="notification-dropdown-header">알림</div>
        <div className="notification-list">
          {items.length === 0 ? (
            <div className="notification-empty">새 알림이 없습니다</div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`notification-item${!item.read ? ' unread' : ''}`}
                onClick={() => openItem(item)}
              >
                <div className="notification-item-title">{item.title}</div>
                {item.body ? <div className="notification-item-body">{item.body}</div> : null}
                <div className="notification-item-time">{formatNoticeTime(item.created_at)}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
