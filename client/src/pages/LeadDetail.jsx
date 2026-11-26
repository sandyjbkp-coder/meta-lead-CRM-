import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import Badge from '../components/Badge';
import { useLead } from '../hooks/useLeads';

export default function LeadDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [newNote, setNewNote] = useState('');

  const { data: leadData, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: async () => {
      const { data } = await api.get(`/leads/${id}`);
      return data;
    },
  });

  const lead = leadData?.lead || {};
  const notes = leadData?.notes || [];
  const activities = leadData?.activities || [];

  const statusOptions = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
  const [updateStatus, setUpdateStatus] = useState(lead.status);

  const canEdit = user.role === 'admin' || user.role === 'manager' || lead.assigned_to === user.id;

  const handleStatusChange = async () => {
    if (!canEdit) return;
    try {
      await api.patch(`/leads/${id}`, { status: updateStatus });
      window.location.reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    try {
      await api.post(`/leads/${id}/notes`, { body: newNote });
      setNewNote('');
      window.location.reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to add note');
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!confirm('Delete this note?')) return;
    try {
      await api.delete(`/leads/${id}/notes/${noteId}`);
      window.location.reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete note');
    }
  };

  if (isLoading) return <div>Loading lead...</div>;

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{lead.full_name}</h1>
        <div className="flex gap-2">
          {canEdit && (
            <select value={updateStatus} className="input w-auto" onChange={e => setUpdateStatus(e.target.value)}>
              {statusOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {canEdit && <button onClick={handleStatusChange} className="btn-primary">Update</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="card p-4">
          <h3 className="font-semibold mb-2">Lead Info</h3>
          <p><strong>Email:</strong> {lead.email}</p>
          <p><strong>Phone:</strong> {lead.phone}</p>
          <p><strong>Status:</strong> <span className={`px-2 py-1 rounded-full ${lead.status === 'won' ? 'bg-green-100 text-green-800' : lead.status === 'lost' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>{lead.status}</span></p>
          <p><strong>Campaign:</strong> {lead.meta_campaign_id}</p>
          <p><strong>Assigned To:</strong> {lead.assigned_to_name || 'Unassigned'} ({user.role === 'admin' || user.role === 'manager' ? 'can reassign' : ''})</p>
          <p><strong>Follow-up:</strong> {lead.follow_up_at || 'Not set'}</p>
        </div>

        <div className="card p-4">
          <h3 className="font-semibold mb-2">Custom Fields</h3>
          <div className="space-y-2">
            {Object.entries(lead.custom_fields || {}).map(([key, value]) => (
              <p key={key} className="text-sm"><strong>{key}:</strong> {value}</p>
            ))}
            {Object.keys(lead.custom_fields || {}).length === 0 && <p className="text-gray-500 text-sm">No custom fields</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-4">Notes</h3>
          <div className="space-y-4 mb-4">
            {notes.map(note => (
              <div key={note.id} className="p-3 border rounded bg-gray-50">
                <p className="text-sm mb-1">{note.body}</p>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{note.author_name}</span>
                  <span>{new Date(note.created_at).toLocaleString()}</span>
                  {(user.role === 'admin' || user.role === 'manager') && (
                    <button onClick={() => handleDeleteNote(note.id)} className="text-red-500 hover:underline">Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t pt-4">
            <textarea value={newNote} onChange={e => setNewNote(e.target.value)} className="input w-full min-h-[80px]" placeholder="Add a note..." />
            <button onClick={handleAddNote} className="btn-primary mt-2">Add Note</button>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold mb-4">Activity Timeline</h3>
          <div className="space-y-4">
            {activities.length === 0 ? (
              <p className="text-gray-600 text-sm">No activities yet</p>
            ) : (
              activities.map(activity => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-1" />
                  <div className="text-sm">
                    <p className="text-gray-800">{activity.action.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-gray-500 mt-1">{activity.user_name || 'System'} • {new Date(activity.created_at).toLocaleString()}</p>
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
