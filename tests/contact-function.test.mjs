import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTACT_RATE_LIMIT,
  ContactRequestError,
  contactRateLimitId,
  createContactHandler,
  createFirestoreRateLimiter,
  formatInquiryText,
  validateContactInquiry,
} from '../functions/src/contactHandler.js';

const validData = {
  fullName: 'Test Contact',
  company: 'Sample Organization',
  email: 'contact@example.invalid',
  phone: '+94 77 123 4567',
  service: 'Industrial Electrical Installations',
  location: 'Sample location',
  urgency: 'Planning Stage',
  message: 'Sample request for local testing.',
  consent: true,
  website: '',
};

test('validates and normalizes allowed contact fields', () => {
  assert.deepEqual(validateContactInquiry({ ...validData, email: '  USER@example.invalid ' }), {
    fullName: 'Test Contact',
    company: 'Sample Organization',
    email: 'user@example.invalid',
    phone: '+94 77 123 4567',
    service: 'Industrial Electrical Installations',
    location: 'Sample location',
    urgency: 'Planning Stage',
    message: 'Sample request for local testing.',
  });
});

test('rejects malformed, oversized, unapproved, and non-consented submissions', () => {
  const invalid = [
    { ...validData, message: '' },
    { ...validData, message: 'x'.repeat(4_001) },
    { ...validData, email: 'not-an-email' },
    { ...validData, service: 'Unlisted service' },
    { ...validData, urgency: 'Whenever' },
    { ...validData, consent: false },
    { ...validData, website: 'bot-filled-field' },
    { ...validData, fullName: 'bad\u0000name' },
  ];
  for (const data of invalid) {
    assert.throws(() => validateContactInquiry(data), ContactRequestError);
  }
});

test('rate-limit identifiers are keyed, deterministic, and do not reveal raw addresses', () => {
  const first = contactRateLimitId('203.0.113.4', 'a'.repeat(48));
  assert.equal(first, contactRateLimitId('203.0.113.4', 'a'.repeat(48)));
  assert.notEqual(first, contactRateLimitId('203.0.113.5', 'a'.repeat(48)));
  assert.notEqual(first, contactRateLimitId('203.0.113.4', 'b'.repeat(48)));
  assert.equal(first.includes('203.0.113.4'), false);
  assert.throws(() => contactRateLimitId('203.0.113.4', 'short'), ContactRequestError);
});

test('accepts at the server boundary only after rate limiting and mail delivery', async () => {
  const calls = [];
  const handler = createContactHandler({
    consumeRateLimit: async (...args) => calls.push(['limit', ...args]),
    sendMail: async (inquiry) => calls.push(['mail', inquiry.email]),
    rateLimitSalt: 's'.repeat(48),
    now: () => 1_000,
  });
  assert.deepEqual(await handler({
    data: validData,
    rawRequest: { ip: '203.0.113.8' },
  }), { accepted: true });
  assert.deepEqual(calls.map(([name]) => name), ['limit', 'mail']);
  assert.equal(calls[0][2], 1_000);
});

test('does not send mail when the rate limiter rejects the request', async () => {
  let sent = false;
  const handler = createContactHandler({
    consumeRateLimit: async () => {
      throw new ContactRequestError('resource-exhausted', 'Rate limit reached.');
    },
    sendMail: async () => { sent = true; },
    rateLimitSalt: 's'.repeat(48),
  });
  await assert.rejects(
    handler({ data: validData, rawRequest: { ip: '203.0.113.8' } }),
    (error) => error instanceof ContactRequestError && error.code === 'resource-exhausted',
  );
  assert.equal(sent, false);
});

test('mail delivery failures reject rather than return an accepted response', async () => {
  const handler = createContactHandler({
    consumeRateLimit: async () => {},
    sendMail: async () => { throw new Error('SMTP credentials must not reach the caller.'); },
    rateLimitSalt: 's'.repeat(48),
  });
  await assert.rejects(
    handler({ data: validData, rawRequest: { ip: '203.0.113.8' } }),
    /SMTP credentials must not reach the caller/,
  );
});

test('mail content is plain text and contains no requester-controlled headers', () => {
  const inquiry = validateContactInquiry(validData);
  const text = formatInquiryText(inquiry);
  assert.match(text, /Name: Test Contact/);
  assert.match(text, /contact@example\.invalid/);
  assert.equal(text.includes('<script>'), false);
  assert.equal(CONTACT_RATE_LIMIT.maximum, 5);
  assert.equal(CONTACT_RATE_LIMIT.windowMilliseconds, 15 * 60 * 1000);
});

test('Firestore rate limiting rejects the sixth request and permits a new window', async () => {
  const records = new Map();
  const firestore = {
    collection: (name) => ({
      doc: (id) => ({
        path: `${name}/${id}`,
        get value() { return records.get(this.path); },
      }),
    }),
    runTransaction: async (callback) => callback({
      get: async (reference) => ({
        exists: records.has(reference.path),
        data: () => records.get(reference.path),
      }),
      set: (reference, value) => records.set(reference.path, value),
    }),
  };
  const consume = createFirestoreRateLimiter(firestore);
  const key = 'a'.repeat(64);
  for (let index = 0; index < CONTACT_RATE_LIMIT.maximum; index += 1) {
    await consume(key, 10_000);
  }
  await assert.rejects(
    consume(key, 10_000),
    (error) => error instanceof ContactRequestError && error.code === 'resource-exhausted',
  );
  assert.equal(
    records.get(`contactRateLimits/${key}`).expireAt.getTime(),
    10_000 + CONTACT_RATE_LIMIT.retentionMilliseconds,
  );
  await consume(key, 10_000 + CONTACT_RATE_LIMIT.windowMilliseconds);
  assert.equal(records.get(`contactRateLimits/${key}`).count, 1);
});
