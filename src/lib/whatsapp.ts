export type WhatsAppContact =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'ready'; number: string; displayNumber: string; href: string };

export function parseWhatsAppNumber(value: unknown): WhatsAppContact {
  if (value === undefined || value === '') {
    return { status: 'missing' };
  }
  if (typeof value !== 'string') return { status: 'invalid' };

  const number = value.trim();
  if (number === '') return { status: 'missing' };
  if (!/^[1-9]\d{7,14}$/.test(number)) {
    return { status: 'invalid' };
  }

  return {
    status: 'ready',
    number,
    displayNumber: `+${number}`,
    href: `https://wa.me/${number}`,
  };
}
