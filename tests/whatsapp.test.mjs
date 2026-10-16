import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseWhatsAppNumber } from '../src/lib/whatsapp.ts';

test('builds a wa.me link and international display number for valid digits', () => {
  assert.deepEqual(parseWhatsAppNumber('94771234567'), {
    status: 'ready',
    number: '94771234567',
    displayNumber: '+94771234567',
    href: 'https://wa.me/94771234567',
  });
});

test('leaves the WhatsApp action unconfigured when the number is blank', () => {
  assert.deepEqual(parseWhatsAppNumber('  '), { status: 'missing' });
});

test('rejects numbers that are not digits-only international numbers', () => {
  for (const value of ['+94771234567', '9477 123 4567', '012345678', '1234567', '1234567890123456', null]) {
    assert.deepEqual(parseWhatsAppNumber(value), { status: 'invalid' });
  }
});
