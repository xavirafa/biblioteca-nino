import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import HTMLFlipBook from 'react-pageflip';

// Worker local para evitar problemas CDN/CORS
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

/* ========== Renderizador de pagina PDF ========== */
const PDFPageCanvas = React.memo(({ pdfDoc, pageNumber }: { pdfDoc: any; pageNumber: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let renderTask: any;
    let cancelled = false;

    if (pdfDoc && pageNumber >= 1 && pageNumber <= pdfDoc.numPages) {
      pdfDoc.getPage(pageNumber).then((page: any) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        renderTask = page.render({ canvasContext: ctx, viewport });
        renderTask.promise.catch((err: any) => {
          if (err.name !== 'RenderingCancelledException') console.error(err);
        });
      });
    }
    return () => {
      cancelled = true;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfDoc, pageNumber]);

  return (
    <div className="w-full h-full bg-white flex items-center justify-center overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full object-contain" />
    </div>
  );
});

/* ========== Wrapper de pagina ========== */
const Page = React.forwardRef<HTMLDivElement, any>((props, ref) => (
  <div ref={ref} data-density={props.density || 'soft'} className="bg-white">
    {props.children}
  </div>
));

/* ========== Velocidades ========== */
const SPEEDS = [
  { value: 0.7, label: '🐢', title: 'Lento' },
  { value: 1.0, label: '😊', title: 'Normal' },
  { value: 1.4, label: '🐇', title: 'Rapido' },
];

/* ========== Detectar si es movil/tablet ========== */
function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return mobile;
}

