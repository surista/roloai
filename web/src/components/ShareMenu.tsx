import { useEffect, useRef, useState } from 'react';
import type { Card } from '@roloai/shared';
import { outcomeMessage, shareCard, shareOptions, type ShareKind } from '../lib/shareCardImages';

interface Props {
  card: Card;
  label?: string;
  /** 'button' is the prominent variant used on My Card; 'link' matches the detail page header. */
  variant?: 'link' | 'button';
}

/** A Share button that opens a small menu of what to share: contact, photos, or both photos. */
export default function ShareMenu({ card, label = 'Share', variant = 'link' }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Close on an outside click so the menu doesn't linger over the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = async (kind: ShareKind) => {
    setOpen(false);
    setMessage(null);
    setBusy(true);
    try {
      const text = outcomeMessage(await shareCard(card, kind));
      if (text) setMessage({ text, error: false });
    } catch (e) {
      console.error('Share failed:', e);
      setMessage({ text: 'Sharing did not work. Check your connection and try again.', error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-menu" ref={root}>
      <button
        className={variant === 'button' ? 'primary-button' : 'link-button'}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {busy ? 'Preparing…' : label}
      </button>
      {open && (
        <div className="share-menu-list" role="menu">
          {shareOptions(card).map(({ kind, label: optionLabel }) => (
            <button key={kind} role="menuitem" onClick={() => void choose(kind)}>
              {optionLabel}
            </button>
          ))}
        </div>
      )}
      {message && <p className={message.error ? 'error share-menu-note' : 'share-menu-note'}>{message.text}</p>}
    </div>
  );
}
