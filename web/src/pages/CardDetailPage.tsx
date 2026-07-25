import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import type { Card } from '@roloai/shared';
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
      const data = snap.data();
      const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
      const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : createdAt;
      setCard({ id: snap.id, ...data, createdAt, updatedAt } as Card);
    });
  }, [cardId]);

  if (card === undefined) return <p className="empty">Loading…</p>;
  if (card === null) return <p className="empty">Card not found.</p>;

  const handleDelete = async () => {
    if (!cardId) return;
    if (!confirm(`Delete ${card.firstName} ${card.lastName}?`)) return;
    await deleteCard(cardId);
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
