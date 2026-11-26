// OAuth state management and Meta authorization-code exchange
// All OAuth state is persisted to SQLite (survives server restarts).
import crypto from 'node:crypto';
import { decryptToken, encryptToken } from './crypto.js';
import { getDb } from '../db/connection.js';
import { AppError } from '../utils/errorCodes.js';
import { logIntegrationEvent } from './integrationLog.js';

// OAuth state TTL: 10 minutes (Meta recommends <= 10 min)
const STATE_TTL_MS = 10 * 60 * 1000;

// Required scopes for lead ads / webhook / page access
const DEFAULT_SCOPES = [
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_show_list',
  'business_management',
  'lead_retrieval',
];

/**
 * Generate a cryptographically random OAuth state and persist it.
 * State is single-use and expires after STATE_TTL_MS.
 */
export async function persistOAuthState({ userId, redirectUri, scopes }) {
  const db = getDb();
  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  // Clean up expired states
  db.prepare(`DELETE FROM meta_oauth_states WHERE expires_at < datetime('now')`).run();

  db.prepare(
    `INSERT INTO meta_oauth_states (state, user_id, redirect_uri, scopes, expires_at, created_at, used)
     VALUES (?, ?, ?, ?, ?, datetime('now'), 0)`
  ).run(state, userId || null, redirectUri || null, scopes ? JSON.stringify(scopes) : null, expiresAt);

  await logIntegrationEvent({
    integrationId: null,
    level: 'info',
    component: 'oauth',
    message: 'oauth_state_created',
    details: JSON.stringify({ userId, redirectUri, scopes }),
  });

  return state;
}

/**
 * Consume an OAuth state (single-use). Validates existence, expiry, and redirect URI match.
 * Returns the associated userId.
 */
export async function consumeOAuthState(state, redirectUri) {
  const db = getDb();

  const row = db.prepare(
    `SELECT id, user_id, redirect_uri, scopes, expires_at, used
       FROM meta_oauth_states
      WHERE state = ?`
  ).get(state);

  if (!row) {
    throw new AppError(400, 'Invalid or expired OAuth state');
  }

  if (row.used === 1) {
    throw new AppError(400, 'OAuth state already used');
  }

  const now = new Date().toISOString();
  if (row.expires_at < now) {
    throw new AppError(400, 'OAuth state has expired');
  }

  if (redirectUri && row.redirect_uri !== redirectUri) {
    throw new AppError(400, 'OAuth redirect URI mismatch');
  }

  // Mark as used (single-use)
  db.prepare(`UPDATE meta_oauth_states SET used = 1 WHERE id = ?`).run(row.id);

  await logIntegrationEvent({
    integrationId: null,
    level: 'info',
    component: 'oauth',
    message: 'oauth_state_consumed',
    details: JSON.stringify({ userId: row.user_id, redirectUri }),
  });

  return row.user_id;
}

/**
 * Build the Meta OAuth authorization URL.
 */
export function buildAuthorizationUrl({ appId, redirectUri, state, scopes, apiVersion }) {
  const version = apiVersion || 'v19.0';
  const scopeList = scopes || DEFAULT_SCOPES;
  const base = `https://www.facebook.com/${version}/dialog/oauth`;
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    scope: scopeList.join(','),
    // Request re-approval to ensure we always get a code even if previously authorized
    auth_type: 'rerequest',
  });
  return `${base}?${params.toString()}`;
}

/**
 * Exchange the authorization code for a short-lived user access token.
 * Does NOT assume automatic refresh - we track expiration explicitly.
 */
export async function exchangeCodeForToken({ code, redirectUri, appId, appSecret, apiVersion }) {
  const version = apiVersion || 'v19.0';
  const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri', redirectUri);
  tokenUrl.searchParams.set('code', code);

  const res = await fetch(tokenUrl, { method: 'GET' });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    await logIntegrationEvent({
      integrationId: null,
      level: 'error',
      component: 'oauth',
      message: 'token_exchange_failed',
      details: JSON.stringify({ error: body.error?.message, status: res.status }),
    });
    throw new AppError(400, `Meta token exchange failed: ${body.error?.message || res.status}`);
  }

  const expiresIn = body.expires_in ? body.expires_in * 1000 : null;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null;

  await logIntegrationEvent({
    integrationId: null,
    level: 'info',
    component: 'oauth',
    message: 'token_exchange_success',
    details: JSON.stringify({ expiresAt, tokenType: body.token_type }),
  });

  return {
    accessToken: body.access_token,
    tokenType: body.token_type,
    expiresIn: body.expires_in ?? null,
    expiresAt,
  };
}

