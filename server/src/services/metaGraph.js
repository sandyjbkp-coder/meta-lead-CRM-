import { getDb } from '../db/connection.js';
import { AppError } from '../utils/errorCodes.js';
import { decryptToken } from './crypto.js';
import { getGraphApiVersion } from '../config/env.js';

function graphBase() {
  return `https://graph.facebook.com/${getGraphApiVersion()}`;
}

async function makeGraphRequest(endpoint, accessToken) {
  const url = `${graphBase()}/${endpoint}?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Meta API error ${res.status}: ${errText}`);
  }
  return res.json();
}

// Test connection with Meta
export async function testMetaConnection() {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM settings WHERE key = ?').get('m_page_access_token');
  if (!settings || !settings.value) {
    throw new AppError(400, 'Meta not configured. Please complete setup wizard.');
  }
  const token = decryptToken(settings.value);

  const me = await makeGraphRequest('me', token);
  const pages = await makeGraphRequest('me/accounts', token);
  const accounts = Array.isArray(pages?.data) ? pages.data : [];

  return { connected: true, userId: me.id, pages: accounts.map(p => ({ id: p.id, name: p.name })) };
}

// Fetch lead details from Meta Graph
export async function fetchLeadById(metaLeadId, accessToken) {
  const data = await makeGraphRequest(metaLeadId, accessToken);
  // data has fields like field_data, etc.
  const fieldData = data?.field_data || [];
  const leadId = data.id || metaLeadId;
  const formId = data.lead_gen_id || data.form_id || '';
  const pageId = data.page_id || '';
  const campaignId = data.ad_id ? data.ad.id : data.campaign_id || '';
  const adSetId = data.adset_id ? data.adset_id : '';
  const adId = data.ad_id || data.ad?.id || '';
  const status = data.status || 'new';

  // Custom fields: field_data entries have {name, value, ...}
  const customFields = {};
  for (const f of fieldData) {
    customFields[f.name] = f.values?.[0] || '';
  }

  const lead = {
    meta_lead_id: leadId,
    meta_form_id: formId,
    meta_campaign_id: campaignId,
    meta_adset_id: adSetId,
    meta_ad_id: adId,
    full_name: data.full_name || data.name || '',
    email: data.email || '',
    phone: data.phone || '',
    custom_fields: customFields,
    status,
  };

  // Fetch form metadata to get campaign names
  let form = null;
  if (formId) {
    const forms = await db.prepare('SELECT * FROM meta_forms WHERE form_id = ?').get(formId);
    if (forms) {
      form = forms;
    }
  }

  return { lead, form };
}

// Fetch leads by form with pagination
export async function fetchLeadsByForm(formId, accessToken, limit = 100) {
  const endpoint = `${formId}/leads?fields=id,created_time,ad_id,adset_id,campaign_id,form_id,page_id,field_data&limit=${limit}`;
  const data = await makeGraphRequest(endpoint, accessToken);
  const leads = (data?.data || []).map(d => ({
    meta_lead_id: d.id,
    meta_form_id: d.form_id || formId,
    meta_campaign_id: d.campaign_id || '',
    meta_adset_id: d.adset_id || '',
    meta_ad_id: d.ad_id || '',
    full_name: d.field_data?.find(f => f.name === 'full_name')?.values?.[0] || d.field_data?.find(f => f.name === 'fullname')?.values?.[0] || '',
    email: d.field_data?.find(f => f.name === 'email')?.values?.[0] || d.field_data?.find(f => f.name === 'email_address')?.values?.[0] || '',
    phone: d.field_data?.find(f => f.name === 'phone')?.values?.[0] || d.field_data?.find(f => f.name === 'phone_number')?.values?.[0] || '',
    custom_fields: Object.fromEntries((d.field_data || []).map(f => [f.name, f.values?.[0] || ''])),
    created_time: d.created_time,
  }));
  return leads;
}

export function getGraphToken() {
  const db = getDb();
  const settings = db.prepare('SELECT value FROM settings WHERE key = ?').get('m_page_access_token');
  if (!settings || !settings.value) return null;
  try {
    return decryptToken(settings.value);
  } catch (err) {
    console.error('[META] Failed to decrypt token:', err.message);
    return null;
  }
}
