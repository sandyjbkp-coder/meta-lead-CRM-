// OAuth routes: authorize, callback, disconnect, status
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { authMiddleware } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../utils/errorCodes.js';
import {
  persistOAuthState,
  consumeOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForToken,
  exchangeLongLivedToken,
  fetchGrantedPages,
  upsertIntegration,
  getActiveIntegration,
  getIntegrationSecrets,
  deactivateIntegration,
  recordTokenAudit,
  checkTokenHealth,
  testMetaConnection,
  listIntegrations,
} from '../services/oauth.js';

const router = Router();

// ----- PUBLIC: OAuth authorize (requires user to be logged in) -----

// GET /api/meta/oauth/authorize
router.get('/oauth/authorize', authMiddleware, async (req, res, next) => {
  try {
    const schema = z.object({
      redirect_uri: z.string().url(),
      app_id: z.string().optional(),
    });

    const { redirect_uri, app_id } = schema.parse(req.query);

    const db = getDb();
    const integration = app_id
      ? db.prepare('SELECT * FROM meta_integrations WHERE app_id = ? AND is_active = 1').get(app_id)
      : getActiveIntegration();

    if (!integration) {
      throw new AppError(400, 'No Meta integration configured. Please configure app credentials first.');
    }

    const { appId, appSecret } = integration.app_id ? { appId: integration.app_id, appSecret: null } : { appId: null, appSecret: null };

    // We need the app secret from env if not stored yet
    const secrets = app_id ? getIntegrationSecrets(integration.id) : null;
    const metaAppId = integration.app_id || process.env.META_APP_ID || '';
    const metaAppSecret = secrets ? secrets.appSecret : (process.env.META_APP_SECRET || '');

    if (!metaAppId || !metaAppSecret) {
      throw new AppError(400, 'Meta app credentials not configured');
    }

    // Generate and persist OAuth state (CSRF protection)
    const state = await persistOAuthState({
      userId: req.user.id,
      redirectUri: redirect_uri,
      scopes: ['pages_read_engagement', 'pages_manage_posts', 'pages_show_list', 'business_management', 'lead_retrieval'],
    });

    const authUrl = buildAuthorizationUrl({
      appId: metaAppId,
      redirectUri: redirect_uri,
      state,
      scopes: ['pages_read_engagement', 'pages_manage_posts', 'pages_show_list', 'business_management', 'lead_retrieval'],
      apiVersion: integration.graph_api_version || 'v19.0',
    });

    res.json({ authUrl, state });
  } catch (err) {
    next(err);
  }
});

// ----- PUBLIC: OAuth callback (Meta redirects here) -----