/**
 * Exchange a short-lived user token for a long-lived token.
 * Meta does not support automatic refresh for page tokens; we must re-run OAuth
 * when the token expires.
 */
export async function exchangeLongLivedToken({ userAccessToken, appId, appSecret, apiVersion }) {
  const version = apiVersion || 'v19.0';
  const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('fb_exchange_token', userAccessToken);

  const res = await fetch(url, { method: 'GET' });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    await logIntegrationEvent({
      integrationId: null,
      level: 'error',
      component: 'oauth',
      message: 'long_lived_token_exchange_failed',
      details: JSON.stringify({ error: body.error?.message, status: res.status }),
    });
    throw new AppError(400, `Long-lived token exchange failed: ${body.error?.message || res.status}`);
  }

  const expiresIn = body.expires_in ? body.expires_in * 1000 : null;
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null;

  return {
    accessToken: body.access_token,
    tokenType: body.token_type,
    expiresIn: body.expires_in ?? null,
    expiresAt,
  };
}

/**
 * Fetch the pages the user has access to, with their page access tokens.
 */
export async function fetchGrantedPages(userAccessToken, apiVersion) {
  const version = apiVersion || 'v19.0';
  const url = new URL(`https://graph.facebook.com/${version}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token,tasks');
  url.searchParams.set('access_token', userAccessToken);

  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    throw new AppError(400, `Meta page listing failed: ${body.error?.message || res.status}`);
  }

  return (body.data || []).map((p) => ({
    pageId: p.id,
    pageName: p.name,
    accessToken: p.access_token,
    tasks: p.tasks || [],
  }));
}

/**
 * Upsert a Meta integration record with encrypted credentials at rest.
 * Tracks token_expires_at so we can detect when reauthorization is needed.
 */
export async function upsertIntegration({
  appId,
  appSecret,
  verifyToken,
  pageAccessToken,
  pixelId,
  testEventCode,
  apiVersion,
  expiresAt,
  createdBy,
}) {
  const db = getDb();

  const existing = db
    .prepare('SELECT id FROM meta_integrations WHERE app_id = ?')
    .get(appId);

  const payload = {
    app_secret: encryptToken(appSecret),
    page_access_token: encryptToken(pageAccessToken),
    verify_token: encryptToken(verifyToken),
    pixel_id: pixelId || null,
    test_event_code: testEventCode || null,
    graph_api_version: apiVersion || 'v19.0',
    token_expires_at: expiresAt || null,
  };

  let integrationId;

  if (existing) {
    db.prepare(
      `UPDATE meta_integrations
         SET app_secret = ?, page_access_token = ?, verify_token = ?,
             pixel_id = ?, test_event_code = ?, graph_api_version = ?,
             token_expires_at = ?, is_active = 1, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      payload.app_secret,
      payload.page_access_token,
      payload.verify_token,
      payload.pixel_id,
      payload.test_event_code,
      payload.graph_api_version,
      payload.token_expires_at,
      existing.id
    );
    integrationId = existing.id;

    await recordTokenAudit({
      integrationId,
      action: 'oauth_refresh',
      status: 'success',
      expiresAt: payload.token_expires_at,
    });
  } else {
    const info = db
      .prepare(
        `INSERT INTO meta_integrations
           (app_id, app_secret, app_secret_encrypted, page_access_token,
            page_access_token_encrypted, verify_token, verify_token_encrypted,
            pixel_id, test_event_code, graph_api_version, token_expires_at,
            is_active, created_by, created_at, updated_at)
         VALUES (?, ?, 1, ?, 1, ?, 1, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`
      )
      .run(
        appId,
        payload.app_secret,
        payload.page_access_token,
        payload.verify_token,
        payload.pixel_id,
        payload.test_event_code,
        payload.graph_api_version,
        payload.token_expires_at,
        createdBy || null
      );
    integrationId = Number(info.lastInsertRowid);

    await recordTokenAudit({
      integrationId,
      action: 'oauth_grant',
      status: 'success',
      expiresAt: payload.token_expires_at,
    });
  }

  await logIntegrationEvent({
    integrationId,
    level: 'info',
    component: 'oauth',
    message: existing ? 'integration_updated' : 'integration_created',
  });

  return integrationId;
}

