import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';
import { api, errorMessage } from '../api';

const GLYPHS = '0123456789abcdefABCDEF!@#$%^&*()_+-=[]{}|;:,.<>?';
const MASK_DOTS = '••••••••••••••';
const MAX_VISIBLE_CHARS = 28;

function formatSecretDisplay(text: string, max = MAX_VISIBLE_CHARS): string {
  if (text.length <= max) return text;
  const startLength = 12;
  const endLength = 9;
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

    const displayText = formatSecretDisplay(fullSecret);
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
