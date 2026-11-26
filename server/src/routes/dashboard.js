import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { canViewAllLeads } from '../middleware/rbac.js';

const router = Router();

// GET /api/dashboard/summary
router.get('/summary', async (req, res, next) => {
  try {
    const db = getDb();
    const user = req.user;

    // Base query for role filtering
    let baseFilter = '';
    if (!canViewAllLeads(user)) {
      baseFilter = `WHERE l.assigned_to = ${user.id}`;
    }

    // Total leads
    let totalQuery = `SELECT COUNT(*) as total FROM leads l ${baseFilter ? `WHERE ${baseFilter.replace('WHERE ', '')}` : ''}`;
    const totalRow = db.prepare(totalQuery).get();
    const total = totalRow.total;

    // Today's leads (created today)
    const todayQuery = totalRow.total > 0 ? `SELECT COUNT(*) as today FROM leads l WHERE l.created_at >= date('now') ${baseFilter ? 'AND ' + baseFilter.replace('WHERE ', '') : ''}` : 'SELECT 0 as today';
    const todayRow = db.prepare(todayQuery).get();

    // Week's leads (last 7 days)
    const weekQuery = totalRow.total > 0 ? `SELECT COUNT(*) as week FROM leads l WHERE l.created_at >= date('now', '-7 days') ${baseFilter ? 'AND ' + baseFilter.replace('WHERE ', '') : ''}` : 'SELECT 0 as week';
    const weekRow = db.prepare(weekQuery).get();

    // Month's leads (last 30 days)
    const monthQuery = totalRow.total > 0 ? `SELECT COUNT(*) as month FROM leads l WHERE l.created_at >= date('now', '-30 days') ${baseFilter ? 'AND ' + baseFilter.replace('WHERE ', '') : ''}` : 'SELECT 0 as month';
    const monthRow = db.prepare(monthQuery).get();

    // By status
    const statusQuery = totalRow.total > 0 ? `SELECT status, COUNT(*) as count FROM leads l ${baseFilter} GROUP BY status` : 'SELECT NULL as status, 0 as count';
    const byStatus = db.prepare(statusQuery).all();

    // Conversion rate (won / total)
    const wonRow = byStatus.find(s => s.status === 'won');
    const wonCount = wonRow?.count || 0;
    const conversionRate = total > 0 ? ((wonCount / total) * 100).toFixed(2) : '0.00';

    // By executive (only for admin/manager; exec sees own only)
    let byExecutive = [];
    if (canViewAllLeads(user)) {
      byExecutive = db.prepare(
        `SELECT u.id, u.name, u.email, COUNT(l.id) as leads, SUM(CASE WHEN l.status='won' THEN 1 ELSE 0 END) as won
         FROM users u LEFT JOIN leads l ON u.id = l.assigned_to
         WHERE u.role IN ('sales_exec', 'manager', 'admin')
         GROUP BY u.id, u.name, u.email`
      ).all();
    } else {
      // Exec sees only own stats
      byExecutive = db.prepare(
        `SELECT u.id, u.name, u.email, COUNT(l.id) as leads, SUM(CASE WHEN l.status='won' THEN 1 ELSE 0 END) as won
         FROM users u LEFT JOIN leads l ON u.id = l.assigned_to AND u.id = ?
         WHERE u.id = ?
         GROUP BY u.id, u.name, u.email`
      ).all(user.id, user.id);
    }

    // By campaign
    const campaignQuery = totalRow.total > 0 ? `SELECT meta_campaign_id, COUNT(*) as count FROM leads l ${baseFilter} GROUP BY meta_campaign_id` : 'SELECT NULL as meta_campaign_id, 0 as count';
    const byCampaign = db.prepare(campaignQuery).all();

    // Follow-ups due today
    const followUpQuery = totalRow.total > 0 ? `SELECT COUNT(*) as due FROM leads l WHERE date(follow_up_at) = date('now') ${baseFilter ? 'AND ' + baseFilter.replace('WHERE ', '') : ''}` : 'SELECT 0 as due';
    const followUpRow = db.prepare(followUpQuery).get();

    // Recent activity (last 10)
    const activityQuery = `SELECT a.id, a.lead_id, a.user_id, a.action, a.from_value, a.to_value, a.created_at,
                                  l.full_name as lead_name, l.email as lead_email,
                                  u.name as user_name
                           FROM lead_activities a
                           LEFT JOIN leads l ON l.id = a.lead_id
                           LEFT JOIN users u ON u.id = a.user_id
                           WHERE 1=1 ${!canViewAllLeads(user) ? `AND l.assigned_to = ${user.id}` : ''}
                           ORDER BY a.created_at DESC
                           LIMIT 10`;
    const recentActivity = db.prepare(activityQuery).all();

    res.json({
      total_leads: total,
      today_leads: todayRow.today || 0,
      week_leads: weekRow.week || 0,
      month_leads: monthRow.month || 0,
      by_status: Object.fromEntries(byStatus.map(s => [s.status || 'unknown', s.count])),
      conversion_rate: conversionRate,
      by_executive: byExecutive,
      by_campaign: Object.fromEntries(byCampaign.map(c => [c.meta_campaign_id || 'unknown', c.count])),
      follow_ups_due_today: followUpRow.due || 0,
      recent_activity: recentActivity,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
