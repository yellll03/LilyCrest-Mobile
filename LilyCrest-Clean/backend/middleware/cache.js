const crypto = require('crypto');

/**
 * In-memory cache middleware with ETag support.
 * Caches JSON GET responses and returns 304 when content hasn't changed.
 *
 * @param {number} ttlSeconds - Cache time-to-live in seconds (default 60)
 */
function cacheMiddleware(ttlSeconds = 60) {
  const cache = new Map();
  const MAX_ENTRIES = 500;

  // Periodic cleanup every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (now > entry.expires) cache.delete(key);
    }
  }, 5 * 60 * 1000);

  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      // Invalidate cache for this user on mutations
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.user?.user_id) {
        for (const [key] of cache) {
          if (key.startsWith(req.user.user_id)) cache.delete(key);
        }
      }
      return next();
    }

    const userId = req.user?.user_id || 'anon';
    const cacheKey = `${userId}:${req.originalUrl}`;
    const cached = cache.get(cacheKey);

    // Check If-None-Match header
    if (cached && Date.now() < cached.expires) {
      const clientEtag = req.headers['if-none-match'];
      if (clientEtag && clientEtag === cached.etag) {
        return res.status(304).end();
      }

      // Serve from cache
      res.set('ETag', cached.etag);
      res.set('X-Cache', 'HIT');
      res.set('Cache-Control', `private, max-age=${ttlSeconds}`);
      return res.status(cached.statusCode).json(cached.body);
    }

    // Intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const bodyStr = JSON.stringify(body);
        const etag = `"${crypto.createHash('md5').update(bodyStr).digest('hex')}"`;

        // Enforce max cache size
        if (cache.size >= MAX_ENTRIES) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }

        cache.set(cacheKey, {
          body,
          etag,
          statusCode: res.statusCode,
          expires: Date.now() + ttlSeconds * 1000,
        });

        res.set('ETag', etag);
        res.set('X-Cache', 'MISS');
        res.set('Cache-Control', `private, max-age=${ttlSeconds}`);
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = { cacheMiddleware };
