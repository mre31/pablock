import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CypherSecret } from './CypherSecret';
import { api } from '../api';

vi.mock('../api', () => ({
  api: vi.fn(),
  errorMessage: (e: unknown) => String(e),
}));

describe('CypherSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders masked dots initially', () => {
    render(
      <CypherSecret
        profileId="profile-1"
        variableKey="API_KEY"
        hasValue={true}
      />
    );
    expect(screen.getByText('••••••••••••••')).toBeInTheDocument();
  });

  it('reveals secret and adjusts character count based on width', async () => {
    const longSecret = 'sk-proj-0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz_end';
    vi.mocked(api).mockResolvedValue(longSecret);

    const user = userEvent.setup();
    const { container } = render(
      <div className="table-wrapper">
        <table className="env-table">
          <tbody>
            <tr className="table-row">
              <td className="cell-key">API_KEY</td>
              <td className="cell-value">
                <CypherSecret
                  profileId="profile-1"
                  variableKey="API_KEY"
                  hasValue={true}
                />
              </td>
              <td className="cell-modified">15.09.2026</td>
              <td className="cell-actions"></td>
            </tr>
          </tbody>
        </table>
      </div>
    );

    const wrapper = container.querySelector('.table-wrapper')!;
    const keyCell = container.querySelector('.cell-key')!;

    vi.spyOn(keyCell, 'getBoundingClientRect').mockReturnValue({
      width: 150,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 150,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Mock getBoundingClientRect for wrapper (narrow width: 600px)
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      width: 600,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const revealBtn = screen.getByRole('button', { name: /Reveal API_KEY/ });
    await user.click(revealBtn);

    // Should reveal formatted text with ellipsis
    const revealedEl = await screen.findByTitle(longSecret);
    const textAt600 = revealedEl.textContent || '';
    expect(textAt600).toContain('...');
    expect(textAt600.length).toBeLessThan(longSecret.length);

    // Now simulate wider container (1200px)
    vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // Trigger window resize
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const textAt1200 = revealedEl.textContent || '';
    // With 1200px width, more characters should be visible than at 600px
    expect(textAt1200.length).toBeGreaterThan(textAt600.length);
  });

  it('displays entire secret when secret fits within container width', async () => {
    const shortSecret = 'postgres://user:pass@localhost/db';
    vi.mocked(api).mockResolvedValue(shortSecret);

    const user = userEvent.setup();
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <td>
              <CypherSecret
                profileId="profile-1"
                variableKey="DATABASE_URL"
                hasValue={true}
              />
            </td>
          </tr>
        </tbody>
      </table>
    );

    const td = container.querySelector('td')!;
    vi.spyOn(td, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await user.click(screen.getByRole('button', { name: /Reveal DATABASE_URL/ }));
    const revealedEl = await screen.findByTitle(shortSecret);
    expect(revealedEl.textContent).toBe(shortSecret);
  });
});
