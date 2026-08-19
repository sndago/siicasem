const logger = require('../config/logger');

let client = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

/* Convert a local 0XXXXXXXXX number to E.164 using SMS_COUNTRY_CODE (default +233 — Ghana) */
const toE164 = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const countryCode = process.env.SMS_COUNTRY_CODE || '+233';
  return digits.startsWith('0') ? `${countryCode}${digits.slice(1)}` : `+${digits}`;
};

/**
 * Send an SMS notification. Never throws — failures are logged, not surfaced,
 * so a Twilio outage can never block a transaction from posting.
 * @param {string} toPhone - Client's local phone number (e.g. 0553676107)
 * @param {string} body    - Message text
 */
const sendSms = async (toPhone, body) => {
  if (process.env.SMS_NOTIFICATIONS_ENABLED !== 'true') return;
  if (!client) {
    logger.warn('SMS notification skipped — Twilio is not configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing).');
    return;
  }

  const to = toE164(toPhone);
  if (!to) return;

  try {
    await client.messages.create({
      to,
      body,
      from: process.env.TWILIO_MESSAGING_SERVICE_SID ? undefined : process.env.TWILIO_FROM_NUMBER,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
    });
  } catch (err) {
    logger.error('SMS send failed', err.message);
  }
};

module.exports = { sendSms, toE164 };
