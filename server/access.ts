import type { RequestHandler } from 'express';
import { isHosted } from './environment.js';

export function accessControl(env: NodeJS.ProcessEnv, port: number): RequestHandler {
  const hosted = isHosted(env);
  const origins = hosted
    ? (env.HARNESS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    : [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  if (hosted && (!origins.length || origins.some(origin => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin; } catch { return true; }
  }))) throw new Error('Hosted mode requires explicit HTTPS HARNESS_ALLOWED_ORIGINS.');
  const hosts = new Set(origins.map(origin => new URL(origin).host));
  const owner = env.HARNESS_OWNER_ID?.toLowerCase();
  if (hosted && !/^[0-9a-f-]{36}$/.test(owner || '')) throw new Error('Hosted private preview requires HARNESS_OWNER_ID.');
  const allowedOrigins = new Set(origins);
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (!hosts.has(req.headers.host || '')) return res.status(403).json({ error: 'This hostname is not allowed.' });
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
    if (hosted) {
      res.setHeader('Cache-Control', 'private, no-store');
      // Only trust identity headers when Azure's authentication module is enabled.
      // App Service strips caller-supplied X-MS-CLIENT-* headers before forwarding.
      if (!env.WEBSITE_SITE_NAME || !/^(true|1)$/i.test(env.WEBSITE_AUTH_ENABLED || '')) {
        return res.status(503).json({ error: 'Private preview sign-in is not configured.' });
      }
      if (req.get('X-MS-CLIENT-PRINCIPAL-IDP') !== 'aad' || req.get('X-MS-CLIENT-PRINCIPAL-ID')?.toLowerCase() !== owner) {
        return res.status(403).json({ error: 'This preview is restricted to its owner. Sign in with the authorized Microsoft account.' });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !origin) {
        return res.status(403).json({ error: 'A same-origin browser request is required.' });
      }
    }
    next();
  };
}
