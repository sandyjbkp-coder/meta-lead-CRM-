import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <nav className="sidebar">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">Meta CRM</h1>
      </div>
      <ul className="p-2 space-y-1">
        <li>
          <a href="/" className={isActive('/') ? 'text-white font-medium' : 'text-gray-200 hover:text-white block py-2 px-3 rounded'}>
            Dashboard
          </a>
        </li>
        <li>
          <a href="/leads" className={isActive('/leads') ? 'text-white font-medium' : 'text-gray-200 hover:text-white block py-2 px-3 rounded'}>
            Leads
          </a>
        </li>
        <li>
          <a href="/pipeline" className={isActive('/pipeline') ? 'text-white font-medium' : 'text-gray-200 hover:text-white block py-2 px-3 rounded'}>
            Pipeline
          </a>
        </li>
        <li>
          <a href="/notifications" className={isActive('/notifications') ? 'text-white font-medium' : 'text-gray-200 hover:text-white block py-2 px-3 rounded'}>
            Notifications
          </a>
        </li>
        {user?.role === 'admin' && (
          <li>
            <a href="/settings/users" className={isActive('/settings/users') ? 'text-white font-medium' : 'text-gray-200 hover:text-white block py-2 px-3 rounded'}>
              Users
            </a>
          </li>
        )}
        {user?.role === 'admin' && (
          <li>
            <a href="/settings/meta" className={isActive('/settings/meta') ? 'text-white font-medium' : 'text-gray-200 hover:text-white block py-2 px-3 rounded'}>
              Meta Settings
            </a>
          </li>
        )}
        <li className="mt-auto border-t border-gray-700 pt-4">
          <div className="px-3 py-2 text-sm text-gray-300">
            {user?.name} <span className="text-gray-400">({user?.role})</span>
          </div>
          <button onClick={logout} className="text-white px-4 py-2 rounded hover:bg-opacity-80 w-full text-left">
            Logout
          </button>
        </li>
      </ul>
    </nav>
  );
}
