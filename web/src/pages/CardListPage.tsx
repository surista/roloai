import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Card } from '@roloai/shared';
import { subscribeToCards } from '../lib/cards';
import { useAuth } from '../lib/AuthContext';

export default function CardListPage() {
  const { logout } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => subscribeToCards(setCards), []);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    cards.forEach((c) => c.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (activeTag && !c.tags.includes(activeTag)) return false;
      if (!q) return true;
      return [c.firstName, c.lastName, c.company, c.jobTitle, ...c.tags]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q));
    });
  }, [cards, search, activeTag]);

  return (
    <div className="card-list-page">
      <header className="page-header">
        <h1>RoloAI</h1>
        <button className="link-button" onClick={logout}>
          Sign out
        </button>
      </header>

      <div className="filters">
        <input
          className="search-input"
          placeholder="Search name, company, tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {allTags.length > 0 && (
          <div className="tag-filters">
            <button
              className={`tag-chip ${activeTag === null ? 'active' : ''}`}
              onClick={() => setActiveTag(null)}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`tag-chip ${activeTag === tag ? 'active' : ''}`}
                onClick={() => setActiveTag(tag === activeTag ? null : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="empty">No cards found. Scan one from the iPhone app to see it here.</p>
      ) : (
        <div className="card-grid">
          {filtered.map((card) => (
            <Link key={card.id} to={`/cards/${card.id}`} className="card-tile">
              {card.imageUrl ? (
                <img src={card.imageUrl} alt="" className="card-thumb" />
              ) : (
                <div className="card-thumb card-thumb-placeholder" />
              )}
              <div className="card-tile-body">
                <div className="card-name">
                  {card.firstName} {card.lastName}
                </div>
                <div className="card-subtitle">
                  {[card.jobTitle, card.company].filter(Boolean).join(' · ')}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
