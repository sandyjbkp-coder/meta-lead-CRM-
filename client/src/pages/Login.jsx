import React, { useState, useContext } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Input, BtnPrimary } from '../components';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    await login(email, password);
    navigate('/');
  };

  if (useAuth().loading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center py-12">
      <div className="w-full max-w-md space-y-4">
        <h2 className="text-2xl font-bold">Welcome Back</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="input" />
          <Input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="input" />
          <BtnPrimary type="submit" disabled={loading}>Sign In</BtnPrimary>
        </form>
      </div>
    </div>
  );
}
