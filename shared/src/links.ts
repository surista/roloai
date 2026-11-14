import type { Card, CardDraft } from './index';

/**
 * URLs for acting on a card's details: calling, messaging, mailing, mapping, browsing. Shared so
 * the phone and the web build the same links from the same (often messy, OCR-sourced) values.
 */

/** "Ann Lee", or a placeholder for a card with no name. */
export function displayName(card: Pick<Card, 'firstName' | 'lastName'>): string {
  return `${card.firstName} ${card.lastName}`.trim() || 'Unnamed card';
}

/**
 * Keeps what a dialler understands: digits, a leading +, and the pause/wait/extension marks.
 * Cards print numbers as "+81 (0)3-1234-5678" or "555.123.4567 ext 12"; the "(0)" trunk prefix
 * must go when an international prefix is present, or the number dials wrong from abroad.
 */
function dialable(number: string): string {
  let n = number.trim();
  if (n.startsWith('+')) n = n.replace(/\(0\)/g, '');
  n = n.replace(/\s*(?:ext\.?|x)\s*(\d+)\s*$/i, ',$1');
  const plus = n.startsWith('+') ? '+' : '';
  return plus + n.replace(/[^\d,;*#]/g, '');
}

export function telUrl(number: string): string | undefined {
  const n = dialable(number);
  return /\d/.test(n) ? `tel:${n}` : undefined;
}

export function smsUrl(number: string): string | undefined {
  // Messages has no use for an extension.
  const n = dialable(number).split(/[,;]/)[0];
  return /\d/.test(n) ? `sms:${n}` : undefined;
}

export function mailtoUrl(address: string): string | undefined {
  const a = address.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a) ? `mailto:${a}` : undefined;
}

/** Cards print "www.acme.com" or "acme.com/jp"; a browser needs a scheme. */
export function websiteUrl(site: string): string | undefined {
  const s = site.trim();
  if (!s || /\s/.test(s)) return undefined;
  if (/^https?:\/\//i.test(s)) return s;
  return /\.[a-z]{2,}/i.test(s) ? `https://${s}` : undefined;
}

/** Apple Maps on Apple platforms; every other browser redirects it to a web map. */
export function mapsUrl(address: string): string | undefined {
  const a = address.trim();
  return a ? `https://maps.apple.com/?q=${encodeURIComponent(a)}` : undefined;
}

/**
 * A QR code that is just a link — common on cards, usually pointing at a profile page — belongs
 * in Website, not dumped into Notes as unparseable text. Returns undefined for anything else.
 */
export function qrUrlDraft(data: string): Partial<CardDraft> | undefined {
  const s = data.trim();
  if (!/^https?:\/\/\S+$/i.test(s)) return undefined;
  return { website: s };
}
