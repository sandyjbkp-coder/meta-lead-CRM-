import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import Badge from '../components/Badge';
import { useAuth } from '../hooks/useAuth';

export default function Leads() {
  const { user } = useAuth();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['leads', 'list'],
    queryFn: async () => {
      const { data } = await api.get('/leads?limit=50');
      return data;
    },
  });

  const leads = data?.leads || [];
  const total = data?.total || 0;

  const statusColors = {
    new: 'bg-gray-100 text-gray-800',
    contacted: 'bg-blue-100 text-blue-800',
    qualified: 'bg-yellow-100 text-yellow-800',
    proposal: 'bg-purple-100 text-purple-800',
    won: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-800',
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-3xl font-bold">Leads</h1>
        <button onClick={() => refetch()} className="btn-primary">Refresh</button>
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <p>Loading leads...</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Campaign</th>
                <th>Assigned To</th>
                <th>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {leads.map(lead => (
                <tr key={lead.id} onClick={() => window.location.href = `/leads/${lead.id}`} className="cursor-pointer">
                  <td className="font-medium">{lead.full_name}</td>
                  <td>{lead.email}</td>
                  <td>{lead.phone}</td>
                  <td>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[lead.status] || statusColors.new}`}>
                      {lead.status}
                    </span>
                  </td>
                  <td>{lead.meta_campaign_id || '-'}</td>
                  <td>{lead.assigned_to_name || '-'}</td>
                  <td>{lead.follow_up_at || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {leads.length === 0 && <p className="text-center text-gray-600 py-8">No leads found</p>}
      </div>

      <p className="mt-4 text-sm text-gray-600">Total: {total} leads</p>
    </div>
  );
}
