const express = require('express');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Databricks Apps runtime env (server-side only — never sent to browser).
// DATABRICKS_CLIENT_SECRET is the most sensitive: it lives only in this pod
// and is used to mint short-lived OAuth tokens for the App Service Principal.
const DATABRICKS_HOST          = process.env.DATABRICKS_HOST          || '';
const DATABRICKS_CLIENT_ID     = process.env.DATABRICKS_CLIENT_ID     || '';
const DATABRICKS_CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET || '';
const DATABRICKS_APP_NAME      = process.env.DATABRICKS_APP_NAME      || '';
const DATABRICKS_WORKSPACE_ID  = process.env.DATABRICKS_WORKSPACE_ID  || '';

// Prometheux auth backend (Edge Functions) base URL (public; not a secret).
// Used by /api/prometheux-sso to proxy zero-click login requests.
const PROMETHEUX_AUTH_URL = process.env.PROMETHEUX_AUTH_URL || '';

// Build the workspace URL with https:// prefix (DATABRICKS_HOST may come without scheme)
function workspaceUrl() {
  if (!DATABRICKS_HOST) return '';
  if (DATABRICKS_HOST.startsWith('http://') || DATABRICKS_HOST.startsWith('https://')) {
    return DATABRICKS_HOST.replace(/\/$/, '');
  }
  return `https://${DATABRICKS_HOST}`.replace(/\/$/, '');
}

// Log env keys at startup (names only, never values)
const dbEnvKeys = Object.keys(process.env).filter((k) => k.startsWith('DATABRICKS_'));
console.log('Databricks env keys present:', dbEnvKeys);

// ─────────────────────────────────────────────────────────────────────────
// Security headers (F9 from 2026-06-12 review)
// ─────────────────────────────────────────────────────────────────────────
// Strict CSP allowing only:
//   - own origin                              (script/style/img/font/assets)
//   - https://api.prometheux.ai               (Prometheux Cloud reasoning REST)
//   - wss://api.prometheux.ai                 (Prometheux Cloud streaming —
//                                              concept editor, machine status,
//                                              dashboard subscriptions; CSP
//                                              treats wss:// as a separate
//                                              scheme from https://)
//   - https://auth.prometheux.ai              (Prometheux auth backend REST)
// No external CDN scripts; no inline scripts. 'unsafe-inline' is allowed for
// styles only (React inline `style={{}}` attributes + Tailwind animations).
// frame-ancestors 'self' prevents clickjacking; the app runs as a top-level
// Databricks Apps page, never as an embedded iframe of a third-party origin.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src':  ["'self'"],
        'script-src':   ["'self'"],
        'style-src':    ["'self'", "'unsafe-inline'"],
        'img-src':      ["'self'", 'data:', 'blob:'],
        'font-src':     ["'self'", 'data:'],
        'connect-src':  [
          "'self'",
          'https://api.prometheux.ai',
          'wss://api.prometheux.ai',
          'https://auth.prometheux.ai',
        ],
        'worker-src':   ["'self'", 'blob:'],
        'frame-ancestors': ["'self'"],
        'base-uri':     ["'self'"],
        'form-action':  ["'self'"],
        'object-src':   ["'none'"],
        'upgrade-insecure-requests': [],
      },
    },
    // Workers + lottie players need same-origin resource sharing but not COEP.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    // hsts is added by Databricks Apps' edge proxy; setting it here is redundant
    // but harmless.
  })
);

// ─────────────────────────────────────────────────────────────────────────
// User-attributed audit log (F16 from 2026-06-12 review)
// ─────────────────────────────────────────────────────────────────────────
// Every API request is logged with the proxy-validated user identity, method,
// path, status and elapsed time. Bodies are NOT logged (they may contain
// queries or PII). Structured JSON so the Databricks Apps log collector can
// index by user.
function auditLog(event, fields) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
  } catch (_) {
    console.log(`[audit] ${event}`);
  }
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const start = Date.now();
  res.on('finish', () => {
    auditLog('api_request', {
      method:  req.method,
      path:    req.path,
      status:  res.statusCode,
      ms:      Date.now() - start,
      user:    req.headers['x-forwarded-email']               || null,
      userId:  req.headers['x-forwarded-user']                || null,
      username: req.headers['x-forwarded-preferred-username'] || null,
    });
  });
  next();
});

