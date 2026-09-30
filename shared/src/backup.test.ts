import { describe, expect, it } from 'vitest';
import { BackupFormatError, backupFileName, cardsToBackup, parseBackup } from './backup';
import { card } from './testCards';

describe('backup', () => {
  it('round-trips cards', () => {
    const cards = [card({ firstName: 'Ann' })];
    expect(parseBackup(cardsToBackup(cards, new Date('2026-01-02T03:04:05Z')))).toEqual(cards);
  });

  it.each([
    ['not json', /not valid JSON/],
    ['{"app":"other","cards":[]}', /does not look like/],
    ['{"app":"roloai","version":99,"cards":[]}', /newer version/],
    ['{"app":"roloai","version":1,"cards":[{"firstName":"x"}]}', /missing its id/],
  ])('rejects %s', (text, message) => {
    expect(() => parseBackup(text)).toThrow(BackupFormatError);
    expect(() => parseBackup(text)).toThrow(message);
  });

  it('names files by date', () => {
    expect(backupFileName(new Date('2026-01-02T03:04:05Z'))).toBe('roloai-backup-2026-01-02.json');
  });
});
