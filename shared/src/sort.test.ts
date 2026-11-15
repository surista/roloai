import { expect, it } from 'vitest';
import { relabelPhones, sortCards, sortText, stripUndefined } from './index';
import { card } from './testCards';

it('sorts by company with blanks last and ties by name', () => {
  const a = card({ firstName: 'Zed', company: 'acme' });
  const b = card({ firstName: 'Amy', company: 'Acme' });
  const none = card({ firstName: 'Bob' });
  expect(sortCards([none, a, b], 'company').map((c) => c.firstName)).toEqual(['Amy', 'Zed', 'Bob']);
});

it('relabels edited phones by value, keeping each duplicate its own label', () => {
  const prev = [{ label: 'mobile', number: '1' }, { label: 'fax', number: '2' }];
  expect(relabelPhones(['2', '3', '1'], prev)).toEqual([
    { label: 'fax', number: '2' },
    { label: 'work', number: '3' },
    { label: 'mobile', number: '1' },
  ]);
});

it('strips undefined but keeps empty strings', () => {
  expect(stripUndefined({ a: undefined, b: '', c: 0 })).toEqual({ b: '', c: 0 });
});

it('files a card with only a first name under it in a last-name sort', () => {
  const only = card({ firstName: 'Maria', lastName: '' });
  const lee = card({ firstName: 'Ann', lastName: 'Lee' });
  const zed = card({ firstName: 'Bo', lastName: 'Zed' });
  expect(sortCards([zed, only, lee], 'lastName').map((c) => c.firstName)).toEqual(['Ann', 'Maria', 'Bo']);
  expect(sortText(only, 'lastName')).toBe('Maria');
});

it('keeps unnamed cards last in a name sort, whatever their company', () => {
  const unnamed = card({ firstName: '', lastName: '', company: 'Acme' });
  const zed = card({ firstName: 'Bo', lastName: 'Zed' });
  expect(sortCards([unnamed, zed], 'lastName')).toEqual([zed, unnamed]);
  expect(sortText(unnamed, 'lastName')).toBe('');
});
