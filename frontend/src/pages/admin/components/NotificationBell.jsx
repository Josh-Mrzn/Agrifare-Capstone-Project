import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../../../services/notificationApi';
import { formatDateTime } from '../../../utils/format';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'ORDER', label: 'Orders' },
  { id: 'MESSAGE', label: 'Messages' },
  { id: 'STOCK', label: 'Stock' },
];

/** Where each kind of notification takes you. */
const SECTION_FOR = { ORDER: 'orders', PAYMENT: 'orders', MESSAGE: 'messages', STOCK: 'inventory' };

export default function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all');
  const rootRef = useRef(null);

  useEffect(() => {
    const load = () => fetchNotifications()
      .then((res) => {
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unreadCount || 0);
      })
      // The bell stays quiet if this fails; nothing else depends on it.
      .catch(() => {});
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = notifications.filter((n) => {
    if (filter === 'all') return true;
    if (filter === 'unread') return !n.read;
    if (filter === 'ORDER') return n.type === 'ORDER' || n.type === 'PAYMENT';
    return n.type === filter;
  });

  async function openItem(n) {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x._id === n._id ? { ...x, read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      markNotificationRead(n._id).catch(() => {});
    }
    if (SECTION_FOR[n.type]) onNavigate?.(SECTION_FOR[n.type]);
    setOpen(false);
  }

  async function markAll() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    markAllNotificationsRead().catch(() => {});
  }

  return (
    <div className="notif" ref={rootRef}>
      <button
        className="btn btn-ghost btn-icon notif-trigger"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <h2>Notifications</h2>
            {unreadCount > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={markAll}>Mark all read</button>
            )}
          </div>
          <div className="chips notif-filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <ul className="list notif-list">
            {shown.length === 0 ? (
              <li className="empty"><p>Nothing here.</p></li>
            ) : (
              shown.map((n) => (
                <li key={n._id}>
                  <button type="button" className={`list-row notif-item${n.read ? '' : ' is-unread'}`} onClick={() => openItem(n)}>
                    <span className="list-row-main">
                      <strong>{n.title}</strong>
                      {n.body && <span>{n.body}</span>}
                      <span className="notif-time">{formatDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
