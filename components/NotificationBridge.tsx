'use client';

import { useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useReducer, useTable } from 'spacetimedb/react';

import { reducers, tables } from '@/src/module_bindings';

type NotificationState = {
  id: bigint;
  auth0UserId: string;
  kind: string;
  level: string;
  title: string;
  message: string;
  marketId: number | undefined;
  createdAt: { toMillis(): bigint };
};

function NotificationBridge() {
  const { user } = useUser();
  const deleteNotification = useReducer(reducers.deleteNotification);
  const [notificationRows] = useTable(tables.myNotifications);
  const dispatchedNotificationIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.sub) {
      dispatchedNotificationIdsRef.current.clear();
    }
  }, [user?.sub]);

  useEffect(() => {
    const notifications = notificationRows as readonly NotificationState[];

    for (const notification of notifications) {
      const notificationId = notification.id.toString();

      if (dispatchedNotificationIdsRef.current.has(notificationId)) {
        continue;
      }

      dispatchedNotificationIdsRef.current.add(notificationId);

      if (notification.level === 'success') {
        toast.success(notification.title, { description: notification.message, duration: 6000 });
      } else if (notification.level === 'warning') {
        toast.warning(notification.title, { description: notification.message, duration: 6000 });
      } else if (notification.level === 'info') {
        toast.info(notification.title, { description: notification.message, duration: 6000 });
      } else {
        toast(notification.title, { description: notification.message, duration: 6000 });
      }

      void deleteNotification({ notificationId: notification.id }).catch(() => {
        dispatchedNotificationIdsRef.current.delete(notificationId);
      });
    }
  }, [deleteNotification, notificationRows]);

  return null;
}

export { NotificationBridge };