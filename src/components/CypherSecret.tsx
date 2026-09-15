import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import { api, errorMessage } from '../api';

const GLYPHS = '0123456789abcdefABCDEF!@#$%^&*()_+-=[]{}|;:,.<>?';
const MASK_DOTS = '••••••••••••••';
function calculateMaxVisibleChars(el: HTMLElement | null): number {
  if (!el) return 80;

  // Measure from the table container to prevent circular min-content width locking:
  const tableWrapper = el.closest('.table-wrapper') || el.closest('.variables-panel');
  const tr = el.closest('tr');

  if (tableWrapper && tr) {
    const wrapperWidth = tableWrapper.getBoundingClientRect().width;
    if (wrapperWidth > 0) {
      const keyCell = tr.querySelector('.cell-key');
      const keyWidth = keyCell ? keyCell.getBoundingClientRect().width : Math.max(160, wrapperWidth * 0.22);
      // Fixed column widths: modified (155px), actions (115px)
      const fixedWidths = 155 + 115;
      // Account for cell paddings (~40px) + action buttons & gaps (~75px) + safety buffer (15px)
      const availableWidth = wrapperWidth - keyWidth - fixedWidths - 130;
      // Monospace 13px character width is approx 7.8px
      const chars = Math.floor(Math.max(120, availableWidth) / 7.8);
      return Math.max(24, chars);
    }
  }

  const cell = el.closest('td') || el.parentElement;
  if (cell) {
    const cellWidth = cell.getBoundingClientRect().width;
    if (cellWidth > 0) {
      const availableWidth = Math.max(120, cellWidth - 120);
      return Math.max(24, Math.floor(availableWidth / 7.8));
    }
  }

  return 80;
}

function formatSecretDisplay(text: string, max: number): string {
  if (text.length <= max) return text;
  const remaining = Math.max(6, max - 3);
  const startLength = Math.ceil(remaining * 0.6);
  const endLength = Math.floor(remaining * 0.4);
  return `${text.slice(0, startLength)}...${text.slice(-endLength)}`;
}

interface CypherSecretProps {
  profileId: string;
  variableKey: string;
  hasValue: boolean;
  isTemplate?: boolean;
}