/**
 * Check whether the active integration's token is expired or nearing expiration.
 * Returns { needsReauth: boolean, integration: ... }
 */
export function checkTokenHealth() {
  const db = getDb();
  const integration = getActiveIntegration();
  if (!integration) {
    return { needsReauth: true, reason: 'no_active_integration', integration: null };
  }

  const expiresAt = integration.token_expires_at;
  if (!expiresAt) {
    // No expiration recorded - assume token may be long-lived but we can't verify
    return { needsReauth: false, reason: 'no_expiration_recorded', integration };
  }

  const now = new Date().toISOString();
  const needsReauth = new Date(expiresAt) <= new Date(now);

  return { needsReauth, reason: needsReauth ? 'token_expired' : 'token_valid', integration };
}

/**
 * Get the single active integration (without secrets).
 */
export function getActiveIntegration() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, app_id, pixel_id, test_event_code, graph_api_version,
              token_expires_at, is_active, last_tested_at, last_sync_at,
              created_at, updated_at
         FROM meta_integrations
        WHERE is_active = 1
        ORDER BY id DESC
        LIMIT 1`
    )
    .get();
}

/**
 * Get full secrets for an integration (decrypted).
 */
export function getIntegrationSecrets(integrationId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, app_id, app_secret, page_access_token, verify_token,
              graph_api_version, token_expires_at
         FROM meta_integrations
        WHERE id = ?`
    )
    .get(integrationId);

  if (!row) return null;

  return {
    id: row.id,
    appId: row.app_id,
    appSecret: decryptToken(row.app_secret),
    pageAccessToken: decryptToken(row.page_access_token),
    verifyToken: decryptToken(row.verify_token),
    apiVersion: row.graph_api_version,
    tokenExpiresAt: row.token_expires_at,
  };
}

/**
 * Deactivate an integration (disconnect).
 */
export function deactivateIntegration(integrationId) {
  const db = getDb();
  const info = db
    .prepare(
      `UPDATE meta_integrations
          SET is_active = 0, updated_at = datetime('now')
        WHERE id = ?`
    )
    .run(integrationId);

  if (info.changes === 0) {
    throw new AppError(404, 'Integration not found');
  }

  return { deactivated: true, integrationId };
}

/**
 * Record a token audit event.
 */
export function recordTokenAudit({ integrationId, action, status, error, expiresAt }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO meta_token_audit
       (integration_id, action, status, error, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(integrationId, action, status, error || null, expiresAt || null);
}

/**
 * List all integrations (for admin UI).
 */
export function listIntegrations() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, app_id, pixel_id, test_event_code, graph_api_version,
              token_expires_at, is_active, last_tested_at, last_sync_at,
              created_at, updated_at
         FROM meta_integrations
        ORDER BY id DESC`
    )
    .all();
}

/**
 * Test the Meta connection using the active integration's page access token.
 */
export async function testMetaConnection(integrationId) {
  const secrets = getIntegrationSecrets(integrationId);
  if (!secrets || !secrets.pageAccessToken) {
    throw new AppError(400, 'No page access token configured');
  }

  // Call /me to validate the token
  const version = secrets.apiVersion || 'v19.0';
  const url = new URL(`https://graph.facebook.com/${version}/me`);
  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('access_token', secrets.pageAccessToken);

  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (!res.ok || body.error) {
    await recordTokenAudit({
      integrationId,
      action: 'token_test',
      status: 'failure',
      error: body.error?.message || `HTTP ${res.status}`,
    });
    throw new AppError(400, `Meta connection test failed: ${body.error?.message || res.status}`);
  }

  await recordTokenAudit({
    integrationId,
    action: 'token_test',
    status: 'success',
  });

  return { connected: true, userId: body.id, userName: body.name };
}
