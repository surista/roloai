import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  cardFromFirestore,
  cardImageUrls,
  findDuplicates,
  pairCandidates,
  partnerOf,
  withoutMine,
  type Card,
} from '@roloai/shared';
import { db } from '../lib/firebase';
import {
  clearMyCard,
  deleteCard,
  linkCards,
  setMyCard,
  subscribeToCards,
  unlinkCards,
  updateCard,
} from '../lib/cards';
import CardForm from '../components/CardForm';
import ShareMenu from '../components/ShareMenu';

const displayName = (card: Card): string => `${card.firstName} ${card.lastName}`.trim();

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
  const candidates = useMemo(() => (card ? pairCandidates(card, withoutMine(cards)) : []), [card, cards]);

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
        <div className="header-actions">
          {card.isMine ? (
            <button className="link-button" onClick={() => void run(() => clearMyCard(card.id))}>
              This is my card — remove
            </button>
          ) : (
            <button className="link-button" onClick={() => void run(() => setMyCard(card.id))}>
              Use as my card
            </button>
          )}
          <ShareMenu card={card} />
        </div>
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
          const duplicates = findDuplicates(fields, withoutMine(cards), cardId);
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