export function CypherSecret({ profileId, variableKey, hasValue, isTemplate }: CypherSecretProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textRef = useRef<HTMLSpanElement>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fullSecretRef = useRef<string | null>(null);
  const generation = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const lifecycle = generation;
    return () => {
      lifecycle.current++;
      fullSecretRef.current = null;
      if (animRef.current) clearInterval(animRef.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!isRevealed) return;

    const updateDisplay = () => {
      const el = textRef.current;
      const secret = fullSecretRef.current;
      if (!el || secret === null || animRef.current !== null) return;
      const maxChars = calculateMaxVisibleChars(el);
      const displayText = formatSecretDisplay(secret, maxChars);
      if (el.textContent !== displayText) {
        el.textContent = displayText;
        el.setAttribute('title', secret);
      }
    };

    const scheduleUpdate = () => {
      updateDisplay();
    };

    scheduleUpdate();

    window.addEventListener('resize', scheduleUpdate);

    let observer: ResizeObserver | null = null;
    const tableWrapper = textRef.current?.closest('.table-wrapper') || textRef.current?.closest('.variables-panel') || document.querySelector('.main-content');
    if (typeof ResizeObserver !== 'undefined' && tableWrapper) {
      observer = new ResizeObserver(scheduleUpdate);
      observer.observe(tableWrapper);
    }

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      if (observer) observer.disconnect();
    };
  }, [isRevealed]);

  if (!hasValue) {
    return (
      <span className="secret-text masked-dots text-muted">
        {isTemplate ? 'Template key' : 'Deleted'}
      </span>
    );
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;

  const triggerDecipher = (fullSecret: string) => {
    const el = textRef.current;
    if (!el) return;

    if (animRef.current) clearInterval(animRef.current);

    const maxChars = calculateMaxVisibleChars(el);
    const displayText = formatSecretDisplay(fullSecret, maxChars);
    const duration = reduceMotion ? 10 : 380;
    const startLength = el.textContent?.length || MASK_DOTS.length;
    const targetLength = displayText.length;
    const fps = 60;
    const totalFrames = Math.max(reduceMotion ? 1 : 18, Math.round((duration / 1000) * fps));
    let currentFrame = 0;

    el.classList.remove('masked-dots');
    el.classList.add('is-clear');

    if (reduceMotion) {
      el.textContent = displayText;
      el.setAttribute('title', fullSecret);
      setIsRevealed(true);
      return;
    }

    animRef.current = setInterval(() => {
      currentFrame++;
      const progress = Math.min(1, currentFrame / totalFrames);
      const currentLen = Math.round(startLength + (targetLength - startLength) * progress);
      const resolvedCount = Math.floor(progress * targetLength);

      let output = '';
      for (let i = 0; i < currentLen; i++) {
        if (i < resolvedCount) {
          output += displayText[i];
        } else {
          output += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }

      el.textContent = output;

      if (currentFrame >= totalFrames) {
        if (animRef.current) clearInterval(animRef.current);
        el.textContent = displayText;
        el.setAttribute('title', fullSecret);
        animRef.current = null;
        setIsRevealed(true);
      }
    }, 1000 / fps);
  };

  const triggerEncipher = () => {
    const el = textRef.current;
    if (!el) return;

    if (animRef.current) clearInterval(animRef.current);

    const duration = reduceMotion ? 10 : 350;
    const startLength = el.textContent?.length || 20;
    const targetLength = MASK_DOTS.length;
    const fps = 60;
    const totalFrames = Math.max(reduceMotion ? 1 : 18, Math.round((duration / 1000) * fps));
    let currentFrame = 0;

    fullSecretRef.current = null;
    el.removeAttribute('title');

    if (reduceMotion) {
      el.textContent = MASK_DOTS;
      el.classList.remove('is-clear');
      el.classList.add('masked-dots');
      setIsRevealed(false);
      return;
    }

    animRef.current = setInterval(() => {
      currentFrame++;
      const progress = Math.min(1, currentFrame / totalFrames);
      const currentLen = Math.round(startLength - (startLength - targetLength) * progress);
      const dotsCount = Math.floor(progress * targetLength);

      let output = '';
      for (let i = 0; i < currentLen; i++) {
        if (i < dotsCount) {
          output += '•';
        } else {
          output += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }

      el.textContent = output;

      if (currentFrame >= totalFrames) {
        if (animRef.current) clearInterval(animRef.current);
        el.textContent = MASK_DOTS;
        el.classList.remove('is-clear');
        el.classList.add('masked-dots');
        animRef.current = null;
        setIsRevealed(false);
      }
    }, 1000 / fps);
  };

  const handleToggleReveal = async () => {
    if (loading) return;

    if (isRevealed) {
      triggerEncipher();
      return;
    }

    setError(null);
    setLoading(true);

    const requestGeneration = generation.current;
    try {
      let secret = fullSecretRef.current;
      if (secret === null) {
        secret = await api('reveal', { profile: profileId, key: variableKey });
        if (requestGeneration !== generation.current) return;
        fullSecretRef.current = secret;
      }
      triggerDecipher(secret);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    const requestGeneration = generation.current;
    setError(null);
    try {
      const secret = fullSecretRef.current ?? await api('reveal', { profile: profileId, key: variableKey });
      if (requestGeneration !== generation.current) return;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(secret);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = secret;
        textArea.style.position = 'fixed'; textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        try {
          textArea.focus(); textArea.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard copy failed');
        } finally { textArea.value = ''; textArea.remove(); }
      }
      if (requestGeneration !== generation.current) return;
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch (e) { if (requestGeneration === generation.current) setError(errorMessage(e)); }
  };

  return (
    <div className="secret-value-group">
      <span ref={textRef} className="secret-text masked-dots">
        {MASK_DOTS}
      </span>

      <div className="secret-actions">
        <button
          className="eye-ghost-btn"
          type="button"
          disabled={loading}
          title={isRevealed ? 'Hide secret' : 'Reveal secret'}
          aria-label={`${isRevealed ? 'Hide' : 'Reveal'} ${variableKey}`}
          onClick={handleToggleReveal}
        >
          {isRevealed ? <EyeOff className="icon-eye-off" size={15} /> : <Eye className="icon-eye" size={15} />}
        </button>

        <button
          className="copy-ghost-btn"
          type="button"
          title={copied ? 'Copied!' : 'Copy secret'}
          aria-label={`Copy ${variableKey}`}
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="icon-check" size={14} />
          ) : (
            <Copy className="icon-copy" size={14} />
          )}
        </button>
      </div>

      {error && <span className="secret-error" role="alert">{error}</span>}
    </div>
  );
}
