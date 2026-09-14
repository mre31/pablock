/**
 * Pablock - Decipher Secret Reveal, Truncation & Copy Functionality
 * Format: [start] + ... + [end] for long values when revealed
 * Matrix-style character scramble text decryption effect
 */

const GLYPHS = '0123456789abcdefABCDEF!@#$%^&*()_+-=[]{}|;:,.<>?';
const MASK_DOTS = '••••••••••••••';
const MAX_VISIBLE_CHARS = 28;

/**
 * Format long secrets to "start + ... + end" format if they exceed max length
 * @param {string} text - Full secret text
 * @param {number} max - Threshold character length
 * @returns {string} Formatted display string
 */
function formatSecretDisplay(text, max = MAX_VISIBLE_CHARS) {
  if (text.length <= max) return text;
  const startLength = 12;
  const endLength = 9;
  return `${text.slice(0, startLength)}...${text.slice(-endLength)}`;
}

/**
 * Decipher reveal animation:
 * Smoothly expands length from current to display text,
 * scrambling glyphs and progressively locking in real characters.
 */
function decipherText(element, displayText, fullSecret, duration = 380) {
  if (element._animInterval) {
    clearInterval(element._animInterval);
  }

  const startLength = element.textContent.length || MASK_DOTS.length;
  const targetLength = displayText.length;
  const fps = 60;
  const totalFrames = Math.max(18, Math.round((duration / 1000) * fps));
  let currentFrame = 0;

  element.classList.remove('masked-dots');
  element.classList.add('is-clear');

  element._animInterval = setInterval(() => {
    currentFrame++;
    const progress = Math.min(1, currentFrame / totalFrames);

    // Smooth length expansion from startLength to targetLength
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

    element.textContent = output;

    if (currentFrame >= totalFrames) {
      clearInterval(element._animInterval);
      element.textContent = displayText;
      element.setAttribute('title', fullSecret);
      element._animInterval = null;
    }
  }, 1000 / fps);
}

/**
 * Encipher hide animation:
 * Smoothly shrinks length from current string down to mask length,
 * scrambling glyphs and progressively resolving into mask dots.
 */
function encipherToMask(element, duration = 350) {
  if (element._animInterval) {
    clearInterval(element._animInterval);
  }

  const startLength = element.textContent.length;
  const targetLength = MASK_DOTS.length;
  const fps = 60;
  const totalFrames = Math.max(18, Math.round((duration / 1000) * fps));
  let currentFrame = 0;

  element.removeAttribute('title');

  element._animInterval = setInterval(() => {
    currentFrame++;
    const progress = Math.min(1, currentFrame / totalFrames);

    // Smooth length reduction from startLength down to targetLength
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

    element.textContent = output;

    if (currentFrame >= totalFrames) {
      clearInterval(element._animInterval);
      element.textContent = MASK_DOTS;
      element.classList.remove('is-clear');
      element.classList.add('masked-dots');
      element._animInterval = null;
    }
  }, 1000 / fps);
}

/**
 * Copy text to clipboard with checkmark visual feedback
 */
async function copyToClipboard(text, copyBtn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Fallback for non-https/iframe contexts
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (e) {
      console.error('Copy failed', e);
    }
    document.body.removeChild(textArea);
  }

  const iconCopy = copyBtn.querySelector('.icon-copy');
  const iconCheck = copyBtn.querySelector('.icon-check');

  if (iconCopy && iconCheck) {
    iconCopy.classList.add('hidden');
    iconCheck.classList.remove('hidden');
    copyBtn.setAttribute('title', 'Copied!');

    setTimeout(() => {
      iconCheck.classList.add('hidden');
      iconCopy.classList.remove('hidden');
      copyBtn.setAttribute('title', 'Copy secret');
    }, 1500);
  }
}

// Bind all secret groups
document.addEventListener('DOMContentLoaded', () => {
  const secretGroups = document.querySelectorAll('.secret-value-group');

  secretGroups.forEach(group => {
    const eyeBtn = group.querySelector('.eye-ghost-btn');
    const copyBtn = group.querySelector('.copy-ghost-btn');
    const textSpan = group.querySelector('.secret-text');
    const eyeIcon = group.querySelector('.icon-eye');
    const eyeOffIcon = group.querySelector('.icon-eye-off');
    const fullSecret = group.getAttribute('data-secret') || 'sample_secret_value';
    const displaySecret = formatSecretDisplay(fullSecret);

    let isRevealed = false;

    // Eye toggle button (Decipher animation)
    if (eyeBtn) {
      eyeBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        if (!isRevealed) {
          isRevealed = true;
          eyeBtn.setAttribute('title', 'Hide secret');
          eyeBtn.setAttribute('aria-label', 'Hide secret');
          eyeIcon.classList.add('hidden');
          eyeOffIcon.classList.remove('hidden');

          decipherText(textSpan, displaySecret, fullSecret, 380);
        } else {
          isRevealed = false;
          eyeBtn.setAttribute('title', 'Reveal secret');
          eyeBtn.setAttribute('aria-label', 'Reveal secret');
          eyeOffIcon.classList.add('hidden');
          eyeIcon.classList.remove('hidden');

          encipherToMask(textSpan, 350);
        }
      });
    }

    // Copy button (copies full secret to clipboard)
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(fullSecret, copyBtn);
      });
    }
  });
});
