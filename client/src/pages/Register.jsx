import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Input, BtnPrimary } from '../components';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { register, loading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !email || !password) return;
    await register(name, email, password);
    navigate('/');
  };

  if (useAuth().loading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center py-12">
      <div className="w-full max-w-md space-y-4">
        <h2 className="text-2xl font-bold">Create Account</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="input" />
          <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" />
          <Input placeholder="Password (min 8 chars)" type="password" value={password} onChange={e => setPassword(e.target.value)} className="input" />
          <BtnPrimary type="submit" disabled={loading}>{loading ? 'Creating...' : 'Sign Up'}</BtnPrimary>
          <p className="text-xs text-gray-600">The first account created becomes the admin.</p>
        </form>
      </div>
    </div>
  );
}
