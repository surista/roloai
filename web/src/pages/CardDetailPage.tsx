import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { cardFromFirestore, type Card } from '@roloai/shared';
import { db } from '../lib/firebase';
import { deleteCard, updateCard } from '../lib/cards';
import CardForm from '../components/CardForm';

export default function CardDetailPage() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();
  const [card, setCard] = useState<Card | null | undefined>(undefined);

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

  if (card === undefined) return <p className="empty">Loading…</p>;
  if (card === null) return <p className="empty">Card not found.</p>;

  const handleDelete = async () => {
    if (!cardId) return;
    if (!confirm(`Delete ${card.firstName} ${card.lastName}?`)) return;
    await deleteCard(cardId, [card.imageUrl, card.imageBackUrl]);
    navigate('/');
  };

  return (
    <div className="card-detail-page">
      <button className="link-button" onClick={() => navigate('/')}>
        ← Back
      </button>
      <CardForm
        draft={card}
        imageUrl={card.imageUrl || undefined}
        backImageUrl={card.imageBackUrl || undefined}
        saveLabel="Save Changes"
        onSave={async (fields) => {
          await updateCard(cardId!, fields);
        }}
        extraAction={{ label: 'Delete Card', onClick: handleDelete, destructive: true }}
      />
    </div>
  );
}
