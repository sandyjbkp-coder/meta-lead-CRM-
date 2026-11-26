import { getDb } from '../db/connection.js';
import { fetchLeadsByForm, getGraphToken } from './metaGraph.js';
import { upsertLead } from './leadService.js';

let scheduledTask = null;

export function startMetaSync() {
  // Simple cron-ish sync every hour (could be replaced with node-cron)
  scheduledTask = setInterval(async () => {
    try {
      const token = getGraphToken();
      if (!token) return;

      // For now: fetch leads from a default set of forms (from DB)
      const forms = getDb().prepare('SELECT * FROM meta_forms').all();

      for (const form of forms) {
        try {
          const leads = await fetchLeadsByForm(form.form_id, token, 100);
          for (const lead of leads) {
            await upsertLead({ ...lead, updated_by: null });
          }
        } catch (err) {
          console.error(`[SYNC] Error syncing form ${form.form_id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('[SYNC] Unexpected error:', err.message);
    }
  }, 60 * 60 * 1000); // every hour

  return scheduledTask;
}

export function stopMetaSync() {
  if (scheduledTask) clearInterval(scheduledTask);
}
