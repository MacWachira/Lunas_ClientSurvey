const crypto = require('node:crypto');

const sourceUrl = process.env.LEGACY_GOOGLE_SCRIPT_URL;
const apiUrl = String(process.env.BACKEND_API_URL || '').replace(/\/$/, '');
if (!sourceUrl || !apiUrl) {
  console.error('Set LEGACY_GOOGLE_SCRIPT_URL and BACKEND_API_URL before running this importer.');
  process.exit(1);
}

function stableUuid(value) {
  const bytes = crypto.createHash('sha256').update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function rating(value) {
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 5 ? parsed : null;
}

function visitDate(value) {
  const raw = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

async function run() {
  const sourceResponse = await fetch(sourceUrl);
  if (!sourceResponse.ok) throw new Error(`Legacy endpoint returned ${sourceResponse.status}`);
  const source = await sourceResponse.json();
  if (!source.success || !Array.isArray(source.data)) throw new Error('Legacy endpoint returned an unexpected response');

  let imported = 0;
  let failed = 0;
  for (const [index, row] of source.data.entries()) {
    const date = visitDate(row.visitDate || row.timestamp);
    if (!date) {
      console.error(`Skipping row ${index + 1}: invalid visit date`);
      failed++;
      continue;
    }
    let serviceRatings = [];
    try { serviceRatings = Array.isArray(row.serviceRatings) ? row.serviceRatings : JSON.parse(row.serviceRatings || '[]'); } catch {}
    const payload = {
      idempotencyKey: stableUuid(`legacy:${row.timestamp || index}:${row.clientPhone || ''}`),
      clientName: row.clientName || '',
      clientPhone: row.clientPhone || '',
      visitDate: date,
      clientType: row.clientType === 'returning' ? 'returning' : 'new',
      services: String(row.services || '').split(',').map(value => value.trim()).filter(Boolean),
      serviceRatings,
      overallRating: rating(row.overallRating),
      staffRating: rating(row.staffRating),
      cleanlinessRating: rating(row.cleanlinessRating),
      waitTimeRating: rating(row.waitTimeRating),
      feedbackType: ['compliment', 'suggestion', 'complaint'].includes(row.feedbackType) ? row.feedbackType : 'other',
      feedbackText: row.feedbackText || '',
      recommendation: row.recommendation || '',
      improvements: row.improvements || '',
      employeeShoutout: row.employeeShoutout || '',
      howDidYouHear: row.howDidYouHear || '',
      marketingConsent: row.marketingConsent === 'Yes' || row.marketingConsent === true
    };
    const response = await fetch(`${apiUrl}/api/v1/surveys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (response.ok) imported++;
    else {
      console.error(`Row ${index + 1} failed (${response.status}): ${await response.text()}`);
      failed++;
    }
  }
  console.log(`Legacy import complete: ${imported} accepted, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exit(1); });
