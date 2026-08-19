import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { cardsToVCard, parseVCards, type Card, type CardDraft } from '@roloai/shared';
import { importCards, restoreCards, subscribeToCards } from '../lib/cards';
import {
  BackupFormatError,
  backupFileName,
  cardsToBackup,
  downloadFile,
  parseBackup,
  vCardFileName,
} from '../lib/backup';

/**
 * What a chosen file turned out to contain, held until the user confirms.
 *
 * Import is the one destructive thing this app can do in bulk — a restore overwrites by id — so
 * picking a file only ever parses it. Nothing is written until the count has been shown.
 */
type Pending =
  | { kind: 'restore'; fileName: string; cards: Card[] }
  | { kind: 'vcard'; fileName: string; drafts: CardDraft[] };

export default function SettingsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeToCards(setCards), []);

  const handleExport = (format: 'json' | 'vcf') => {
    const now = new Date();
    setError(null);
    setNotice(null);
    if (format === 'json') {
      downloadFile(backupFileName(now), cardsToBackup(cards, now), 'application/json');
    } else {
      downloadFile(vCardFileName(now), cardsToVCard(cards), 'text/vcard');
    }
  };

  const handleFileChosen = async (file: File | undefined) => {
    setError(null);
    setNotice(null);
    setPending(null);
    if (!file) return;
    const text = await file.text();
    try {
      if (file.name.toLowerCase().endsWith('.vcf')) {
        const drafts = parseVCards(text);
        if (!drafts.length) throw new BackupFormatError('No contacts found in that file.');
        setPending({ kind: 'vcard', fileName: file.name, drafts });
      } else {
        setPending({ kind: 'restore', fileName: file.name, cards: parseBackup(text) });
      }
    } catch (e) {
      setError(
        e instanceof BackupFormatError ? e.message : 'Could not read that file.'
      );
    }
  };

  const handleConfirmImport = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError(null);
    try {
      const count =
        pending.kind === 'restore'
          ? await restoreCards(pending.cards)
          : await importCards(pending.drafts);
      setNotice(
        pending.kind === 'restore'
          ? `Restored ${count} ${count === 1 ? 'card' : 'cards'}.`
          : `Imported ${count} ${count === 1 ? 'contact' : 'contacts'}.`
      );
      setPending(null);
    } catch (e) {
      console.error('Import failed:', e);
      setError('Import failed. Check your connection and try again.');
    } finally {
      setBusy(false);
      // The input keeps its value, so re-picking the same file after a failure would not fire
      // a change event at all.
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleCancelImport = () => {
    setPending(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1>Settings</h1>
        <Link className="link-button" to="/">
          Back to cards
        </Link>
      </header>

      <section className="settings-section">
        <h2>Export</h2>
        <p className="settings-hint">
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}. Exports carry links to the card
          photos rather than the images themselves, so they resolve only while you are signed in.
        </p>
        <div className="settings-actions">
          <button
            className="primary-button"
            onClick={() => handleExport('json')}
            disabled={!cards.length}
          >
            Download backup (.json)
          </button>
          <button
            className="primary-button"
            onClick={() => handleExport('vcf')}
            disabled={!cards.length}
          >
            Download contacts (.vcf)
          </button>
        </div>
        <p className="settings-hint">
          The backup restores everything exactly, including tags and ids. The vCard opens in
          Contacts and most CRMs, but carries no tags or ids.
        </p>
      </section>

      <section className="settings-section">
        <h2>Import</h2>
        <p className="settings-hint">
          A <code>.json</code> backup restores cards under their original ids, overwriting any
          card of the same id. A <code>.vcf</code> file always adds new cards.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".json,.vcf,application/json,text/vcard"
          onChange={(e) => void handleFileChosen(e.target.files?.[0])}
        />

        {pending && (
          <div className="confirm-box">
            <p>
              {pending.kind === 'restore' ? (
                <>
                  <strong>{pending.cards.length}</strong>{' '}
                  {pending.cards.length === 1 ? 'card' : 'cards'} in {pending.fileName}. Restoring
                  overwrites any card that shares an id with one in the file.
                </>
              ) : (
                <>
                  <strong>{pending.drafts.length}</strong>{' '}
                  {pending.drafts.length === 1 ? 'contact' : 'contacts'} in {pending.fileName}.
                  These are added as new cards.
                </>
              )}
            </p>
            <div className="settings-actions">
              <button className="primary-button" onClick={handleConfirmImport} disabled={busy}>
                {busy ? 'Importing…' : pending.kind === 'restore' ? 'Restore' : 'Import'}
              </button>
              <button className="link-button" onClick={handleCancelImport} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
    </div>
  );
}
