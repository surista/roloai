import { expect, it } from 'vitest';
import { mailtoUrl, mapsUrl, qrUrlDraft, smsUrl, telUrl, websiteUrl, displayName } from './links';

it('builds dialable tel links from printed numbers', () => {
  expect(telUrl('+81 (0)3-1234-5678')).toBe('tel:+81312345678');
  expect(telUrl('(555) 123-4567 ext 12')).toBe('tel:5551234567,12');
  expect(telUrl('555.123.4567 x9')).toBe('tel:5551234567,9');
  expect(telUrl('n/a')).toBeUndefined();
});

it('drops extensions from sms links', () => {
  expect(smsUrl('(555) 123-4567 ext 12')).toBe('sms:5551234567');
});

it('validates email addresses', () => {
  expect(mailtoUrl(' ann@acme.com ')).toBe('mailto:ann@acme.com');
  expect(mailtoUrl('ann at acme')).toBeUndefined();
});

it('adds a scheme to bare websites', () => {
  expect(websiteUrl('www.acme.com')).toBe('https://www.acme.com');
  expect(websiteUrl('http://acme.com')).toBe('http://acme.com');
  expect(websiteUrl('acme')).toBeUndefined();
  expect(websiteUrl('two words.com')).toBeUndefined();
});

it('encodes map queries', () => {
  expect(mapsUrl('1 Main St, Tokyo')).toBe('https://maps.apple.com/?q=1%20Main%20St%2C%20Tokyo');
  expect(mapsUrl('  ')).toBeUndefined();
});

it('treats a bare link QR as a website', () => {
  expect(qrUrlDraft('https://acme.com/ann')).toEqual({ website: 'https://acme.com/ann' });
  expect(qrUrlDraft('BEGIN:VCARD')).toBeUndefined();
});

it('names unnamed cards', () => {
  expect(displayName({ firstName: '', lastName: '' })).toBe('Unnamed card');
  expect(displayName({ firstName: 'Ann', lastName: 'Lee' })).toBe('Ann Lee');
});
