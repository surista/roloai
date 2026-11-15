import { expect, it } from 'vitest';
import { parseQrPayload } from './parseCard';

it('reads a vCard QR', () => {
  const d = parseQrPayload('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lee;Ann;;;\r\nFN:Ann Lee\r\nORG:Acme\r\nTEL;TYPE=CELL:+1 555 0100\r\nEMAIL:ann@acme.com\r\nEND:VCARD');
  expect(d).toMatchObject({ firstName: 'Ann', lastName: 'Lee', company: 'Acme', source: 'qr' });
  expect(d.emails[0]?.address).toBe('ann@acme.com');
});

it('tolerates leading whitespace and lowercase headers', () => {
  expect(parseQrPayload('\n begin:vcard\nN:Lee;Ann\nend:vcard').firstName).toBe('Ann');
  expect(parseQrPayload(' mecard:N:Lee,Ann;;').firstName).toBe('Ann');
});

it('reads a MECARD with escaped separators', () => {
  const d = parseQrPayload('MECARD:N:Okafor,Ben;ORG:Nimbus\\; Inc.;TEL:+81-90-1234;EMAIL:ben@nimbus.io;URL:https://nimbus.io;ADR:1-2-3 Shibuya\\, Tokyo;;');
  expect(d).toMatchObject({ firstName: 'Ben', lastName: 'Okafor', company: 'Nimbus; Inc.', website: 'https://nimbus.io', address: '1-2-3 Shibuya, Tokyo' });
  expect(d.phones[0]?.number).toBe('+81-90-1234');
});

it('keeps an unknown payload in notes', () => {
  expect(parseQrPayload('hello').notes).toBe('hello');
});
