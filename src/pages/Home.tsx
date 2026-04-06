import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

interface Book {
  title: string;
  url: string;
  pdf_url: string | null;
  cover?: string;
}

const CARD_COLORS = 8;

/* Lee el progreso de lectura guardado */
function getSavedProgress(pdfUrl: string | null): number {
  if (!pdfUrl) return 0;
  const key = `reading-pos:${pdfUrl}`;
  const saved = localStorage.getItem(key);
  return saved ? parseInt(saved, 10) : 0;
}

/* Tarjeta individual de libro */
function BookCard({ book, index, onRead }: { book: Book; index: number; onRead: () => void }) {
  const colorIdx = index % CARD_COLORS;
  const [hovered, setHovered] = useState(false);
  const savedPage = getSavedProgress(book.pdf_url);
  const hasPdf = !!book.pdf_url;

  /* Construye URL de portada compatible con GitHub Pages (BASE_URL) */
  const coverUrl = book.cover
    ? `${import.meta.env.BASE_URL}${book.cover.replace(/^\//, '')}`
    : null;

  return (
    <div className={`animate-bounce-in delay-${Math.min(index + 1, 15)}`} style={{ opacity: 0 }}>
      <div
        className={`book-card book-border-${colorIdx}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => hasPdf && onRead()}
        style={{ opacity: hasPdf ? 1 : 0.7 }}
        title={hasPdf ? `Leer ${book.title}` : 'No disponible aun'}
      >
        {/* Portada */}
        <div style={{ position: 'relative', aspectRatio: '3/4', width: '100%', overflow: 'hidden' }}>
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={book.title}
              loading="lazy"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transition: 'transform 0.5s ease',
                transform: hovered ? 'scale(1.08)' : 'scale(1)',
                display: 'block',
              }}
            />
          ) : (
            <div style={{
              width: '100%', height: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '64px',
              background: 'linear-gradient(135deg, #EDE7F6, #E3F2FD)',
            }}>
              📖
            </div>
          )}

          {/* Estrella de progreso si ya se habia leido */}
          {savedPage > 0 && (
            <div style={{
              position: 'absolute', top: '8px', right: '8px',
              background: 'rgba(255,213,79,0.95)', borderRadius: '50%',
              width: '34px', height: '34px', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '18px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)', border: '2px solid white',
            }} title={`Ultima vez en pagina ${savedPage}`}>
              ⭐
            </div>
          )}

          {/* Overlay cuando no hay PDF */}
          {!hasPdf && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{
                background: 'rgba(255,255,255,0.9)', color: '#5B5080',
                borderRadius: '50px', padding: '6px 14px',
                fontFamily: "'Nunito', sans-serif", fontWeight: 800, fontSize: '12px',
              }}>
                Pronto 🔒
              </span>
            </div>
          )}
        </div>

        {/* Pie de tarjeta */}
        <div style={{ padding: '12px 14px 14px' }}>
          {savedPage > 0 && (
            <div className="mini-progress" style={{ marginBottom: '8px' }}>
              <div className="mini-progress-bar" style={{ width: `${Math.min(100, (savedPage / 50) * 100)}%` }} />
            </div>
          )}
          <h3 style={{
            fontFamily: "'Fredoka One', sans-serif", fontSize: '15px',
            color: 'var(--text-dark)', margin: '0 0 10px', lineHeight: '1.2',
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {book.title}
          </h3>

          {hasPdf ? (
            <button
              className={`btn-read-${colorIdx}`}
              style={{
                width: '100%', padding: '9px 0', borderRadius: '12px', border: 'none',
                fontFamily: "'Fredoka One', sans-serif", fontSize: '16px',
                cursor: 'pointer', transition: 'transform 0.2s',
                transform: hovered ? 'scale(1.04)' : 'scale(1)',
                letterSpacing: '0.3px',
              }}
              onClick={e => { e.stopPropagation(); onRead(); }}
            >
              {savedPage > 0 ? '▶ Seguir' : '📖 Leer!'}
            </button>
          ) : (
            <div style={{
              width: '100%', padding: '9px 0', borderRadius: '12px',
              background: '#EDE7F6', textAlign: 'center',
              fontFamily: "'Nunito', sans-serif", fontWeight: 700,
              fontSize: '13px', color: 'var(--text-light)',
            }}>
              No disponible
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Cohete decorativo animado */
function RocketDeco() {
  return (
    <div className="animate-float" style={{ fontSize: '72px', display: 'inline-block', filter: 'drop-shadow(0 8px 16px rgba(92,53,212,0.3))' }} aria-hidden="true">
      🚀
    </div>
  );
}

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}books/metadata.json`)
      .then(res => res.json())
      .then((data: Book[]) => { setBooks(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return books;
    const q = search.toLowerCase();
    return books.filter(b => b.title.toLowerCase().includes(q));
  }, [books, search]);

  function handleRead(book: Book) {
    if (!book.pdf_url) return;
    navigate(`/read?url=${encodeURIComponent(book.pdf_url)}&title=${encodeURIComponent(book.title)}`);
  }

  return (
    <div className="bg-dots" style={{ minHeight: 'calc(100vh - 4rem)' }}>

      {/* ===== HERO ===== */}
      <div style={{
        background: 'linear-gradient(160deg, #f3e8ff 0%, #e8f4fd 50%, #fff9f0 100%)',
        padding: '40px 20px 36px', textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}>
        {/* Decoraciones flotantes */}
        <span style={{ position: 'absolute', top: '12px', left: '8%', fontSize: '28px', opacity: 0.5, animation: 'float 4s ease-in-out infinite' }} aria-hidden="true">⭐</span>
        <span style={{ position: 'absolute', top: '20px', right: '12%', fontSize: '22px', opacity: 0.45, animation: 'float 4s ease-in-out 1.5s infinite' }} aria-hidden="true">🌟</span>
        <span style={{ position: 'absolute', bottom: '10px', left: '15%', fontSize: '20px', opacity: 0.4, animation: 'wiggle 2.5s ease-in-out infinite' }} aria-hidden="true">🎈</span>
        <span style={{ position: 'absolute', bottom: '8px', right: '8%', fontSize: '24px', opacity: 0.5, animation: 'float 4s ease-in-out 2s infinite' }} aria-hidden="true">🦋</span>

        <RocketDeco />

        <h2 className="animate-slide-up" style={{
          fontFamily: "'Fredoka One', sans-serif",
          fontSize: 'clamp(26px, 6vw, 50px)',
          color: 'var(--text-dark)', margin: '16px 0 10px', lineHeight: 1.1,
        }}>
          Hola! Que libro quieres leer hoy?
        </h2>
        <p className="animate-slide-up delay-2" style={{
          opacity: 0, fontFamily: "'Nunito', sans-serif", fontWeight: 700,
          fontSize: 'clamp(15px, 2.5vw, 19px)', color: 'var(--text-mid)',
          margin: '0 auto 28px', maxWidth: '500px',
        }}>
          Tienes{' '}
          <span style={{ color: 'var(--lavender-dark)', fontWeight: 900 }}>{books.length}</span>
          {' '}libros magicos esperandote 📖✨
        </p>

        {/* Barra de busqueda */}
        <div className="animate-slide-up delay-4" style={{ opacity: 0, maxWidth: '480px', margin: '0 auto', position: 'relative' }}>
          <span style={{ position: 'absolute', left: '18px', top: '50%', transform: 'translateY(-50%)', fontSize: '26px', pointerEvents: 'none' }}>
            🔍
          </span>
          <input
            type="text"
            placeholder="Busca tu libro favorito..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="search-kid"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Borrar busqueda"
              style={{
                position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)',
                background: 'var(--lavender)', border: 'none', borderRadius: '50%',
                width: '28px', height: '28px', cursor: 'pointer', color: 'white',
                fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>

        {search && (
          <p style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '15px', color: 'var(--text-mid)', marginTop: '12px' }}>
            {filtered.length > 0
              ? `Encontre ${filtered.length} libro${filtered.length !== 1 ? 's' : ''} 🎉`
              : 'No encontre ese libro 😢 Prueba otro nombre'}
          </p>
        )}
      </div>

      {/* ===== GRID ===== */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '28px 16px 56px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div className="animate-hop" style={{ fontSize: '72px', display: 'inline-block' }}>📚</div>
            <p style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '24px', color: 'var(--text-mid)', marginTop: '16px' }}>
              Cargando los libros magicos...
            </p>
          </div>
        ) : (
          <div className="books-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '16px',
          }}>
            {filtered.map((book, i) => (
              <BookCard
                key={book.url || book.title}
                book={book}
                index={i}
                onRead={() => handleRead(book)}
              />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && search && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: '72px' }}>😢</div>
            <h3 style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '26px', color: 'var(--text-mid)', margin: '16px 0 8px' }}>
              No encontre ese libro...
            </h3>
            <p style={{ fontFamily: "'Nunito', sans-serif", color: 'var(--text-light)', fontWeight: 600 }}>
              Prueba con otro nombre, como "cuentos" o "maravillosos"
            </p>
            <button
              onClick={() => setSearch('')}
              style={{
                marginTop: '20px', padding: '12px 28px', background: 'var(--lavender)',
                color: 'white', border: 'none', borderRadius: '50px',
                fontFamily: "'Fredoka One', sans-serif", fontSize: '18px', cursor: 'pointer',
              }}
            >
              Ver todos los libros
            </button>
          </div>
        )}
      </div>

      {/* Estilos responsive para el grid — no se pueden poner inline en el elemento */}
      <style>{`
        @media (min-width: 640px) {
          .books-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (min-width: 900px) {
          .books-grid { grid-template-columns: repeat(4, 1fr) !important; }
        }
        @media (min-width: 1200px) {
          .books-grid { grid-template-columns: repeat(5, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
