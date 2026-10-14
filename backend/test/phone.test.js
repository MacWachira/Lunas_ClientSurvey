process.env.DATABASE_URL = 'postgresql://localhost/test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'strong-test-password';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('../src/phone');

test('normalizes Kenyan local phone formats', () => {
  assert.equal(normalizePhone('0712 345 678'), '254712345678');
  assert.equal(normalizePhone('712345678'), '254712345678');
  assert.equal(normalizePhone('+254 712 345 678'), '254712345678');
});

test('rejects invalid phone numbers', () => {
  assert.equal(normalizePhone('12345'), '');
  assert.equal(normalizePhone(''), '');
});
