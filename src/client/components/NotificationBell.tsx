/**
 * NotificationBell — bell icon with unread count badge.
 * Polls /api/notifications/unread-count every 30s.
 * Click navigates to /notifications.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { apiCall } from '../hooks/useApi';

export function NotificationBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const data = await apiCall<{ count: number }>('/api/notifications/unread-count');
      setCount(data?.count ?? 0);
    } catch {
      // Silently ignore — bell is non-critical UI
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const timer = setInterval(fetchCount, 30_000);
    return () => clearInterval(timer);
  }, [fetchCount]);

  return (
    <button
      onClick={() => navigate('/notifications')}
      className="relative p-2 rounded-lg hover:bg-sidebar-accent text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
      title={count > 0 ? `${count} unread notification${count !== 1 ? 's' : ''}` : 'Notifications'}
      aria-label="Open notification center"
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

export default NotificationBell;
