import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import FlipbookReader from './components/FlipbookReader';

/* Header infantil con gradiente arcoiris */
function Header() {
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: 'linear-gradient(90deg, #5c35d4 0%, #9c27b0 35%, #0288D1 70%, #0097A7 100%)',
        boxShadow: '0 4px 20px rgba(92,53,212,0.4)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group" style={{ textDecoration: 'none' }}>
          <span
            className="text-3xl"
            style={{ display: 'inline-block', transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}
            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.3) rotate(-10deg)')}
            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1) rotate(0deg)')}
          >
            📚
          </span>
          <div>
            <h1
              style={{
                fontFamily: "'Fredoka One', sans-serif",
                fontSize: '22px',
                color: 'white',
                lineHeight: '1',
                margin: 0,
                letterSpacing: '0.5px',
                textShadow: '0 2px 8px rgba(0,0,0,0.25)',
              }}
            >
              Mi Biblioteca Magica
            </h1>
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.8)', margin: 0, fontFamily: "'Nunito', sans-serif", fontWeight: 600 }}>
              Leer es una aventura!
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2 text-2xl" aria-hidden="true">
          <span className="animate-star-spin" style={{ display: 'inline-block', opacity: 0.9 }}>⭐</span>
          <span className="animate-wiggle-loop" style={{ display: 'inline-block', opacity: 0.85 }}>🌈</span>
          <span className="animate-float" style={{ display: 'inline-block', opacity: 0.9 }}>✨</span>
        </div>
      </div>
    </header>
  );
}

function AppContent() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg)' }}>
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/read" element={<FlipbookReader />} />
        </Routes>
      </main>

      <footer
        className="py-5 text-center border-t"
        style={{ borderColor: '#EDE7F6', background: 'linear-gradient(135deg, #f3e8ff 0%, #e8f4fd 100%)' }}
      >
        <p style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '14px', color: 'var(--text-mid)', margin: 0 }}>
          Secretos para Contar ✨ · Lectura y magia para todos
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/biblioteca-nino">
      <AppContent />
    </BrowserRouter>
  );
}
