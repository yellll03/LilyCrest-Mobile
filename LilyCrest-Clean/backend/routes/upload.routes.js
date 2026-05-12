const crypto = require('crypto');
const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const IMAGEKIT_PRIVATE_KEY = String(process.env.IMAGEKIT_PRIVATE_KEY || '').trim();

router.get('/imagekit-auth', authMiddleware, (req, res) => {
  if (!IMAGEKIT_PRIVATE_KEY) {
    return res.status(503).json({ detail: 'Image uploads are not configured.' });
  }

  const token = crypto.randomUUID();
  const expire = Math.floor(Date.now() / 1000) + (60 * 30);
  const signature = crypto
    .createHmac('sha1', IMAGEKIT_PRIVATE_KEY)
    .update(`${token}${expire}`)
    .digest('hex');

  return res.json({ token, expire, signature });
});

module.exports = router;
