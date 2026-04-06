import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import HTMLFlipBook from 'react-pageflip';

// Worker local
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
    return () => { cancelled = true; if (renderTask) renderTask.cancel(); };
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

/* ========== Extraer texto de una pagina PDF ========== */
async function extractPageText(pdfDoc: any, pageNum: number): Promise<string> {
  if (!pdfDoc || pageNum < 1 || pageNum > pdfDoc.numPages) return '';
  try {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    return content.items.map((item: any) => item.str).join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/* ========== Velocidades ========== */
const SPEEDS = [
  { value: 0.7, label: '🐢', title: 'Lento' },
  { value: 1.0, label: '😊', title: 'Normal' },
  { value: 1.4, label: '🐇', title: 'Rapido' },
];

/* ========== Detectar movil/tablet ========== */
function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return mobile;
}

/* ========== COMPONENTE PRINCIPAL ========== */
export default function FlipbookReader() {
  const [searchParams] = useSearchParams();
  const pdfUrl = searchParams.get('url');
  const title = searchParams.get('title') || 'Mi libro';
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // PDF
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const flipBookRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const storageKey = pdfUrl ? `reading-pos:${pdfUrl}` : null;

  // TTS
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [speed, setSpeed] = useState(() => {
    const saved = localStorage.getItem('tts-speed');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(() => {
    const saved = localStorage.getItem('tts-voice');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [spreadTexts, setSpreadTexts] = useState<{ left: string; right: string }>({ left: '', right: '' });
  const [autoRead, setAutoRead] = useState(false);
  const [ttsOpen, setTtsOpen] = useState(false);
  const [sleepTimer, setSleepTimer] = useState<number | null>(null);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showTextPicker, setShowTextPicker] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const autoReadRef = useRef(false);
  const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Texto combinado de ambas paginas
  const pageText = [spreadTexts.left, spreadTexts.right].filter(Boolean).join(' ');

  // Mantener ref sincronizado
  useEffect(() => { autoReadRef.current = autoRead; }, [autoRead]);

  // Persistir preferencias TTS
  useEffect(() => {
    localStorage.setItem('tts-speed', String(speed));
    localStorage.setItem('tts-voice', String(selectedVoiceIndex));
  }, [speed, selectedVoiceIndex]);

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
      .catch(() => { if (!cancelled) { setUseFallback(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [pdfUrl]);

  /* Guardar posicion */
  useEffect(() => {
    if (storageKey && currentPage > 0) {
      localStorage.setItem(storageKey, String(currentPage));
    }
  }, [currentPage, storageKey]);

  /* Extraer texto de AMBAS paginas visibles */
  useEffect(() => {
    if (!pdfDoc || currentPage < 0) return;
    let cancelled = false;

    async function extract() {
      if (isMobile) {
        // Portrait: una sola pagina
        const text = await extractPageText(pdfDoc, currentPage + 1);
        if (!cancelled) setSpreadTexts({ left: text, right: '' });
      } else {
        // Landscape con showCover=true:
        // spread 0 = portada sola (pagina 1)
        // spread N (N>=1) = pagina izq (N+1), pagina der (N+2)
        if (currentPage === 0) {
          const text = await extractPageText(pdfDoc, 1);
          if (!cancelled) setSpreadTexts({ left: text, right: '' });
        } else {
          const leftPageNum = currentPage + 1;
          const rightPageNum = currentPage + 2;
          const [leftText, rightText] = await Promise.all([
            extractPageText(pdfDoc, leftPageNum),
            extractPageText(pdfDoc, rightPageNum),
          ]);
          if (!cancelled) setSpreadTexts({ left: leftText, right: rightText });
        }
      }
    }
    extract();
    return () => { cancelled = true; };
  }, [pdfDoc, currentPage, isMobile]);

  /* Cleanup TTS */
  useEffect(() => { return () => { window.speechSynthesis?.cancel(); }; }, []);

  /* Fullscreen */
  const toggleFullscreen = () => {
    if (!isFullscreen) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  /* Sleep timer */
  useEffect(() => {
    if (sleepTimer === null) {
      if (sleepTimerRef.current) clearInterval(sleepTimerRef.current);
      return;
    }
    sleepTimerRef.current = setInterval(() => {
      setSleepTimer(prev => {
        if (prev === null || prev <= 1) {
          window.speechSynthesis?.cancel();
          setIsSpeaking(false);
          setAutoRead(false);
          return null;
        }
        return prev - 1;
      });
    }, 60000);
    return () => { if (sleepTimerRef.current) clearInterval(sleepTimerRef.current); };
  }, [sleepTimer]);

  const onFlip = useCallback((e: any) => {
    // Cancelar lectura al cambiar de pagina manualmente
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setCurrentPage(e.data);
  }, []);
  const prevPage = useCallback(() => { flipBookRef.current?.pageFlip()?.flipPrev(); }, []);
  const nextPage = useCallback(() => { flipBookRef.current?.pageFlip()?.flipNext(); }, []);

  /* === TTS: leer spread completo (izq → der → avanzar) === */
  const speakSpread = useCallback(() => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    setIsPaused(false);

    const texts = [spreadTexts.left, spreadTexts.right].filter(t => t.trim());
    if (texts.length === 0) {
      // Sin texto, avanzar si autoRead
      if (autoReadRef.current) setTimeout(() => nextPage(), 600);
      return;
    }

    let index = 0;
    function speakNext() {
      if (index >= texts.length) {
        setIsSpeaking(false);
        if (autoReadRef.current) setTimeout(() => nextPage(), 800);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(texts[index]);
      utterance.rate = speed;
      utterance.lang = 'es-CO';
      if (voices[selectedVoiceIndex]) utterance.voice = voices[selectedVoiceIndex];
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => { index++; setTimeout(speakNext, 400); };
      utterance.onerror = () => setIsSpeaking(false);
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }
    speakNext();
  }, [ttsSupported, speed, voices, selectedVoiceIndex, spreadTexts, nextPage]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
    setAutoRead(false);
  }, []);

  /* Leer desde un parrafo especifico hacia adelante */
  const speakFromParagraph = useCallback((paragraphIndex: number, allParagraphs: string[]) => {
    if (!ttsSupported) return;
    window.speechSynthesis.cancel();
    setIsPaused(false);
    setShowTextPicker(false);

    const remaining = allParagraphs.slice(paragraphIndex).filter(t => t.trim());
    if (remaining.length === 0) return;

    let index = 0;
    function speakNext() {
      if (index >= remaining.length) {
        setIsSpeaking(false);
        if (autoReadRef.current) setTimeout(() => nextPage(), 800);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(remaining[index]);
      utterance.rate = speed;
      utterance.lang = 'es-CO';
      if (voices[selectedVoiceIndex]) utterance.voice = voices[selectedVoiceIndex];
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => { index++; setTimeout(speakNext, 300); };
      utterance.onerror = () => setIsSpeaking(false);
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }
    speakNext();
  }, [ttsSupported, speed, voices, selectedVoiceIndex, nextPage]);

  const toggleSpeak = useCallback(() => {
    if (isSpeaking) {
      if (isPaused) {
        window.speechSynthesis.resume();
        setIsPaused(false);
      } else {
        window.speechSynthesis.pause();
        setIsPaused(true);
      }
    } else {
      setIsPaused(false);
      speakSpread();
    }
  }, [isSpeaking, isPaused, speakSpread]);

  const startContinuousRead = useCallback(() => {
    setAutoRead(true);
    setIsPaused(false);
    speakSpread();
  }, [speakSpread]);

  /* Auto-leer cuando cambia de pagina si autoRead activo */
  useEffect(() => {
    if (autoRead && spreadTexts.left && !isSpeaking) {
      const timer = setTimeout(() => speakSpread(), 800);
      return () => clearTimeout(timer);
    }
  }, [spreadTexts, autoRead]);

  const skipForward = useCallback(() => { stopSpeaking(); nextPage(); }, [stopSpeaking, nextPage]);
  const skipBack = useCallback(() => { stopSpeaking(); prevPage(); }, [stopSpeaking, prevPage]);

  const progress = numPages > 0 ? ((currentPage + 1) / numPages) * 100 : 0;
  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  /* === ESTADOS DE CARGA === */
  if (!pdfUrl) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <span style={{ fontSize: '72px' }}>😕</span>
      <p style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '24px', color: 'var(--text-mid)' }}>No se encontro el libro</p>
      <button onClick={() => navigate('/')} style={{ padding: '12px 28px', background: 'var(--lavender)', color: 'white', border: 'none', borderRadius: '50px', fontFamily: "'Fredoka One', sans-serif", fontSize: '18px', cursor: 'pointer' }}>Volver</button>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
      <div className="animate-hop" style={{ fontSize: '80px', display: 'inline-block' }}>📚</div>
      <p style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '22px', color: 'var(--text-mid)' }}>Abriendo el libro...</p>
    </div>
  );

  if (useFallback) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'linear-gradient(135deg, #5c35d4, #9c27b0)' }}>
        <button onClick={() => navigate('/')} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', color: 'white', fontFamily: "'Fredoka One', sans-serif", fontSize: '13px', cursor: 'pointer' }}>🏠 Volver</button>
        <span style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '14px', color: 'white', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
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
        <button
          onClick={() => { stopSpeaking(); navigate('/'); }}
          style={{ padding: '3px 10px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', color: 'white', fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '12px', cursor: 'pointer' }}
        >🏠</button>
        <div style={{ flex: 1, fontFamily: "'Fredoka One', sans-serif", fontSize: '13px', color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
          {title}
        </div>
        <span style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '11px', color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap' }}>
          {currentPage + 1}/{numPages}
        </span>
        <button
          onClick={toggleFullscreen}
          style={{ padding: '3px 8px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', color: 'white', fontSize: '14px', cursor: 'pointer' }}
          title={isFullscreen ? 'Salir' : 'Pantalla completa'}
        >{isFullscreen ? '✕' : '⛶'}</button>
      </div>

      {/* === BARRA PROGRESO === */}
      <div style={{ width: '100%', height: '3px', background: '#EDE7F6', flexShrink: 0 }}>
        <div className="progress-rainbow" style={{ width: `${progress}%`, height: '3px' }} />
      </div>

      {/* === FLIPBOOK === */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', padding: '0', overflow: 'hidden' }}>
        {/* Flecha izquierda */}
        <button onClick={prevPage} style={{
          position: 'absolute', left: '2px', top: '50%', transform: 'translateY(-50%)', zIndex: 30,
          background: 'rgba(92,53,212,0.7)', border: 'none', borderRadius: '50%',
          width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '14px', cursor: 'pointer', color: 'white',
        }}>◀</button>

        {/* Libro */}
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* @ts-ignore */}
          <HTMLFlipBook
            ref={flipBookRef}
            width={isMobile ? window.innerWidth - 40 : Math.floor((window.innerWidth - 40) / 2)}
            height={window.innerHeight - 44}
            size="stretch"
            minWidth={200}
            maxWidth={isMobile ? window.innerWidth : Math.floor(window.innerWidth / 2)}
            minHeight={300}
            maxHeight={window.innerHeight - 44}
            maxShadowOpacity={0}
            showCover={true}
            mobileScrollSupport={true}
            useMouseEvents={!isMobile}
            clickEventForward={false}
            onFlip={onFlip}
            startPage={currentPage}
            drawShadow={false}
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
        <button onClick={nextPage} style={{
          position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)', zIndex: 30,
          background: 'rgba(156,39,176,0.7)', border: 'none', borderRadius: '50%',
          width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '14px', cursor: 'pointer', color: 'white',
        }}>▶</button>
      </div>

      {/* === PANEL AUDIOLIBRO INFERIOR DESLIZABLE === */}
      {ttsSupported && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
          transition: 'transform 0.3s ease',
          transform: ttsOpen ? 'translateY(0)' : 'translateY(calc(100% - 48px))',
        }}>
          {/* Pestana para abrir/cerrar */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setTtsOpen(o => !o)}
              style={{
                background: 'linear-gradient(135deg, #5c35d4, #9c27b0)',
                border: 'none', borderRadius: '16px 16px 0 0',
                padding: '6px 20px', color: 'white', fontSize: '14px',
                cursor: 'pointer', fontFamily: "'Fredoka One', sans-serif",
                boxShadow: '0 -4px 16px rgba(92,53,212,0.3)',
                animation: (isSpeaking || autoRead) && !ttsOpen ? 'pulse-glow-red 1.5s ease-in-out infinite' : 'none',
              }}
            >
              {ttsOpen ? '▼ Cerrar' : (isSpeaking || autoRead) ? '🔊 Escuchando...' : '🎧 Audiolibro'}
            </button>
          </div>

          {/* Panel principal */}
          <div className="tts-panel" style={{ padding: isMobile ? '12px 16px 16px' : '14px 24px 18px' }}>

            {/* Fila 1: Controles principales */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: isMobile ? '12px' : '20px', marginBottom: '12px' }}>
              {/* Skip atras */}
              <button onClick={skipBack} style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)',
                color: 'white', fontSize: '18px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>⏮</button>

              {/* PLAY / PAUSE grande */}
              <button onClick={toggleSpeak} disabled={!pageText} style={{
                width: '72px', height: '72px', borderRadius: '50%',
                background: !pageText ? 'rgba(255,255,255,0.2)'
                  : isSpeaking ? (isPaused ? 'var(--sunshine)' : 'var(--coral)') : 'var(--grass)',
                border: 'none', color: 'white', fontSize: '32px',
                cursor: pageText ? 'pointer' : 'default',
                boxShadow: isSpeaking ? '0 6px 24px rgba(255,112,67,0.5)' : '0 6px 24px rgba(102,187,106,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s', opacity: pageText ? 1 : 0.4,
              }}>
                {isSpeaking ? (isPaused ? '▶' : '⏸') : '▶'}
              </button>

              {/* Skip adelante */}
              <button onClick={skipForward} style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)',
                color: 'white', fontSize: '18px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>⏭</button>
            </div>

            {/* Fila 2: Lectura continua + Velocidad + Sleep */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Lectura continua */}
              <button
                onClick={autoRead ? stopSpeaking : startContinuousRead}
                disabled={!pageText}
                style={{
                  padding: '7px 14px', borderRadius: '20px', border: 'none',
                  background: autoRead ? 'var(--coral)' : 'linear-gradient(135deg, var(--sky), var(--ocean))',
                  color: 'white', fontFamily: "'Fredoka One', sans-serif",
                  fontSize: '13px', cursor: pageText ? 'pointer' : 'default',
                  opacity: pageText ? 1 : 0.4,
                }}
              >
                {autoRead ? '⏹ Parar' : '📖 Leer todo'}
              </button>

              {/* Elegir parrafo para leer */}
              <button
                onClick={() => setShowTextPicker(true)}
                disabled={!pageText}
                style={{
                  padding: '7px 14px', borderRadius: '20px', border: 'none',
                  background: 'linear-gradient(135deg, var(--lavender), var(--bubblegum))',
                  color: 'white', fontFamily: "'Fredoka One', sans-serif",
                  fontSize: '13px', cursor: pageText ? 'pointer' : 'default',
                  opacity: pageText ? 1 : 0.4,
                }}
              >
                📝 Elegir
              </button>

              {/* Velocidad */}
              <div style={{ display: 'flex', gap: '4px' }}>
                {SPEEDS.map(s => (
                  <button
                    key={s.value}
                    onClick={() => setSpeed(s.value)}
                    title={s.title}
                    style={{
                      padding: '5px 12px', borderRadius: '14px', border: 'none',
                      background: speed === s.value ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.15)',
                      color: speed === s.value ? '#5c35a8' : 'white',
                      fontWeight: 800, fontSize: '16px', cursor: 'pointer',
                    }}
                  >{s.label}</button>
                ))}
              </div>

              {/* Voces (si hay mas de 1) */}
              {voices.length > 1 && (
                <div style={{ display: 'flex', gap: '3px' }}>
                  {voices.slice(0, 3).map((v, i) => (
                    <button
                      key={i}
                      onClick={() => { setSelectedVoiceIndex(i); if (isSpeaking) { window.speechSynthesis.cancel(); setIsSpeaking(false); } }}
                      style={{
                        padding: '4px 8px', borderRadius: '10px', border: 'none',
                        background: selectedVoiceIndex === i ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)',
                        color: selectedVoiceIndex === i ? '#5c35a8' : 'rgba(255,255,255,0.8)',
                        fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '10px', cursor: 'pointer',
                      }}
                    >
                      {v.name.replace(/Microsoft |Google /g, '').replace(/ \(.*\)/g, '').slice(0, 10)}
                    </button>
                  ))}
                </div>
              )}

              {/* Sleep timer */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowSleepMenu(v => !v)}
                  style={{
                    padding: '5px 12px', borderRadius: '14px', border: 'none',
                    background: sleepTimer ? 'var(--sunshine)' : 'rgba(255,255,255,0.15)',
                    color: sleepTimer ? '#5c35a8' : 'white',
                    fontWeight: 800, fontSize: '13px', cursor: 'pointer',
                    fontFamily: "'Nunito', sans-serif",
                  }}
                >
                  {sleepTimer ? `🌙 ${sleepTimer}m` : '🌙'}
                </button>
                {showSleepMenu && (
                  <div style={{
                    position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(45,34,80,0.95)', borderRadius: '12px', padding: '6px',
                    marginBottom: '6px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '80px',
                  }}>
                    {[5, 10, 15, 30].map(mins => (
                      <button key={mins} onClick={() => { setSleepTimer(mins); setShowSleepMenu(false); }}
                        style={{ padding: '5px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
                      >{mins} min</button>
                    ))}
                    {sleepTimer && (
                      <button onClick={() => { setSleepTimer(null); setShowSleepMenu(false); }}
                        style={{ padding: '5px 10px', borderRadius: '8px', background: 'var(--coral)', border: 'none', color: 'white', fontFamily: "'Nunito', sans-serif", fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
                      >Cancelar</button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Sin texto */}
            {!pageText && (
              <p style={{ textAlign: 'center', fontFamily: "'Fredoka One', sans-serif", fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: '8px 0 0' }}>
                Esta pagina solo tiene dibujos 🎨
              </p>
            )}
          </div>
        </div>
      )}

      {/* === OVERLAY SELECTOR DE TEXTO === */}
      {showTextPicker && pageText && (() => {
        // Dividir texto en parrafos (por punto seguido de espacio y mayuscula, o por saltos)
        const allParagraphs: string[] = [];
        const sides = [
          { label: '📄 Pagina izquierda', text: spreadTexts.left },
          { label: '📄 Pagina derecha', text: spreadTexts.right },
        ].filter(s => s.text.trim());

        sides.forEach(side => {
          // Dividir en oraciones/frases de ~80-150 caracteres
          const sentences = side.text.match(/[^.!?]+[.!?]+/g) || [side.text];
          let chunk = '';
          sentences.forEach(s => {
            if (chunk.length + s.length > 120 && chunk.length > 30) {
              allParagraphs.push(chunk.trim());
              chunk = s;
            } else {
              chunk += s;
            }
          });
          if (chunk.trim()) allParagraphs.push(chunk.trim());
        });

        return (
          <div
            style={{
              position: 'absolute', inset: 0, zIndex: 60,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
              display: 'flex', flexDirection: 'column',
              padding: isMobile ? '16px' : '24px',
            }}
            onClick={() => setShowTextPicker(false)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1, maxWidth: '700px', width: '100%', margin: '0 auto',
                background: 'white', borderRadius: '20px',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}
            >
              {/* Header */}
              <div style={{
                padding: '14px 20px', background: 'linear-gradient(135deg, #5c35d4, #9c27b0)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '16px', color: 'white' }}>
                  Toca donde quieres empezar a leer 👆
                </span>
                <button
                  onClick={() => setShowTextPicker(false)}
                  style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', color: 'white', fontSize: '16px', cursor: 'pointer' }}
                >✕</button>
              </div>

              {/* Lista de parrafos */}
              <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
                {allParagraphs.map((para, i) => (
                  <button
                    key={i}
                    onClick={() => speakFromParagraph(i, allParagraphs)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '12px 16px', marginBottom: '8px',
                      background: 'linear-gradient(135deg, #f3e8ff, #e8f4fd)',
                      border: '2px solid #EDE7F6', borderRadius: '14px',
                      fontFamily: "'Nunito', sans-serif", fontWeight: 600,
                      fontSize: '14px', color: 'var(--text-dark)',
                      cursor: 'pointer', lineHeight: '1.5',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #e8d5ff, #d0eaff)'; e.currentTarget.style.borderColor = '#5c35d4'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #f3e8ff, #e8f4fd)'; e.currentTarget.style.borderColor = '#EDE7F6'; }}
                  >
                    <span style={{ fontSize: '12px', color: 'var(--text-light)', marginRight: '8px' }}>▶</span>
                    {para}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