// ─────────────────────────────────────────────────────────────────────────
// Error sanitizer (F15 from 2026-06-12 review)
// ─────────────────────────────────────────────────────────────────────────
// Client receives a generic message; full diagnostic detail is logged
// server-side only. Avoids leaking upstream OIDC/SCIM/SSO response text.
function sendSanitizedError(req, res, statusCode, internalErr, clientMessage) {
  const detail = internalErr && internalErr.message
    ? internalErr.message
    : String(internalErr || 'unknown');
  console.error(`[error] ${req.method} ${req.path} → ${statusCode}: ${detail}`);
  auditLog('api_error', {
    method:  req.method,
    path:    req.path,
    status:  statusCode,
    user:    req.headers['x-forwarded-email'] || null,
  });
  return res.status(statusCode).json({ error: clientMessage || 'Upstream request failed' });
}

// ─────────────────────────────────────────────────────────────────────────
// OAuth M2M token cache for the app's service principal
// ─────────────────────────────────────────────────────────────────────────
// We mint a short-lived bearer token using DATABRICKS_CLIENT_ID +
// DATABRICKS_CLIENT_SECRET via the OIDC client_credentials flow, cache it
// server-side, and only return the resulting bearer token to the browser.
// The secret never leaves the Apps pod.

let cachedToken = null;
let cachedExpiresAtMs = 0;
let inflightMintPromise = null;
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

