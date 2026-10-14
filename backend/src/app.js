const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { pool, withTransaction } = require('./db');
const { issueAdminToken, requireAdmin } = require('./security');
const { normalizePhone } = require('./phone');
const { surveySchema, loginSchema, adjustmentSchema, validate } = require('./validation');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.body.password'] }));
app.use(helmet());
app.use(compression());
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
    callback(new Error('Origin is not allowed'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  maxAge: 86_400
}));
app.use(express.json({ limit: '64kb' }));
app.use('/api/v1/auth', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/v1/admin', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const surveyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api/', publicLimiter);

app.get('/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) { next(error); }
});

app.post('/api/v1/auth/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;
    const result = await pool.query('SELECT id, email, password_hash FROM admins WHERE email = $1', [email.toLowerCase()]);
    const admin = result.rows[0];
    const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;
    if (!admin || !valid) return res.status(401).json({ success: false, error: 'Invalid email or password' });
    res.json({ success: true, token: issueAdminToken(admin), expiresIn: 14_400, admin: { id: admin.id, email: admin.email } });
  } catch (error) { next(error); }
});

app.get('/api/v1/auth/me', requireAdmin, (req, res) => {
  res.json({ success: true, admin: { id: req.admin.sub, email: req.admin.email } });
});

app.post('/api/v1/surveys', surveyLimiter, validate(surveySchema), async (req, res, next) => {
  try {
    const input = req.validatedBody;
    const phone = normalizePhone(input.clientPhone);
    const services = Array.isArray(input.services) ? input.services : input.services.split(',').map(value => value.trim()).filter(Boolean);
    let serviceRatings = input.serviceRatings;
    if (typeof serviceRatings === 'string') {
      try { serviceRatings = JSON.parse(serviceRatings); } catch { serviceRatings = []; }
    }
    const marketingConsent = input.marketingConsent === true || input.marketingConsent === 'Yes';

    const result = await withTransaction(async client => {
      const existing = await client.query(
        `SELECT s.id, COALESCE(SUM(lt.points), 0)::int AS balance
         FROM surveys s LEFT JOIN loyalty_transactions lt ON lt.customer_id = s.customer_id
         WHERE s.idempotency_key = $1 GROUP BY s.id`, [input.idempotencyKey]
      );
      if (existing.rowCount) return { surveyId: existing.rows[0].id, pointsEarned: 0, balance: existing.rows[0].balance, duplicateRequest: true };

      let customerId = null;
      if (phone) {
        const customer = await client.query(
          `INSERT INTO customers(name, phone, marketing_consent) VALUES ($1, $2, $3)
           ON CONFLICT (phone) DO UPDATE SET
             name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE customers.name END,
             marketing_consent = EXCLUDED.marketing_consent,
             updated_at = now()
           RETURNING id`, [input.clientName, phone, marketingConsent]
        );
        customerId = customer.rows[0].id;
      }

      const survey = await client.query(
        `INSERT INTO surveys(
          idempotency_key, customer_id, visit_date, client_name, client_phone, client_type,
          services, service_ratings, overall_rating, staff_rating, cleanliness_rating, wait_time_rating,
          feedback_type, feedback_text, recommendation, improvements, employee_shoutout,
          how_did_you_hear, marketing_consent
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        RETURNING id`, [
          input.idempotencyKey, customerId, input.visitDate, input.clientName, phone || input.clientPhone,
          input.clientType, JSON.stringify(services), JSON.stringify(serviceRatings), input.overallRating,
          input.staffRating, input.cleanlinessRating, input.waitTimeRating, input.feedbackType,
          input.feedbackText, input.recommendation, input.improvements, input.employeeShoutout,
          input.howDidYouHear, marketingConsent
        ]
      );

      let pointsEarned = 0;
      if (customerId) {
        const award = await client.query(
          `INSERT INTO loyalty_transactions(customer_id, survey_id, transaction_type, points, reason, visit_date)
           VALUES ($1, $2, 'earn', 10, 'Survey visit reward', $3)
           ON CONFLICT (customer_id, visit_date) WHERE transaction_type = 'earn' DO NOTHING
           RETURNING points`, [customerId, survey.rows[0].id, input.visitDate]
        );
        pointsEarned = award.rows[0]?.points || 0;
      }
      const balanceResult = customerId
        ? await client.query('SELECT COALESCE(SUM(points), 0)::int AS balance FROM loyalty_transactions WHERE customer_id = $1', [customerId])
        : { rows: [{ balance: 0 }] };
      return { surveyId: survey.rows[0].id, pointsEarned, balance: balanceResult.rows[0].balance, duplicateRequest: false };
    });

    res.status(result.duplicateRequest ? 200 : 201).json({ success: true, ...result });
  } catch (error) { next(error); }
});

