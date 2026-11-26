import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

export default function SettingsUsers() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'sales_exec' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchUsers();
    }
  }, [user]);

  const fetchUsers = async () => {
    try {
      const { data } = await api.get('/users');
      setUsers(data.users || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreate = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) {
      alert('Fill all fields');
      return;
    }
    setLoading(true);
    try {
      await api.post('/users', newUser);
      await fetchUsers();
      setNewUser({ name: '', email: '', password: '', role: 'sales_exec' });
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (id) => {
    const target = users.find(u => u.id === id);
    try {
      await api.patch(`/users/${id}`, { is_active: !target.is_active });
      await fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateRole = async (id, newRole) => {
    try {
      await api.patch(`/users/${id}`, { role: newRole });
      await fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this user?')) return;
    try {
      await api.delete(`/users/${id}`);
      await fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  if (user?.role !== 'admin') {
    return <div className="card"><p>Admin access required</p></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Users</h1>

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Add User</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <input className="input" placeholder="Name" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} />
          <input className="input" type="email" placeholder="Email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} />
          <input className="input" type="password" placeholder="Password" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
          <select className="input" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>
            <option value="sales_exec">Sales Exec</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button onClick={handleCreate} disabled={loading} className="btn-primary mt-4">
          {loading ? 'Creating...' : 'Create User'}
        </button>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="text-lg font-semibold mb-4">All Users</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select className="input w-auto" value={u.role} onChange={e => handleUpdateRole(u.id, e.target.value)}>
                    <option value="sales_exec">Sales Exec</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>
                  <button onClick={() => handleToggleActive(u.id)} className={u.is_active ? 'text-green-600' : 'text-red-600'}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  <button onClick={() => handleDelete(u.id)} className="btn-danger">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
