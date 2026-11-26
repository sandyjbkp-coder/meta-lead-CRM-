import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

export default function SettingsMeta() {
  const { user } = useAuth();
  const [settings, setSettings] = useState({
    app_id: '',
    app_secret: '',
    page_access_token: '',
    verify_token: '',
    default_assignee_email: '',
  });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchSettings();
    }
  }, [user]);

  const fetchSettings = async () => {
    try {
      const { data } = await api.get('/meta/settings');
      setSettings(prev => ({
        ...prev,
        ...Object.fromEntries(Object.entries(data.settings).map(([k, v]) => [k, v === '***' ? '' : v])),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setStatus('');
    try {
      await api.put('/meta/settings', settings);
      setStatus('Settings saved successfully');
    } catch (err) {
      setStatus('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    setStatus('Testing connection...');
    try {
      const { data } = await api.post('/meta/test');
      setStatus(`✅ Connected: ${data.userId} - Pages: ${data.pages.map(p => p.name).join(', ')}`);
    } catch (err) {
      setStatus('❌ ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  if (user?.role !== 'admin') {
    return <div className="card"><p>Admin access required</p></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Meta Settings</h1>
      
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Step 1: App Credentials</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">App ID</label>
            <input type="text" className="input" value={settings.app_id} onChange={e => setSettings({...settings, app_id: e.target.value})} placeholder="Enter Meta App ID" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">App Secret</label>
            <input type="password" className="input" value={settings.app_secret} onChange={e => setSettings({...settings, app_secret: e.target.value})} placeholder="Enter App Secret (encrypted at rest)" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Page Access Token</label>
            <input type="password" className="input" value={settings.page_access_token} onChange={e => setSettings({...settings, page_access_token: e.target.value})} placeholder="Enter Page Access Token (encrypted at rest)" />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Step 2: Webhook Configuration</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Verify Token</label>
            <input type="text" className="input" value={settings.verify_token} onChange={e => setSettings({...settings, verify_token: e.target.value})} placeholder="Must match Meta webhook config" />
          </div>
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-600">
              Configure your Meta webhook at: <code className="text-primary">https://your-domain.com/api/meta/webhook</code>
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Subscribe to <strong>leadgen</strong> events with the verify token above.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Step 3: Default Assignment</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Default Assignee Email</label>
          <input type="email" className="input" value={settings.default_assignee_email} onChange={e => setSettings({...settings, default_assignee_email: e.target.value})} placeholder="admin@example.com" />
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Test Connection</h2>
        <div className="flex gap-4">
          <button onClick={handleTest} disabled={loading} className="btn-primary">
            {loading ? 'Testing...' : 'Test Connection'}
          </button>
          <button onClick={handleSave} disabled={loading} className="btn-primary">
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
        {status && <p className="mt-4 text-sm">{status}</p>}
      </div>
    </div>
  );
}
