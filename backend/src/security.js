const jwt = require('jsonwebtoken');
const config = require('./config');

function issueAdminToken(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, role: 'admin' },
    config.jwtSecret,
    { expiresIn: '4h', issuer: 'lunas-api', audience: 'lunas-admin' }
  );
}

function requireAdmin(req, res, next) {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return res.status(401).json({ success: false, error: 'Authentication required' });
  try {
    req.admin = jwt.verify(token, config.jwtSecret, { issuer: 'lunas-api', audience: 'lunas-admin' });
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Session expired or invalid' });
  }
}

module.exports = { issueAdminToken, requireAdmin };
