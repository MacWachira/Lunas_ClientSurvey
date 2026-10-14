require('dotenv').config();

function required(name, minimumLength = 1) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required${minimumLength > 1 ? ` and must be at least ${minimumLength} characters` : ''}`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  isProduction,
  port: Number(process.env.PORT || 10000),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  allowedOrigins: required('ALLOWED_ORIGINS').split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean),
  jwtSecret: required('JWT_SECRET', 32),
  adminEmail: required('ADMIN_EMAIL').toLowerCase(),
  adminPassword: required('ADMIN_PASSWORD', 12),
  trustProxy: Number(process.env.TRUST_PROXY || 1)
};