/* ========== Componente principal ========== */
export default function FlipbookReader() {
  const [searchParams] = useSearchParams();
  const pdfUrl = searchParams.get('url');
  const title = searchParams.get('title') || 'Mi libro';
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const flipBookRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const storageKey = pdfUrl ? `reading-pos:${pdfUrl}` : null;

  /* --- TTS --- */
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [pageText, setPageText] = useState('');
  const [autoRead, setAutoRead] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const autoReadRef = useRef(false);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Mantener ref sincronizado
  useEffect(() => { autoReadRef.current = autoRead; }, [autoRead]);

  /* Cargar voces */
  useEffect(() => {
    if (!ttsSupported) return;
    const loadVoices = () => {
      const all = window.speechSynthesis.getVoices();
      const esVoices = all.filter(v => v.lang.startsWith('es'));
      setVoices(esVoices.length > 0 ? esVoices : all.slice(0, 6));
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [ttsSupported]);

  /* Cargar PDF */
  useEffect(() => {
    if (!pdfUrl) return;
    setLoading(true);
    setUseFallback(false);
    setPdfDoc(null);

    let cancelled = false;
    const task = pdfjsLib.getDocument(pdfUrl);

    task.promise
      .then(doc => {
        if (cancelled) { doc.destroy(); return; }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        if (storageKey) {
          const saved = localStorage.getItem(storageKey);
          if (saved) {
            const pg = parseInt(saved, 10);
            if (!isNaN(pg) && pg > 0) setCurrentPage(pg);
          }
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUseFallback(true);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pdfUrl]);

  /* Guardar posicion */
  useEffect(() => {
    if (storageKey && currentPage > 0) {
      localStorage.setItem(storageKey, String(currentPage));
    }
  }, [currentPage, storageKey]);

  /* Extraer texto al cambiar de pagina */
  useEffect(() => {
    if (!pdfDoc || currentPage < 0) return;
    const pageNum = currentPage + 1;
    if (pageNum < 1 || pageNum > pdfDoc.numPages) return;

    pdfDoc.getPage(pageNum)
      .then((page: any) => page.getTextContent())
      .then((content: any) => {
        const text = content.items.map((item: any) => item.str).join(' ').replace(/\s+/g, ' ').trim();
        setPageText(text);
      })
      .catch(() => setPageText(''));
  }, [pdfDoc, currentPage]);

  /* Cleanup TTS */
  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  /* Fullscreen */
  const toggleFullscreen = () => {
    if (!isFullscreen) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const onFlip = useCallback((e: any) => { setCurrentPage(e.data); }, []);
  const prevPage = () => { flipBookRef.current?.pageFlip()?.flipPrev(); };
  const nextPage = useCallback(() => { flipBookRef.current?.pageFlip()?.flipNext(); }, []);

  /* === TTS: hablar texto === */
  const speakText = useCallback((text: string) => {
    if (!ttsSupported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.lang = 'es-CO';
    if (voices[selectedVoiceIndex]) utterance.voice = voices[selectedVoiceIndex];
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      // Si auto-read esta activo, avanzar a la siguiente pagina
      if (autoReadRef.current) {
        setTimeout(() => nextPage(), 600);
      }
    };
    utterance.onerror = () => setIsSpeaking(false);
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [ttsSupported, speed, voices, selectedVoiceIndex, nextPage]);

  /* Leer pagina actual */
  const speakPage = useCallback(() => {
    speakText(pageText);
  }, [speakText, pageText]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setAutoRead(false);
  }, []);

  /* Auto-leer cuando cambia de pagina (si autoRead esta activo) */
  useEffect(() => {
    if (autoRead && pageText && !isSpeaking) {
      // Esperar un momento para que la animacion del flip termine
      const timer = setTimeout(() => speakText(pageText), 800);
      return () => clearTimeout(timer);
    }
  }, [pageText, autoRead]);

  /* Iniciar lectura continua desde la pagina actual */
  const startContinuousRead = () => {
    setAutoRead(true);
    speakPage();
  };

  const toggleSpeak = () => {
    if (isSpeaking) {
      stopSpeaking();
    } else {
      speakPage();
    }
  };

  const progress = numPages > 0 ? ((currentPage + 1) / numPages) * 100 : 0;
  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  /* Sin URL */
  if (!pdfUrl) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <span style={{ fontSize: '72px' }}>😕</span>
      <p style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '24px', color: 'var(--text-mid)' }}>No se encontro el libro</p>
      <button onClick={() => navigate('/')} style={{ padding: '12px 28px', background: 'var(--lavender)', color: 'white', border: 'none', borderRadius: '50px', fontFamily: "'Fredoka One', sans-serif", fontSize: '18px', cursor: 'pointer' }}>
        Volver
      </button>
    </div>
  );

  /* Cargando */
  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
      <div className="animate-hop" style={{ fontSize: '80px', display: 'inline-block' }}>📚</div>
      <p style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '22px', color: 'var(--text-mid)' }}>Abriendo el libro...</p>
    </div>
  );

  /* Fallback */
  if (useFallback) return (
    <div style={{ minHeight: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'linear-gradient(135deg, #5c35d4, #9c27b0)' }}>
        <button onClick={() => navigate('/')} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', color: 'white', fontFamily: "'Fredoka One', sans-serif", fontSize: '13px', cursor: 'pointer' }}>
          🏠 Volver
        </button>
        <span style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '14px', color: 'white', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
      </div>
      <iframe src={pdfUrl} style={{ flex: 1, border: 'none', minHeight: '80vh' }} title={title} allow="fullscreen" />
    </div>
  );

  /* ===== LECTOR PRINCIPAL ===== */
  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex', flexDirection: 'column',
        height: '100vh', width: '100vw',
        background: '#f8f4ff', overflow: 'hidden', position: 'relative',
      }}
    >
      {/* === BARRA SUPERIOR COMPACTA === */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '4px 10px', height: '36px', flexShrink: 0,
        background: 'linear-gradient(90deg, #5c35d4, #7c3aed, #9c27b0)',
        zIndex: 40,
      }}>
        {/* Boton volver */}
        <button
          onClick={() => { stopSpeaking(); navigate('/'); }}
          style={{
            padding: '3px 10px', background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px',
            color: 'white', fontFamily: "'Nunito', sans-serif", fontWeight: 700,
            fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          🏠
        </button>

        {/* Titulo */}
        <div style={{
          flex: 1, fontFamily: "'Fredoka One', sans-serif", fontSize: '13px',
          color: 'white', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', textAlign: 'center',
        }}>
          {title}
        </div>

        {/* Pagina */}
        <span style={{
          fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '11px',
          color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap',
        }}>
          {currentPage + 1}/{numPages}
        </span>

        {/* Fullscreen */}
        <button
          onClick={toggleFullscreen}
          style={{
            padding: '3px 8px', background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px',
            color: 'white', fontSize: '14px', cursor: 'pointer',
          }}
          title={isFullscreen ? 'Salir' : 'Pantalla completa'}
        >
          {isFullscreen ? '✕' : '⛶'}
        </button>
      </div>

      {/* === BARRA PROGRESO DELGADA === */}
      <div style={{ width: '100%', height: '3px', background: '#EDE7F6', flexShrink: 0 }}>
        <div className="progress-rainbow" style={{ width: `${progress}%`, height: '3px' }} />
      </div>

      {/* === AREA DEL FLIPBOOK (llena toda la pantalla) === */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', padding: '0',
        overflow: 'hidden',
      }}>
        {/* Flecha izquierda */}
        <button
          onClick={prevPage}
          style={{
            position: 'absolute', left: '2px',
            top: '50%', transform: 'translateY(-50%)', zIndex: 30,
            background: 'rgba(92,53,212,0.7)',
            border: 'none', borderRadius: '50%',
            width: '30px', height: '30px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', cursor: 'pointer', color: 'white',
          }}
        >◀</button>

        {/* Flipbook — maximo espacio posible */}
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* @ts-ignore */}
          <HTMLFlipBook
            ref={flipBookRef}
            width={isMobile
              ? window.innerWidth - 40
              : Math.floor((window.innerWidth - 40) / 2)
            }
            height={window.innerHeight - 44}
            size="stretch"
            minWidth={200}
            maxWidth={isMobile ? window.innerWidth : Math.floor(window.innerWidth / 2)}
            minHeight={300}
            maxHeight={window.innerHeight - 44}
            maxShadowOpacity={0.3}
            showCover={true}
            mobileScrollSupport={true}
            useMouseEvents={!isMobile}
            clickEventForward={false}
            onFlip={onFlip}
            startPage={currentPage}
            drawShadow={true}
            flippingTime={800}
            usePortrait={isMobile}
            startZIndex={0}
            autoSize={true}
            swipeDistance={isMobile ? 20 : 30}
            showPageCorners={!isMobile}
            disableFlipByClick={false}
            style={{ margin: '0 auto' }}
          >
            {pages.map(pageNum => (
              <Page key={pageNum} density={pageNum === 1 || pageNum === numPages ? 'hard' : 'soft'}>
                <PDFPageCanvas pdfDoc={pdfDoc} pageNumber={pageNum} />
              </Page>
            ))}
          </HTMLFlipBook>
        </div>

        {/* Flecha derecha */}
        <button
          onClick={nextPage}
          style={{
            position: 'absolute', right: '2px',
            top: '50%', transform: 'translateY(-50%)', zIndex: 30,
            background: 'rgba(156,39,176,0.7)',
            border: 'none', borderRadius: '50%',
            width: '30px', height: '30px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', cursor: 'pointer', color: 'white',
          }}
        >▶</button>
      </div>

      {/* === PANEL TTS FLOTANTE (esquina inferior derecha) === */}
      {ttsSupported && (
        <div style={{
          position: 'absolute', bottom: isMobile ? '8px' : '12px',
          right: isMobile ? '8px' : '16px', zIndex: 50,
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
        }}>
          {/* Panel expandido */}
          {ttsOpen && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(92,53,212,0.95), rgba(156,39,176,0.95))',
              backdropFilter: 'blur(12px)',
              borderRadius: '16px', padding: '12px 14px',
              boxShadow: '0 8px 32px rgba(92,53,212,0.4)',
              minWidth: isMobile ? '220px' : '260px',
              animation: 'slideUp 0.25s ease-out',
            }}>
              {/* Velocidad */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', justifyContent: 'center' }}>
                {SPEEDS.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setSpeed(s.value)}
                    title={s.title}
                    style={{
                      padding: '4px 12px', borderRadius: '14px', border: 'none',
                      background: speed === s.value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.15)',
                      color: speed === s.value ? '#5c35a8' : 'white',
                      fontWeight: 800, fontSize: '16px', cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >{s.label}</button>
                ))}
              </div>

              {/* Voces */}
              {voices.length > 1 && (
                <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {voices.slice(0, 4).map((v, i) => (
                    <button
                      key={i}
                      onClick={() => { setSelectedVoiceIndex(i); if (isSpeaking) stopSpeaking(); }}
                      style={{
                        padding: '3px 8px', borderRadius: '10px', border: 'none',
                        background: selectedVoiceIndex === i ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)',
                        color: selectedVoiceIndex === i ? '#5c35a8' : 'rgba(255,255,255,0.8)',
                        fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      {v.name.replace(/Microsoft |Google /g, '').replace(/ \(.*\)/g, '').slice(0, 12)}
                    </button>
                  ))}
                </div>
              )}

              {/* Controles */}
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                {/* Leer esta pagina */}
                <button
                  onClick={toggleSpeak}
                  disabled={!pageText}
                  style={{
                    padding: '6px 14px', borderRadius: '12px', border: 'none',
                    background: isSpeaking ? 'var(--coral)' : 'var(--grass)',
                    color: 'white', fontFamily: "'Nunito', sans-serif",
                    fontWeight: 800, fontSize: '12px', cursor: pageText ? 'pointer' : 'default',
                    opacity: pageText ? 1 : 0.4,
                    boxShadow: isSpeaking ? '0 0 12px rgba(255,112,67,0.5)' : '0 2px 8px rgba(102,187,106,0.4)',
                  }}
                >
                  {isSpeaking ? '⏸ Parar' : '▶ Pagina'}
                </button>

                {/* Leer libro completo */}
                <button
                  onClick={autoRead ? stopSpeaking : startContinuousRead}
                  disabled={!pageText}
                  style={{
                    padding: '6px 14px', borderRadius: '12px', border: 'none',
                    background: autoRead ? 'var(--coral)' : 'linear-gradient(135deg, var(--sky), var(--ocean))',
                    color: 'white', fontFamily: "'Nunito', sans-serif",
                    fontWeight: 800, fontSize: '12px', cursor: pageText ? 'pointer' : 'default',
                    opacity: pageText ? 1 : 0.4,
                    boxShadow: autoRead ? '0 0 12px rgba(255,112,67,0.5)' : '0 2px 8px rgba(79,195,247,0.4)',
                  }}
                >
                  {autoRead ? '⏹ Detener' : '📖 Leer todo'}
                </button>
              </div>

              {/* Sin texto */}
              {!pageText && (
                <p style={{
                  textAlign: 'center', fontFamily: "'Nunito', sans-serif",
                  fontWeight: 600, fontSize: '10px', color: 'rgba(255,255,255,0.5)',
                  margin: '6px 0 0',
                }}>
                  Esta pagina es solo imagen
                </p>
              )}
            </div>
          )}

          {/* Boton flotante para abrir/cerrar TTS */}
          <button
            onClick={() => setTtsOpen(o => !o)}
            style={{
              width: isMobile ? '48px' : '52px', height: isMobile ? '48px' : '52px',
              borderRadius: '50%', border: 'none',
              background: (isSpeaking || autoRead)
                ? 'linear-gradient(135deg, var(--coral), #E53935)'
                : 'linear-gradient(135deg, #5c35d4, #9c27b0)',
              color: 'white', fontSize: '22px', cursor: 'pointer',
              boxShadow: (isSpeaking || autoRead)
                ? '0 4px 20px rgba(255,112,67,0.6)'
                : '0 4px 20px rgba(92,53,212,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
              animation: (isSpeaking || autoRead) ? 'pulse-glow-red 1.5s ease-in-out infinite' : 'none',
            }}
            title="Audiolibro"
          >
            {ttsOpen ? '✕' : (isSpeaking || autoRead) ? '🔊' : '🎧'}
          </button>
        </div>
      )}
    </div>
  );
}