app.get('/api/v1/admin/loyalty/members', requireAdmin, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const result = await pool.query(
      `SELECT c.id, c.name, c.phone, c.marketing_consent AS "marketingConsent",
              c.created_at AS "memberSince", COALESCE(SUM(lt.points), 0)::int AS balance,
              COUNT(*) FILTER (WHERE lt.transaction_type = 'earn')::int AS "rewardedVisits",
              MAX(lt.visit_date) FILTER (WHERE lt.transaction_type = 'earn') AS "lastVisit",
              COUNT(*) OVER()::int AS "totalCount"
       FROM customers c LEFT JOIN loyalty_transactions lt ON lt.customer_id = c.id
       WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%')
       GROUP BY c.id ORDER BY balance DESC, "lastVisit" DESC NULLS LAST
       LIMIT $2 OFFSET $3`, [search, limit, offset]
    );
    res.json({ success: true, data: result.rows, total: result.rows[0]?.totalCount || 0 });
  } catch (error) { next(error); }
});

app.get('/api/v1/admin/loyalty/transactions', requireAdmin, async (req, res, next) => {
  try {
    const customerId = req.query.customerId || null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const result = await pool.query(
      `SELECT lt.id, lt.customer_id AS "customerId", c.name AS "customerName", c.phone,
              lt.transaction_type AS type, lt.points, lt.reason, lt.visit_date AS "visitDate",
              lt.created_at AS "createdAt", a.email AS "createdBy"
       FROM loyalty_transactions lt
       JOIN customers c ON c.id = lt.customer_id LEFT JOIN admins a ON a.id = lt.created_by
       WHERE ($1::uuid IS NULL OR lt.customer_id = $1::uuid)
       ORDER BY lt.created_at DESC LIMIT $2`, [customerId, limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/v1/admin/loyalty/members/:customerId/adjustments', requireAdmin, validate(adjustmentSchema), async (req, res, next) => {
  try {
    const { points, reason } = req.validatedBody;
    const result = await withTransaction(async client => {
      const customer = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [req.params.customerId]);
      if (!customer.rowCount) return null;
      const current = await client.query('SELECT COALESCE(SUM(points), 0)::int AS balance FROM loyalty_transactions WHERE customer_id = $1', [req.params.customerId]);
      if (current.rows[0].balance + points < 0) {
        const error = new Error('Adjustment would make the balance negative');
        error.status = 409;
        throw error;
      }
      const inserted = await client.query(
        `INSERT INTO loyalty_transactions(customer_id, transaction_type, points, reason, created_by)
         VALUES ($1, 'adjustment', $2, $3, $4) RETURNING id, points, reason, created_at AS "createdAt"`,
        [req.params.customerId, points, reason, req.admin.sub]
      );
      return { transaction: inserted.rows[0], balance: current.rows[0].balance + points };
    });
    if (!result) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.status(201).json({ success: true, ...result });
  } catch (error) { next(error); }
});

app.get('/api/v1/admin/surveys', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const result = await pool.query(
      `SELECT s.id, s.created_at AS timestamp, s.client_name AS "clientName", s.client_phone AS "clientPhone",
              s.visit_date AS "visitDate", s.client_type AS "clientType", s.services,
              s.service_ratings AS "serviceRatings", s.overall_rating AS "overallRating",
              s.staff_rating AS "staffRating", s.cleanliness_rating AS "cleanlinessRating",
              s.wait_time_rating AS "waitTimeRating", s.feedback_type AS "feedbackType",
              s.feedback_text AS "feedbackText", s.recommendation, s.improvements,
              s.employee_shoutout AS "employeeShoutout", s.how_did_you_hear AS "howDidYouHear",
              s.marketing_consent AS "marketingConsent"
       FROM surveys s ORDER BY s.created_at DESC LIMIT $1`, [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
});

app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));
app.use((error, req, res, _next) => {
  const requestId = req.id || crypto.randomUUID();
  req.log?.error({ err: error, requestId }, 'Request failed');
  if (error.message === 'Origin is not allowed') return res.status(403).json({ success: false, error: error.message });
  if (error.code === '22P02') return res.status(400).json({ success: false, error: 'Invalid identifier' });
  const status = error.status || 500;
  res.status(status).json({ success: false, error: status === 500 ? 'Internal server error' : error.message, requestId });
});

module.exports = app;