// GET /api/meta/oauth/callback
router.get('/oauth/callback', async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string().min(1),
      state: z.string().min(1),
      redirect_uri: z.string().url().optional(),
      error: z.string().optional(),
      error_reason: z.string().optional(),
      error_description: z.string().optional(),
    });

    const { code, state, redirect_uri, error, error_reason, error_description } = schema.parse(req.query);

    // Meta may redirect here with an error if user denied
    if (error) {
      const db = getDb();
      db.prepare(
        `INSERT INTO meta_integration_logs (integration_id, level, component, message, details, created_at)
         VALUES (null, 'warn', 'oauth', 'oauth_user_denied', ?, datetime('now'))`
      ).run(JSON.stringify({ error, error_reason, error_description }));
      return res.redirect(`${redirect_uri || '/settings/meta'}?oauth=denied&error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      throw new AppError(400, 'Missing OAuth code or state');
    }

    // Consume and validate the state (CSRF + expiry protection)
    const userId = await consumeOAuthState(state, redirect_uri || '');

    const db = getDb();
    const integration = getActiveIntegration();
    if (!integration) {
      throw new AppError(400, 'No active Meta integration found');
    }

    const secrets = getIntegrationSecrets(integration.id);
    if (!secrets) {
      throw new AppError(400, 'Integration secrets not found');
    }

    // Exchange authorization code for short-lived user access token
    const tokenResult = await exchangeCodeForToken({
      code,
      redirectUri: redirect_uri || '',
      appId: secrets.appId,
      appSecret: secrets.appSecret,
      apiVersion: secrets.apiVersion,
    });

    // Exchange for long-lived token
    const longLived = await exchangeLongLivedToken({
      userAccessToken: tokenResult.accessToken,
      appId: secrets.appId,
      appSecret: secrets.appSecret,
      apiVersion: secrets.apiVersion,
    });

    // Fetch granted pages with their page access tokens
    const pages = await fetchGrantedPages(longLived.accessToken, secrets.apiVersion);

    if (!pages || pages.length === 0) {
      throw new AppError(400, 'No pages found for this Meta account');
    }

    // Use the first page that has ADVERTISER or PAGE_MANAGER task
    const advertiserPage = pages.find((p) => p.tasks && p.tasks.includes('ADVERTISER')) || pages[0];
    const pageAccessToken = advertiserPage.accessToken;

    // Upsert integration with encrypted credentials at rest
    await upsertIntegration({
      appId: secrets.appId,
      appSecret: secrets.appSecret,
      verifyToken: secrets.verifyToken,
      pageAccessToken,
      pixelId: integration.pixel_id || undefined,
      testEventCode: integration.test_event_code || undefined,
      apiVersion: secrets.apiVersion,
      expiresAt: longLived.expiresAt,
      createdBy: userId,
    });

    await recordTokenAudit({
      integrationId: integration.id,
      action: 'oauth_grant',
      status: 'success',
      expiresAt: longLived.expiresAt,
    });

    await logIntegrationEvent({
      integrationId: integration.id,
      level: 'info',
      component: 'oauth',
      message: 'oauth_completed',
      details: JSON.stringify({ pageId: advertiserPage.pageId, pageName: advertiserPage.pageName, expiresAt: longLived.expiresAt }),
    });

    // Redirect back to frontend with success
    const redirectTo = redirect_uri || '/settings/meta';
    res.redirect(`${redirectTo}?oauth=success&integrationId=${integration.id}&pageId=${advertiserPage.pageId}`);
  } catch (err) {
    next(err);
  }
});

// ----- PROTECTED: Disconnect -----

// POST /api/meta/oauth/disconnect
router.post('/oauth/disconnect', authMiddleware, requireRole('admin'), async (req, res, next) => {
  try {
    const schema = z.object({
      integration_id: z.coerce.number().optional(),
    });

    const { integration_id } = schema.parse(req.body);

    const db = getDb();
    const integration = integration_id
      ? db.prepare('SELECT * FROM meta_integrations WHERE id = ?').get(integration_id)
      : getActiveIntegration();

    if (!integration) {
      throw new AppError(404, 'No active Meta integration found');
    }

    await deactivateIntegration(integration.id);

    await recordTokenAudit({
      integrationId: integration.id,
      action: 'oauth_refresh',
      status: 'success',
      error: 'disconnected',
    });

    await logIntegrationEvent({
      integrationId: integration.id,
      level: 'info',
      component: 'oauth',
      message: 'integration_disconnected',
      details: JSON.stringify({ userId: req.user.id }),
    });

    res.json({ disconnected: true, integrationId: integration.id });
  } catch (err) {
    next(err);
  }
});

// ----- PROTECTED: Integration status / token health -----

// GET /api/meta/oauth/status
router.get('/oauth/status', authMiddleware, async (req, res, next) => {
  try {
    const health = checkTokenHealth();
    const integrations = listIntegrations();

    res.json({
      hasActiveIntegration: !!health.integration,
      needsReauth: health.needsReauth,
      reason: health.reason,
      integration: health.integration,
      integrations,
    });
  } catch (err) {
    next(err);
  }
});

// ----- PROTECTED: Test connection -----

// POST /api/meta/oauth/test
router.post('/oauth/test', authMiddleware, requireRole('admin'), async (req, res, next) => {
  try {
    const schema = z.object({
      integration_id: z.coerce.number().optional(),
    });

    const { integration_id } = schema.parse(req.body);

    const id = integration_id || null;
    const integration = id
      ? dbPrepareGetById(id)
      : getActiveIntegration();

    if (!integration) {
      throw new AppError(400, 'No Meta integration configured');
    }

    const result = await testMetaConnection(integration.id);

    // Update last_tested_at
    const db = getDb();
    db.prepare(
      `UPDATE meta_integrations SET last_tested_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run(integration.id);

    res.json({ connected: true, ...result });
  } catch (err) {
    next(err);
  }
});

function dbPrepareGetById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM meta_integrations WHERE id = ?').get(id);
}

export default router;
