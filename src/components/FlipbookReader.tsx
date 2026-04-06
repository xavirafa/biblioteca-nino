import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import HTMLFlipBook from 'react-pageflip';

// Worker local (copiado en public/) para evitar problemas de CDN y CORS
pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

/* ========== Renderizador de página PDF ========== */
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

/* ========== Wrapper de página para react-pageflip ========== */
const Page = React.forwardRef<HTMLDivElement, any>((props, ref) => (
  <div ref={ref} data-density={props.density || 'soft'} className="bg-white">
    {props.children}
  </div>
));

/* ========== Velocidades de lectura ========== */
const SPEEDS = [
  { value: 0.7, label: 'Lento', emoji: '🐢' },
  { value: 1.0, label: 'Normal', emoji: '😊' },
  { value: 1.4, label: 'Rapido', emoji: '🐇' },
];

/* ========== Simplifica el nombre de una voz ========== */
function voiceName(v: SpeechSynthesisVoice, idx: number): string {
  const name = v.name
    .replace(/Microsoft /g, '')
    .replace(/Google /g, '')
    .replace(/ \(.*\)/g, '')
    .trim();
  return `Voz ${idx + 1}: ${name.slice(0, 10)}`;
}

/* ========== Componente principal ========== */
export default function FlipbookReader() {
  const [searchParams] = useSearchParams();
  const pdfUrl = searchParams.get('url');
  const title = searchParams.get('title') || 'Mi libro';
  const navigate = useNavigate();

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [useFallback, setUseFallback] = useState(false);

  const flipBookRef = useRef<any>(null);
  const storageKey = pdfUrl ? `reading-pos:${pdfUrl}` : null;

  /* --- TTS --- */
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState(0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [pageText, setPageText] = useState('');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

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

    const task = pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false });

    task.promise
      .then(doc => {
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
      .catch(err => {
        console.warn('PDF.js fallo (CORS u otro):', err);
        setUseFallback(true);
        setLoading(false);
      });

    return () => { task.destroy?.(); };
  }, [pdfUrl]);

  /* Guardar posicion */
  useEffect(() => {
    if (storageKey && currentPage > 0) {
      localStorage.setItem(storageKey, String(currentPage));
    }
  }, [currentPage, storageKey]);

  /* Extraer texto de la página */
  useEffect(() => {
    if (!pdfDoc || currentPage < 0) return;
    const pageNum = currentPage + 1;
    if (pageNum < 1 || pageNum > pdfDoc.numPages) return;

    window.speechSynthesis?.cancel();
    setIsSpeaking(false);

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

  const onFlip = useCallback((e: any) => { setCurrentPage(e.data); }, []);

  const prevPage = () => { flipBookRef.current?.pageFlip()?.flipPrev(); };
  const nextPage = () => { flipBookRef.current?.pageFlip()?.flipNext(); };

  /* Leer la pagina actual */
  const speakPage = useCallback(() => {
    if (!ttsSupported || !pageText.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(pageText);
    utterance.rate = speed;
    utterance.lang = 'es-CO';
    if (voices[selectedVoiceIndex]) utterance.voice = voices[selectedVoiceIndex];
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [ttsSupported, pageText, speed, voices, selectedVoiceIndex]);

  const stopSpeaking = () => { window.speechSynthesis?.cancel(); setIsSpeaking(false); };
  const toggleSpeak = () => { isSpeaking ? stopSpeaking() : speakPage(); };
  const nextPageAndRead = () => { nextPage(); setTimeout(() => speakPage(), 1200); };

  const progress = numPages > 0 ? ((currentPage + 1) / numPages) * 100 : 0;
  const pages = Array.from({ length: numPages }, (_, i) => i + 1);

  /* Sin URL */
  if (!pdfUrl) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <span style={{ fontSize: '72px' }}>😕</span>
      <p style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '24px', color: 'var(--text-mid)' }}>No se especifico ningun libro</p>
      <button onClick={() => navigate('/')} style={{ padding: '12px 28px', background: 'var(--lavender)', color: 'white', border: 'none', borderRadius: '50px', fontFamily: "'Fredoka One', sans-serif", fontSize: '18px', cursor: 'pointer' }}>
        Volver a la biblioteca
      </button>
    </div>
  );

  /* Cargando */
  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
      <div className="animate-hop" style={{ fontSize: '80px', display: 'inline-block' }}>📚</div>
      <p style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '26px', color: 'var(--text-mid)' }}>Abriendo el libro...</p>
      <p style={{ fontFamily: "'Nunito', sans-serif", fontWeight: 600, fontSize: '15px', color: 'var(--text-light)' }}>Esto puede tomar unos segundos</p>
    </div>
  );

  /* Fallback iframe cuando CORS bloquea PDF.js */
  if (useFallback) return (
    <div style={{ minHeight: 'calc(100vh - 4rem)', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'linear-gradient(135deg, #5c35d4, #9c27b0)', boxShadow: '0 4px 16px rgba(92,53,212,0.3)' }}>
        <button onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)', borderRadius: '12px', color: 'white', fontFamily: "'Fredoka One', sans-serif", fontSize: '16px', cursor: 'pointer' }}>
          Biblioteca
        </button>
        <span style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '18px', color: 'white', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
      </div>
      <div style={{ margin: '16px', padding: '14px 18px', background: 'linear-gradient(135deg, #fff3e0, #fce4ec)', borderRadius: '16px', border: '2px solid #FFB74D', fontFamily: "'Nunito', sans-serif", fontSize: '14px', color: '#5D4037' }}>
        <strong>Nota:</strong> Este libro se muestra en modo visor externo. El audiolibro no esta disponible. Puedes leer aqui abajo.
      </div>
      <iframe src={pdfUrl} style={{ flex: 1, border: 'none', minHeight: '70vh' }} title={title} allow="fullscreen" />
    </div>
  );

  /* ===== LECTOR PRINCIPAL ===== */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 4rem)', background: 'var(--bg)', paddingBottom: '180px' }}>

      {/* Barra de progreso arcoiris */}
      <div style={{ width: '100%', height: '7px', background: '#EDE7F6' }}>
        <div className="progress-rainbow" style={{ width: `${progress}%` }} />
      </div>

      {/* Toolbar superior */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: 'linear-gradient(135deg, #5c35d4 0%, #9c27b0 100%)',
        boxShadow: '0 4px 16px rgba(92,53,212,0.35)',
        position: 'sticky', top: '4rem', zIndex: 40,
      }}>
        <button
          onClick={() => { stopSpeaking(); navigate('/'); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px',
            background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)',
            borderRadius: '12px', color: 'white', fontFamily: "'Fredoka One', sans-serif",
            fontSize: '15px', cursor: 'pointer',
          }}
        >
          Biblioteca
        </button>

        <div style={{ textAlign: 'center', flex: 1, margin: '0 12px' }}>
          <div style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: 'clamp(12px, 2.5vw, 17px)', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div className="page-badge" style={{ display: 'inline-block', marginTop: '4px', fontSize: '13px', padding: '2px 12px' }}>
            Pag {currentPage + 1} de {numPages}
          </div>
        </div>

        <div style={{ width: '90px' }} />
      </div>

      {/* Area del flipbook */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 60px', position: 'relative', minHeight: '400px' }}>

        {/* Boton pagina anterior */}
        <button
          onClick={prevPage}
          style={{
            position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
            zIndex: 30, background: 'linear-gradient(135deg, #5c35d4, #9c27b0)',
            border: 'none', borderRadius: '50%', width: '48px', height: '48px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', cursor: 'pointer', boxShadow: '0 4px 16px rgba(92,53,212,0.5)',
            color: 'white',
          }}
          title="Pagina anterior"
        >
          ◀
        </button>

        {/* Flipbook */}
        <div style={{ width: '100%', maxWidth: '900px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* @ts-ignore — react-pageflip props */}
          <HTMLFlipBook
            ref={flipBookRef}
            width={window.innerWidth < 768 ? Math.min(window.innerWidth * 0.75, 340) : 440}
            height={window.innerWidth < 768 ? Math.min(window.innerHeight * 0.55, 480) : 620}
            size="stretch"
            minWidth={260}
            maxWidth={880}
            minHeight={360}
            maxHeight={1300}
            maxShadowOpacity={0.4}
            showCover={true}
            mobileScrollSupport={true}
            useMouseEvents={false}
            clickEventForward={false}
            onFlip={onFlip}
            startPage={currentPage}
            drawShadow={true}
            flippingTime={900}
            usePortrait={window.innerWidth < 768}
            startZIndex={0}
            autoSize={true}
            swipeDistance={30}
            showPageCorners={false}
            disableFlipByClick={false}
            className="shadow-2xl rounded"
            style={{ margin: '0 auto' }}
          >
            {pages.map(pageNum => (
              <Page key={pageNum} density={pageNum === 1 || pageNum === numPages ? 'hard' : 'soft'}>
                <PDFPageCanvas pdfDoc={pdfDoc} pageNumber={pageNum} />
              </Page>
            ))}
          </HTMLFlipBook>
        </div>

        {/* Boton pagina siguiente */}
        <button
          onClick={nextPage}
          style={{
            position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
            zIndex: 30, background: 'linear-gradient(135deg, #9c27b0, #0288D1)',
            border: 'none', borderRadius: '50%', width: '48px', height: '48px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', cursor: 'pointer', boxShadow: '0 4px 16px rgba(156,39,176,0.5)',
            color: 'white',
          }}
          title="Pagina siguiente"
        >
          ▶
        </button>
      </div>

      {/* ===== PANEL TTS FIJO ABAJO ===== */}
      <div className="tts-panel" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50 }}>

        {/* Fila 1: titulo + velocidades */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontFamily: "'Fredoka One', sans-serif", fontSize: '17px', color: 'white' }}>
            Audiolibro
          </span>

          {ttsSupported && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {SPEEDS.map(s => (
                <button
                  key={s.value}
                  className={`speed-btn${speed === s.value ? ' active' : ''}`}
                  onClick={() => {
                    setSpeed(s.value);
                    if (isSpeaking) { stopSpeaking(); setTimeout(speakPage, 150); }
                  }}
                  title={s.label}
                >
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fila 2: selector de voz */}
        {ttsSupported && voices.length > 1 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {voices.slice(0, 4).map((v, i) => (
              <button
                key={i}
                className={`voice-btn${selectedVoiceIndex === i ? ' active' : ''}`}
                onClick={() => { setSelectedVoiceIndex(i); if (isSpeaking) stopSpeaking(); }}
              >
                {voiceName(v, i)}
              </button>
            ))}
          </div>
        )}

        {/* Fila 3: controles de navegacion + play */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <button className="nav-btn-tts" onClick={prevPage} title="Pagina anterior">
            <span style={{ fontSize: '20px' }}>⬅</span>
            <span style={{ fontSize: '11px' }}>Anterior</span>
          </button>

          <button
            className={`tts-btn-play${isSpeaking ? ' speaking' : ''}`}
            onClick={ttsSupported ? toggleSpeak : undefined}
            disabled={!ttsSupported || !pageText}
            title={isSpeaking ? 'Parar' : 'Escuchar pagina'}
            style={{ opacity: (!ttsSupported || !pageText) ? 0.5 : 1 }}
          >
            {isSpeaking ? '⏸' : '🎧'}
          </button>

          <button
            className="nav-btn-tts"
            onClick={ttsSupported ? nextPageAndRead : nextPage}
            title="Siguiente pagina y leer"
          >
            <span style={{ fontSize: '20px' }}>➡</span>
            <span style={{ fontSize: '11px' }}>{ttsSupported ? 'Sig + Leer' : 'Siguiente'}</span>
          </button>
        </div>

        {/* Aviso si la pagina no tiene texto */}
        {ttsSupported && !pageText && !loading && (
          <p style={{ textAlign: 'center', fontFamily: "'Nunito', sans-serif", fontWeight: 600, fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: '8px 0 0' }}>
            Esta pagina es imagen, no tiene texto para leer en voz alta
          </p>
        )}
      </div>

    </div>
  );
}
