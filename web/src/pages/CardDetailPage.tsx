import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  cardFromFirestore,
  cardImageUrls,
  cardToVCard,
  findDuplicates,
  pairCandidates,
  partnerOf,
  type Card,
} from '@roloai/shared';
import { db } from '../lib/firebase';
import { deleteCard, linkCards, subscribeToCards, unlinkCards, updateCard } from '../lib/cards';
import { downloadFile } from '../lib/backup';
import CardForm from '../components/CardForm';

const displayName = (card: Card): string => `${card.firstName} ${card.lastName}`.trim();

/**
 * Hands one card to the OS share sheet as a .vcf file where the browser can, and falls back to
 * a plain download where it can't (desktop Chrome/Firefox have no file sharing).
 */
async function shareCard(card: Card): Promise<void> {
  const fileName = `${displayName(card).replace(/[\\/:*?"<>|\s]+/g, '-') || 'contact'}.vcf`;
  const vcf = cardToVCard(card);
  const file = new File([vcf], fileName, { type: 'text/vcard' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: displayName(card) });
    } catch (e) {
      // Dismissing the share sheet rejects with AbortError; that is not a failure.
      if ((e as Error).name !== 'AbortError') throw e;
    }
    return;
  }
  downloadFile(fileName, vcf, 'text/vcard');
}

export default function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  // The whole library, for duplicate checks and pairing — the single-document listener above
  // only ever sees this card.
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) return;
    return onSnapshot(doc(db, 'cards', cardId), (snap) => {
      if (!snap.exists()) {
        setCard(null);
        return;
      }
      setCard(cardFromFirestore(snap.id, snap.data()));
    });
  }, [cardId]);

  useEffect(() => subscribeToCards(setCards), []);

  const partner = useMemo(
    () => (card ? partnerOf(card, new Map(cards.map((c) => [c.id, c]))) : undefined),
    [card, cards]
  );
  const candidates = useMemo(() => (card ? pairCandidates(card, cards) : []), [card, cards]);

  if (card === undefined) return <p className="empty">Loading…</p>;
  if (card === null) return <p className="empty">Card not found.</p>;

  const handleDelete = async () => {
    if (!cardId) return;
    if (!confirm(`Delete ${card.firstName} ${card.lastName}?`)) return;
    await deleteCard(cardId, cardImageUrls(card), partner?.id);
    navigate('/');
  };

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      console.error('Card action failed:', e);
      setError('That did not work. Check your connection and try again.');
    }
  };

  return (
    <div className="card-detail-page">
      <div className="detail-actions">
        <button className="link-button" onClick={() => navigate('/')}>
          ← Back
        </button>
        <button className="link-button" onClick={() => void run(() => shareCard(card))}>
          Share
        </button>
      </div>

      {partner && (
        <div className="pair-notice">
          <span>
            Also on file: <Link to={`/cards/${partner.id}`}>{displayName(partner)}</Link>
          </span>
          <button
            className="link-button"
            onClick={() => void run(() => unlinkCards(card.id, partner.id))}
          >
            Unlink
          </button>
        </div>
      )}
      {candidates.map((candidate) => (
        <div className="pair-notice" key={candidate.id}>
          <span>This looks like the same person: {displayName(candidate)} —</span>
          <button
            className="link-button"
            onClick={() => void run(() => linkCards(card.id, candidate.id))}
          >
            Link cards
          </button>
        </div>
      ))}
      {error && <p className="error">{error}</p>}

      <CardForm
        draft={card}
        imageUrl={card.imageUrl || undefined}
        backImageUrl={card.imageBackUrl || undefined}
        saveLabel="Save Changes"
        onSave={async (fields) => {
          const duplicates = findDuplicates(fields, cards, cardId);
          if (
            duplicates.length &&
            !confirm(
              `This looks like a duplicate of ${duplicates.map((d) => displayName(d.card)).join(', ')}. Save anyway?`
            )
          ) {
            return;
          }
          await updateCard(cardId!, fields);
        }}
        extraAction={{ label: 'Delete Card', onClick: handleDelete, destructive: true }}
      />
    </div>
  );
}
