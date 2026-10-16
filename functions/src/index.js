import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';
import {
  ContactRequestError,
  createContactHandler,
  createFirestoreRateLimiter,
  formatInquiryText,
} from './contactHandler.js';

initializeApp({ credential: applicationDefault() });

const smtpUsername = defineSecret('CONTACT_SMTP_USER');
const smtpPassword = defineSecret('CONTACT_SMTP_PASSWORD');
const rateLimitSalt = defineSecret('CONTACT_RATE_LIMIT_SALT');

function configuredAddress(value, name) {
  if (typeof value !== 'string' || value.length > 254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) {
    throw new Error(`${name} must be configured as a valid email address.`);
  }
  return value;
}

function createMailer() {
  const host = process.env.CONTACT_SMTP_HOST;
  const port = Number(process.env.CONTACT_SMTP_PORT);
  const secureValue = process.env.CONTACT_SMTP_SECURE;
  const user = smtpUsername.value();
  const pass = smtpPassword.value();
  if (!host || /[\r\n]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !['true', 'false'].includes(secureValue) || !user || !pass) {
    throw new Error('Contact SMTP settings are incomplete.');
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: secureValue === 'true',
    auth: { user, pass },
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });
  return {
    from: configuredAddress(process.env.CONTACT_SENDER, 'CONTACT_SENDER'),
    to: configuredAddress(process.env.CONTACT_RECIPIENT, 'CONTACT_RECIPIENT'),
    transport,
  };
}

export const submitContactInquiry = onCall({
  region: 'asia-south1',
  enforceAppCheck: true,
  maxInstances: 5,
  secrets: [smtpUsername, smtpPassword, rateLimitSalt],
}, async (request) => {
  try {
    const handler = createContactHandler({
      consumeRateLimit: createFirestoreRateLimiter(getFirestore()),
      rateLimitSalt: rateLimitSalt.value(),
      sendMail: async (inquiry) => {
        const { from, to, transport } = createMailer();
        await transport.sendMail({
          from,
          to,
          replyTo: inquiry.email,
          subject: 'New engineering website inquiry',
          text: formatInquiryText(inquiry),
        });
      },
    });
    return await handler(request);
  } catch (error) {
    if (error instanceof ContactRequestError) {
      throw new HttpsError(error.code, error.message);
    }
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'unknown';
    logger.error('Contact inquiry delivery failed.', { code });
    throw new HttpsError(
      'unavailable',
      'Your inquiry could not be sent. Please try again later.',
    );
  }
});
