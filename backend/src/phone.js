function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) digits = `254${digits.slice(1)}`;
  if (digits.startsWith('7') && digits.length === 9) digits = `254${digits}`;
  return /^254\d{9}$/.test(digits) ? digits : '';
}

module.exports = { normalizePhone };
