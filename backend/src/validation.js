const { z } = require('zod');

const optionalText = max => z.string().trim().max(max).optional().default('');
const rating = z.coerce.number().int().min(1).max(5).optional().nullable();

const surveySchema = z.object({
  idempotencyKey: z.string().uuid(),
  clientName: optionalText(120),
  clientPhone: optionalText(30),
  visitDate: z.iso.date(),
  clientType: z.enum(['new', 'returning']),
  services: z.union([z.array(z.string().trim().min(1).max(100)).max(30), z.string().max(2000)]),
  serviceRatings: z.union([z.array(z.object({
    service: z.string().trim().min(1).max(100),
    section: optionalText(50),
    rating: z.coerce.number().int().min(0).max(5),
    comment: optionalText(500)
  })).max(30), z.string().max(15_000)]).optional().default([]),
  overallRating: rating,
  staffRating: rating,
  cleanlinessRating: rating,
  waitTimeRating: rating,
  feedbackType: z.enum(['compliment', 'suggestion', 'complaint', 'other']).optional().default('other'),
  feedbackText: optionalText(3000),
  recommendation: optionalText(100),
  improvements: optionalText(3000),
  employeeShoutout: optionalText(1000),
  howDidYouHear: optionalText(200),
  marketingConsent: z.union([z.boolean(), z.enum(['Yes', 'No'])]).optional().default(false)
}).strict();

const loginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) }).strict();
const adjustmentSchema = z.object({
  points: z.coerce.number().int().min(-100_000).max(100_000).refine(value => value !== 0, 'Points cannot be zero'),
  reason: z.string().trim().min(3).max(500)
}).strict();

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ success: false, error: 'Validation failed', details: parsed.error.flatten() });
    }
    req.validatedBody = parsed.data;
    next();
  };
}

module.exports = { surveySchema, loginSchema, adjustmentSchema, validate };
