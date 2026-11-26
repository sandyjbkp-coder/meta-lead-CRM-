import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

export default function Notifications() {
  const { user } = useAuth();
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data } = await api.get('/notifications');
      return data.notifications || [];
    },
  });

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      window.location.reload();
    } catch (err) {
      console.error(err);
    }
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <button onClick={markAllRead} className="btn-primary">Mark All Read</button>
      </div>

      <div className="space-y-4">
        {notifications.length === 0 && (
          <div className="card text-center py-8">
            <p className="text-gray-600">No notifications</p>
          </div>
        )}
        {notifications.map(n => (
          <div key={n.id} className={`card flex justify-between items-center ${!n.read ? 'border-l-4 border-blue-500' : ''}`}>
            <div>
              <h3 className="font-medium">{n.title}</h3>
              <p className="text-sm text-gray-600 mt-1">{n.body}</p>
              <span className="text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</span>
            </div>
            {!n.read && <span className="text-blue-500">●</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
