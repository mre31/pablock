const CIPHER_GLYPHS = '0123456789abcdefABCDEF!@#$%^&*()_+-=[]{}|;:,.<>?/~';

export interface CipherFadeOptions {
  scrambleDuration?: number;
  fadeDuration?: number;
  fps?: number;
  forceRunInTest?: boolean;
}

/**
 * Animates all text nodes and inputs inside a container with a cipher scramble
 * for a visible period before initiating a dissolve and fade-out.
 */
export function triggerCipherFadeOut(
  container: HTMLElement | null,
  options: CipherFadeOptions = {}
): Promise<void> {
  return new Promise((resolve) => {
    if (!container) {
      resolve();
      return;
    }

    const isTest = import.meta.env?.MODE === 'test';
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? true);

    if (!options.forceRunInTest && (isTest || prefersReducedMotion)) {
      resolve();
      return;
    }

    const scrambleDuration = options.scrambleDuration ?? 520;
    const fadeDuration = options.fadeDuration ?? 440;
    const totalDuration = scrambleDuration + fadeDuration;
    const fps = options.fps ?? 60;
    const frameInterval = 1000 / fps;
    const totalFrames = Math.max(1, Math.round((totalDuration / 1000) * fps));
    const scrambleFrames = Math.round((scrambleDuration / 1000) * fps);

    // Gather visible text nodes within the container
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || node.nodeValue.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (
            parent &&
            (parent.tagName === 'SCRIPT' ||
              parent.tagName === 'STYLE' ||
              parent.tagName === 'NOSCRIPT')
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    interface TextTarget {
      node: Text;
      originalText: string;
      length: number;
    }

    const targets: TextTarget[] = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      const text = currentNode.nodeValue || '';
      targets.push({
        node: currentNode as Text,
        originalText: text,
        length: text.length,
      });
      currentNode = walker.nextNode();
    }

    // Gather inputs and textareas
    interface InputTarget {
      element: HTMLInputElement | HTMLTextAreaElement;
      originalValue: string;
      originalPlaceholder: string;
    }
    const inputElements = container.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >('input, textarea');
    const inputTargets: InputTarget[] = [];
    inputElements.forEach((el) => {
      inputTargets.push({
        element: el,
        originalValue: el.value,
        originalPlaceholder: el.placeholder,
      });
    });

    let currentFrame = 0;
    const glyphsCount = CIPHER_GLYPHS.length;
    let fadeInitiated = false;

    const interval = setInterval(() => {
      currentFrame++;

      // When the scramble-only phase ends, initiate CSS fade-out
      if (!fadeInitiated && currentFrame >= scrambleFrames) {
        fadeInitiated = true;
        container.classList.add('is-locking-cypher');
      }

      const fadeProgress =
        currentFrame < scrambleFrames
          ? 0
          : Math.min(1, (currentFrame - scrambleFrames) / (totalFrames - scrambleFrames));

      // Scramble text nodes
      for (let t = 0; t < targets.length; t++) {
        const { node, originalText, length } = targets[t];
        let output = '';

        for (let i = 0; i < length; i++) {
          const ch = originalText[i];
          if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') {
            output += ch;
            continue;
          }

          // Before fade starts, all non-whitespace characters scramble at full opacity
          if (fadeProgress === 0) {
            output += CIPHER_GLYPHS[Math.floor(Math.random() * glyphsCount)];
          } else {
            // During fade, characters progressively dissolve into empty spaces
            const dissolveThreshold = 0.2 + ((i * 7) % 11) * 0.03 + (i / length) * 0.45;
            if (fadeProgress >= dissolveThreshold) {
              output += ' ';
            } else {
              output += CIPHER_GLYPHS[Math.floor(Math.random() * glyphsCount)];
            }
          }
        }

        node.nodeValue = output;
      }

      // Scramble input elements
      for (let t = 0; t < inputTargets.length; t++) {
        const { element, originalValue, originalPlaceholder } = inputTargets[t];

        if (originalValue) {
          let val = '';
          const len = originalValue.length;
          for (let i = 0; i < len; i++) {
            const ch = originalValue[i];
            if (ch === ' ' || ch === '\t') {
              val += ch;
              continue;
            }
            if (fadeProgress === 0) {
              val += CIPHER_GLYPHS[Math.floor(Math.random() * glyphsCount)];
            } else {
              const dissolveThreshold = 0.2 + (i / len) * 0.5;
              if (fadeProgress >= dissolveThreshold) {
                val += ' ';
              } else {
                val += CIPHER_GLYPHS[Math.floor(Math.random() * glyphsCount)];
              }
            }
          }
          element.value = val;
        }

        if (originalPlaceholder) {
          let ph = '';
          const len = originalPlaceholder.length;
          for (let i = 0; i < len; i++) {
            const ch = originalPlaceholder[i];
            if (ch === ' ') {
              ph += ' ';
              continue;
            }
            if (fadeProgress === 0) {
              ph += CIPHER_GLYPHS[Math.floor(Math.random() * glyphsCount)];
            } else {
              const dissolveThreshold = 0.2 + (i / len) * 0.5;
              if (fadeProgress >= dissolveThreshold) {
                ph += ' ';
              } else {
                ph += CIPHER_GLYPHS[Math.floor(Math.random() * glyphsCount)];
              }
            }
          }
          element.placeholder = ph;
        }
      }

      if (currentFrame >= totalFrames) {
        clearInterval(interval);
        resolve();
      }
    }, frameInterval);
  });
}
