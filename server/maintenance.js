// Planned downtime, driven by two Cloud Run environment variables (changing
// them doesn't need a new build):
//
//   MAINTENANCE_AT=2026-10-29T16:00:00Z   warn everyone: pages show a popup
//                                          counting down to this time
//   MAINTENANCE_MODE=true                  take the site down: pages show the
//                                          maintenance screen, the API answers 503
//
// Unset both to go back to normal.

const STATIC_ASSET = /\.(js|css|map|png|ico|svg|woff2?|ttf|eot)$/;

export function maintenanceStatus () {
  const at = Date.parse(process.env.MAINTENANCE_AT || '');
  return {
    maintenance: process.env.MAINTENANCE_MODE === 'true',
    at: Number.isFinite(at) ? new Date(at).toISOString() : null
  };
}

export function maintenanceMiddleware (req, res, next) {
  if (req.path === '/api/status') {
    res.set('Cache-Control', 'no-store');
    return res.json(maintenanceStatus());
  }
  if (process.env.MAINTENANCE_MODE !== 'true' || STATIC_ASSET.test(req.path)) {
    return next();
  }
  res.set('Retry-After', '600');
  res.set('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(503).json({ error: 'Certamen Reader is down for maintenance. Please try again in a few minutes.' });
  }
  res.status(503).sendFile('maintenance.html', { root: './client' });
}
