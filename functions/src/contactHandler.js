import { createHmac } from 'node:crypto';

export const CONTACT_RATE_LIMIT = Object.freeze({
  maximum: 5,
  windowMilliseconds: 15 * 60 * 1000,
  retentionMilliseconds: 24 * 60 * 60 * 1000,
});

const services = new Set([
  'Residential & Commercial Electrical Wiring',
  'Industrial Electrical Installations',
  'MDB / SMDB Panel Installation',
  'Cable Tray Installation & Cable Laying',
  'Testing & Commissioning',
  'Electrical Maintenance & Troubleshooting',
  'All Kinds of ELV Solutions',
  'Lightning Protection System (LPS)',
  'General Engineering Inquiry',
]);

const urgencies = new Set([
  'Immediate',
  'Within 1 Month',
  '1-3 Months',
  'Planning Stage',
]);

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export class ContactRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContactRequestError';
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value, maximum, required = false) {
  if (typeof value !== 'string') {
    if (required) throw new ContactRequestError('invalid-argument', 'Check the required inquiry fields.');
    return '';
  }
  const normalized = value.trim();
  if (normalized.length > maximum || (required && normalized.length === 0)) {
    throw new ContactRequestError('invalid-argument', 'Check the required inquiry fields.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new ContactRequestError('invalid-argument', 'Check the required inquiry fields.');
  }
  return normalized;
}

export function validateContactInquiry(value) {
  if (!isRecord(value)) {
    throw new ContactRequestError('invalid-argument', 'Check the required inquiry fields.');
  }
  if (field(value.website, 200) !== '') {
    throw new ContactRequestError('invalid-argument', 'The inquiry could not be accepted.');
  }
  if (value.consent !== true) {
    throw new ContactRequestError('invalid-argument', 'Consent is required to send this inquiry.');
  }

  const inquiry = {
    fullName: field(value.fullName, 120, true),
    company: field(value.company, 160),
    email: field(value.email, 254, true).toLowerCase(),
    phone: field(value.phone, 40, true),
    service: field(value.service, 100, true),
    location: field(value.location, 160, true),
    urgency: field(value.urgency, 40),
    message: field(value.message, 4_000, true),
  };

  if (!emailPattern.test(inquiry.email) || !services.has(inquiry.service) ||
      (inquiry.urgency && !urgencies.has(inquiry.urgency)) ||
      !/^[+()\d][+()\d .-]{4,39}$/.test(inquiry.phone)) {
    throw new ContactRequestError('invalid-argument', 'Check the required inquiry fields.');
  }
  return inquiry;
}

export function contactRateLimitId(ipAddress, salt) {
  if (typeof ipAddress !== 'string' || ipAddress.length < 2 || ipAddress.length > 128 ||
      typeof salt !== 'string' || salt.length < 32) {
    throw new ContactRequestError('internal', 'The inquiry service is not configured.');
  }
  return createHmac('sha256', salt).update(ipAddress).digest('hex');
}

export function createContactHandler({ consumeRateLimit, sendMail, rateLimitSalt, now = Date.now }) {
  if (typeof consumeRateLimit !== 'function' || typeof sendMail !== 'function') {
    throw new TypeError('Contact handler dependencies are required.');
  }

  return async function handleContactInquiry(request) {
    const inquiry = validateContactInquiry(request?.data);
    const ipAddress = request?.rawRequest?.ip;
    const rateLimitId = contactRateLimitId(ipAddress, rateLimitSalt);
    await consumeRateLimit(rateLimitId, now());
    await sendMail(inquiry);
    return { accepted: true };
  };
}

export function createFirestoreRateLimiter(firestore) {
  return async function consumeRateLimit(id, nowMilliseconds) {
    const reference = firestore.collection('contactRateLimits').doc(id);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const record = snapshot.exists ? snapshot.data() : undefined;
      const windowStart = Number(record?.windowStart);
      const count = Number(record?.count);
      const inWindow = Number.isSafeInteger(windowStart) &&
        nowMilliseconds - windowStart >= 0 &&
        nowMilliseconds - windowStart < CONTACT_RATE_LIMIT.windowMilliseconds;

      if (inWindow && Number.isSafeInteger(count) && count >= CONTACT_RATE_LIMIT.maximum) {
        throw new ContactRequestError(
          'resource-exhausted',
          'Too many inquiries were sent from this connection. Please wait before trying again.',
        );
      }

      const nextCount = inWindow && Number.isSafeInteger(count) ? count + 1 : 1;
      const nextWindowStart = inWindow ? windowStart : nowMilliseconds;
      transaction.set(reference, {
        count: nextCount,
        windowStart: nextWindowStart,
        expireAt: new Date(nowMilliseconds + CONTACT_RATE_LIMIT.retentionMilliseconds),
      });
    });
  };
}

export function formatInquiryText(inquiry) {
  return [
    'New website inquiry',
    '',
    `Name: ${inquiry.fullName}`,
    `Company / organization: ${inquiry.company || 'Not provided'}`,
    `Email: ${inquiry.email}`,
    `Phone: ${inquiry.phone}`,
    `Service: ${inquiry.service}`,
    `Project location: ${inquiry.location}`,
    `Timeline: ${inquiry.urgency || 'Not provided'}`,
    '',
    'Project scope / technical details:',
    inquiry.message,
  ].join('\n');
}
