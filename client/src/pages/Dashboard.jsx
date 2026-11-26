import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data } = await api.get('/dashboard/summary');
        setStats(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (!stats && loading) {
    return <div className="text-center py-8">Loading dashboard...</div>;
  }

  const statCards = [
    { label: 'Total Leads', value: stats?.total_leads, icon: '👥' },
    { label: "Today's Leads", value: stats?.today_leads, icon: '📅' },
    { label: 'Conversion Rate', value: `${stats?.conversion_rate}%`, icon: '📈' },
    { label: 'Follow-ups Due Today', value: stats?.follow_ups_due_today, icon: '⏰' },
  ];

  const statusCounts = stats?.by_status || {};
  const recentActivity = stats?.recent_activity || [];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon }) => (
          <div key={label} className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{label}</p>
                <p className="text-2xl font-bold mt-1">{value}</p>
              </div>
              <div className="text-3xl">{icon}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">Leads by Status</h2>
          <div className="space-y-2">
            {Object.entries(statusCounts).map(([status, count]) => {
              const colors = {
                new: 'bg-gray-100 text-gray-800',
                contacted: 'bg-blue-100 text-blue-800',
                qualified: 'bg-yellow-100 text-yellow-800',
                proposal: 'bg-purple-100 text-purple-800',
                won: 'bg-green-100 text-green-800',
                lost: 'bg-red-100 text-red-800',
              };
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors.new}`}>{status}</span>
                  </div>
                  <span className="text-sm font-medium">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {recentActivity.length === 0 ? (
              <p className="text-gray-600">No recent activity</p>
            ) : (
              recentActivity.map(activity => (
                <div key={activity.id} className="flex gap-3">
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1" />
                  <div className="text-sm">
                    <p className="font-medium">{activity.lead_name}</p>
                    <p className="text-gray-600">{activity.action.replace('_', ' ')}</p>
                    <p className="text-xs text-gray-400 mt-1">{new Date(activity.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
