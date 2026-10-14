process.env.DATABASE_URL = 'postgresql://localhost/test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'strong-test-password';

const test = require('node:test');
const assert = require('node:assert/strict');
const { surveySchema, adjustmentSchema } = require('../src/validation');

const validSurvey = {
  idempotencyKey: '816c05c4-3d4f-4de8-9c62-591034a6ea3a',
  clientName: 'Test Client', clientPhone: '0712345678', visitDate: '2026-10-13',
  clientType: 'new', services: ['Gel'], overallRating: 5, feedbackType: 'compliment'
};

test('accepts a valid survey and rejects unknown fields', () => {
  assert.equal(surveySchema.safeParse(validSurvey).success, true);
  assert.equal(surveySchema.safeParse({ ...validSurvey, loyaltyPointsEarned: 1000 }).success, false);
});

test('rejects invalid ratings and zero-point adjustments', () => {
  assert.equal(surveySchema.safeParse({ ...validSurvey, overallRating: 6 }).success, false);
  assert.equal(adjustmentSchema.safeParse({ points: 0, reason: 'Invalid adjustment' }).success, false);
});
