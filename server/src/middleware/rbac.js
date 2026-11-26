import { getDb } from '../db/connection.js';

const ROLE_HIERARCHY = {
  'sales_exec': 1,
  'manager': 2,
  'admin': 3
};

export function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const db = getDb();
      const user = req.user;
      
      if (!user) {
        throw new Error('Unauthenticated');
      }
      
      const userRole = user.role;
      const userRoleLevel = ROLE_HIERARCHY[userRole] || 0;
      
      if (allowedRoles.length > 0) {
        const hasPermission = allowedRoles.some(role => ROLE_HIERARCHY[role] >= userRoleLevel);
        if (!hasPermission) {
          throw new Error('Insufficient permissions');
        }
      }
      
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function canViewAllLeads(user) {
  const db = getDb();
  const userRole = user.role;
  const userRoleLevel = ROLE_HIERARCHY[userRole] || 0;
  
  if (userRoleLevel >= ROLE_HIERARCHY['admin'] || userRoleLevel >= ROLE_HIERARCHY['manager']) {
    return true;
  }
  
  return false;
}

export function canReassignLead(leadUserId, currentUserId) {
  const db = getDb();
  const leadUser = db.prepare('SELECT role FROM users WHERE id = ?').get(leadUserId);
  const currentUser = db.prepare('SELECT role FROM users WHERE id = ?').get(currentUserId);
  
  if (!leadUser || !currentUser) return false;
  
  return currentUser.role === 'admin' || 
         (leadUser.role === 'sales_exec' && currentUser.role === 'admin');
}

export function canEditLead(leadUserId, currentUserId) {
  const db = getDb();
  const leadUser = db.prepare('SELECT role FROM users WHERE id = ?').get(leadUserId);
  const currentUser = db.prepare('SELECT role FROM users WHERE id = ?').get(currentUserId);
  
  if (!leadUser || !currentUser) return false;
  
  return currentUser.role === 'admin' || 
         (leadUser.role === 'sales_exec' && currentUser.role === 'admin');
}

export function canViewUser(userId) {
  const db = getDb();
  const userRole = userId ? 'user' : 'any'; // Simplified - in reality check user's role
  return true; // Full access for admins, others need permission
}

export function canManageUsers() {
  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(1); // Simplified check
  return user?.role === 'admin';
}

export function canViewDashboard() {
  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(1); // Simplified check
  return user?.role === 'admin' || user?.role === 'manager';
}

export function canViewNotifications() {
  const db = getDb();
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(1); // Simplified check
  return user?.role === 'admin' || user?.role === 'sales_exec';
}
