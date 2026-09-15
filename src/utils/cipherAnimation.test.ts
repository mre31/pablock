import { describe, it, expect, vi } from 'vitest';
import { triggerCipherFadeOut } from './cipherAnimation';

describe('triggerCipherFadeOut', () => {
  it('returns immediately when container is null', async () => {
    await expect(triggerCipherFadeOut(null)).resolves.toBeUndefined();
  });

  it('scrambles text nodes before initiating fade-out class', async () => {
    vi.useFakeTimers();

    const container = document.createElement('div');
    const header = document.createElement('h1');
    header.textContent = 'Project Secrets';
    const input = document.createElement('input');
    input.value = 'Search text';
    input.placeholder = 'Search...';
    container.appendChild(header);
    container.appendChild(input);
    document.body.appendChild(container);

    const promise = triggerCipherFadeOut(container, {
      scrambleDuration: 200,
      fadeDuration: 200,
      fps: 30,
      forceRunInTest: true,
    });

    // In the middle of the scramble phase:
    vi.advanceTimersByTime(100);
    // Not faded yet
    expect(container.classList.contains('is-locking-cypher')).toBe(false);
    // But text is already actively scrambled into cipher characters
    expect(header.textContent).not.toBe('Project Secrets');

    // Cross into the fade phase:
    vi.advanceTimersByTime(120);
    expect(container.classList.contains('is-locking-cypher')).toBe(true);

    // Complete the remaining frames:
    vi.advanceTimersByTime(200);
    await promise;

    vi.useRealTimers();
    container.remove();
  });
});
