// Express 4 does not catch errors thrown by async route handlers: the rejected
// promise becomes an unhandled rejection, and Node stops the whole server. One
// malformed request (say, an id that isn't an ObjectId) took the site down for
// everyone. This forwards those errors to the error handler in index.js
// instead, so the bad request gets a 500 and everyone else carries on.
//
// Import this before any routes are used.

import Layer from 'express/lib/router/layer.js';

if (typeof Layer?.prototype?.handle_request === 'function') {
  Layer.prototype.handle_request = function handleRequest (req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // an error handler, not a request handler
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

// Anything async outside a route (timers, websocket handlers) is logged
// rather than fatal.
process.on('unhandledRejection', (err) => {
  console.error('unhandled rejection (server kept running):', err);
});