async function mintAppToken() {
  if (!DATABRICKS_HOST || !DATABRICKS_CLIENT_ID || !DATABRICKS_CLIENT_SECRET) {
    throw new Error('App service principal credentials not available in env');
  }

  const url = `${workspaceUrl()}/oidc/v1/token`;
  const credentials = Buffer.from(
    `${DATABRICKS_CLIENT_ID}:${DATABRICKS_CLIENT_SECRET}`
  ).toString('base64');

  // Note on scope (F4 from 2026-06-12 security review):
  // The auto-provisioned Databricks Apps SP only supports `all-apis` for the
  // workspace OIDC client_credentials flow. Granular scopes such as `scim`,
  // `clusters`, `libraries` are documented for *custom* OAuth app integrations
  // (registered via /api/2.0/accounts/{aid}/oauth2/custom-app-integrations),
  // not for the SP that Databricks Apps issues to a 3P listing. We will
  // narrow the scope here as soon as Databricks supports it for App SPs.
  //
  // Mitigations already in place that limit the blast radius:
  //   - the token is NEVER returned to the browser (CRITICAL F1 fix)
  //   - the token is held in this Node process only, cached and short-lived
  //   - audit logging captures every API call with the acting user identity
  //   - the only Databricks API the SP token is used for is SCIM /Me and the
  //     OIDC mint itself; everything else uses the per-user OBO token
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'all-apis',
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth token mint failed (${resp.status}): ${text}`);
  }

  const json = await resp.json();
  const expiresInMs = (json.expires_in || 3600) * 1000;
  cachedToken = json.access_token;
  cachedExpiresAtMs = Date.now() + expiresInMs;
  console.log(
    `[app-token] minted, expires in ${Math.round(expiresInMs / 1000)}s`
  );
  return cachedToken;
}

async function getAppToken() {
  const now = Date.now();
  if (cachedToken && cachedExpiresAtMs - now > REFRESH_SAFETY_MARGIN_MS) {
    return cachedToken;
  }
  if (inflightMintPromise) {
    return inflightMintPromise;
  }
  inflightMintPromise = mintAppToken().finally(() => {
    inflightMintPromise = null;
  });
  return inflightMintPromise;
}

// ─────────────────────────────────────────────────────────────────────────
// Service principal SCIM identity (cached for the lifetime of the pod)
// ─────────────────────────────────────────────────────────────────────────
// SCIM /Me on the workspace returns the SP's `userName` (e.g. "app-5ctusr")
// and `displayName` (e.g. "prometheux"). These don't change after the app
// is provisioned, so we look them up once and cache them.
let cachedPrincipalIdentity = null;
let inflightPrincipalLookup = null;

async function fetchPrincipalIdentity() {
  const token = await getAppToken();
  const resp = await fetch(`${workspaceUrl()}/api/2.0/preview/scim/v2/Me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/scim+json',
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SCIM /Me failed (${resp.status}): ${text}`);
  }
  const me = await resp.json();
  // SCIM /Me returns the workspace-internal numeric SP id. We expose it so the
  // frontend can build a deep link to the SP's secrets page in the workspace
  // admin UI (.../settings/iam/service-principals/<id>) without the user
  // hunting for it manually.
  return {
    id:          me.id          || null,
    userName:    me.userName    || null,
    displayName: me.displayName || null,
  };
}

async function getPrincipalIdentity() {
  if (cachedPrincipalIdentity) return cachedPrincipalIdentity;
  if (inflightPrincipalLookup) return inflightPrincipalLookup;
  inflightPrincipalLookup = fetchPrincipalIdentity()
    .then((id) => {
      cachedPrincipalIdentity = id;
      console.log(`[principal] resolved userName=${id.userName}`);
      return id;
    })
    .finally(() => {
      inflightPrincipalLookup = null;
    });
  return inflightPrincipalLookup;
}

// ─────────────────────────────────────────────────────────────────────────
// Identity gate — proxy-validated user identity is required for every /api/*
// ─────────────────────────────────────────────────────────────────────────
// The Databricks Apps proxy authenticates the end user upstream and injects
// X-Forwarded-{Email,User,Preferred-Username} (and X-Forwarded-Access-Token)
// on every request. We rely on the proxy as the authorization boundary; the
// previous Referer-based same-origin check was deprecated (F8 from the
// 2026-06-12 review) because Referer/Host are client-supplied and can be
// spoofed by non-browser clients.
function requireProxyIdentity(req, res, next) {
  if (!req.headers['x-forwarded-email'] && !req.headers['x-forwarded-user']) {
    return sendSanitizedError(req, res, 401, 'missing_proxy_identity', 'Unauthenticated');
  }
  return next();
}

// ─────────────────────────────────────────────────────────────────────────
// /api/app-context — autofill data for the React app (3P mode only)
// ─────────────────────────────────────────────────────────────────────────
// CHANGED (F1 from 2026-06-12 review): this endpoint NO LONGER returns the
// App Service Principal OAuth token. Returning an all-apis bearer to the
// browser turned a server-only secret into a client-readable credential and
// was rated CRITICAL. The browser now only receives non-sensitive autofill
// data — workspace URL, IDs, principal display names. For Databricks API
// calls that need a token, the frontend uses the per-user OBO token issued
// by /api/user-token (see below).
app.get('/api/app-context', requireProxyIdentity, async (req, res) => {
  try {
    let principal = { id: null, userName: null, displayName: null };
    try {
      principal = await getPrincipalIdentity();
    } catch (err) {
      console.warn('[app-context] principal lookup failed:', err.message);
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      mode: 'databricks_3p',
      workspaceUrl: workspaceUrl(),
      clientId: DATABRICKS_CLIENT_ID,
      appName: DATABRICKS_APP_NAME,
      workspaceId: DATABRICKS_WORKSPACE_ID,
      principalId:          principal.id,
      principalUserName:    principal.userName,
      principalDisplayName: principal.displayName,
      user: {
        email:    req.headers['x-forwarded-email']               || null,
        userId:   req.headers['x-forwarded-user']                || null,
        username: req.headers['x-forwarded-preferred-username']  || null,
      },
      // NOTE: no `auth.token` field. The frontend obtains a per-user OBO
      // token from /api/user-token instead. The App SP token never leaves
      // this process.
    });
  } catch (err) {
    return sendSanitizedError(req, res, 502, err, 'Upstream request failed');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// /api/user-token — per-user On-Behalf-Of token (F1 remediation)
// ─────────────────────────────────────────────────────────────────────────
// The Databricks Apps proxy authenticates the end user and forwards their
// OAuth access token in the X-Forwarded-Access-Token header on every
// request. This token is scoped to the user's own Databricks permissions
// (NOT the App SP all-apis scope) and is refreshed by the proxy on each
// request, so we just return it through to the frontend for use against the
// workspace / Prometheux Cloud APIs.
//
// Security properties:
//   - per-user (audit-trail keyed to the acting user)
//   - scoped to the user's existing workspace permissions, not all-apis
//   - short-lived (refreshed by the Apps proxy)
//   - bound to the same browser session that hit this server
app.get('/api/user-token', requireProxyIdentity, (req, res) => {
  const oboToken = req.headers['x-forwarded-access-token'];
  if (!oboToken) {
    // Local dev or proxy mis-configuration: there's no OBO token to return.
    return sendSanitizedError(req, res, 404, 'no_obo_token', 'OBO token unavailable');
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    mode: 'obo',
    token: oboToken,
    // We can't read the proxy's actual expiry; the frontend should refetch
    // periodically (and on 401) to pick up rotations.
    refreshAfterMs: 10 * 60 * 1000,
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /api/prometheux-sso — zero-click login bridge to Prometheux auth backend
// ─────────────────────────────────────────────────────────────────────────
// The browser hits this endpoint at AuthProvider mount (3P mode only).
// We mint a fresh app-principal token and forward it (plus the Databricks
// proxy-injected user identity headers) to the `databricks-sso` Edge
// Function, which:
//   - validates the SP token via SCIM /Me,
//   - upserts the Prometheux user / profile / Platform application request,
//   - returns a session pair { access_token, refresh_token } to the browser.
// The service-role key never lives in this pod — it lives in the EF.
//
// NOTE (F13, accepted risk for now): the SP token is forwarded as Bearer to
// auth.prometheux.ai for the SCIM-based validation step. The Edge Function
// uses it only for `/api/2.0/preview/scim/v2/Me` against the issuing
// workspace and never stores it. A future revision will replace this with
// a signed identity assertion (no bearer egress) — tracked separately.
app.post('/api/prometheux-sso', requireProxyIdentity, async (req, res) => {
  if (!PROMETHEUX_AUTH_URL) {
    return sendSanitizedError(req, res, 500, 'sso_not_configured', 'SSO not configured');
  }

  const userEmail = req.headers['x-forwarded-email'];
  try {
    const spToken = await getAppToken();
    const ssoResp = await fetch(`${PROMETHEUX_AUTH_URL}/databricks-sso`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${spToken}`,
        'X-Databricks-Workspace-Url':      workspaceUrl(),
        'X-Databricks-Workspace-Id':       DATABRICKS_WORKSPACE_ID || '',
        'X-Databricks-User-Email':         userEmail,
        'X-Databricks-User-Id':            req.headers['x-forwarded-user'] || '',
        'X-Databricks-Preferred-Username': req.headers['x-forwarded-preferred-username'] || '',
        'X-Databricks-Sp-Client-Id':       DATABRICKS_CLIENT_ID || '',
      },
    });

    auditLog('sso_upsert', {
      user:   userEmail,
      status: ssoResp.status,
    });

    // Forward upstream JSON to the browser, but if the upstream returned a
    // non-JSON body (proxy 5xx, HTML error page, etc.) we collapse it into a
    // generic message so we don't leak internal details (F15).
    const text = await ssoResp.text();
    if (ssoResp.ok) {
      try {
        const body = JSON.parse(text);
        return res.status(ssoResp.status).set('Cache-Control', 'no-store').json(body);
      } catch (_) {
        return sendSanitizedError(req, res, 502, 'sso_bad_response', 'SSO bridge returned invalid response');
      }
    }
    // Upstream error: log full detail, return generic to client.
    return sendSanitizedError(req, res, ssoResp.status, `sso_upstream ${ssoResp.status}: ${text.slice(0, 500)}`, 'SSO bridge failed');
  } catch (err) {
    return sendSanitizedError(req, res, 502, err, 'SSO bridge unreachable');
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Static frontend
// ─────────────────────────────────────────────────────────────────────────
app.use(express.static('frontend'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server running on http://0.0.0.0:${PORT}`);
});
