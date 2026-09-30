import { expect, it } from 'vitest';
import { relabelPhones, sortCards, stripUndefined } from './index';
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
