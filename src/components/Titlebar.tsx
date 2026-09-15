import { Minus, Square, X, Lock } from 'lucide-react';

export function Titlebar() {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().minimize();
    } catch {
      // Not in tauri
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().toggleMaximize();
    } catch {
      // Not in tauri
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch {
      // Not in tauri
    }
  };

  return (
    <>
      {isTauri && <WindowResizeHandles />}
      <div className="window-titlebar" data-tauri-drag-region>
        <div className="titlebar-left" data-tauri-drag-region>
          <Lock size={12} className="titlebar-icon" />
          <span className="titlebar-title">Pablock</span>
        </div>

        <div className="titlebar-center" data-tauri-drag-region />

        {isTauri && (
          <div className="titlebar-actions">
            <button
              type="button"
              className="titlebar-btn"
              title="Minimize"
              aria-label="Minimize"
              onClick={handleMinimize}
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              className="titlebar-btn"
              title="Maximize"
              aria-label="Maximize"
              onClick={handleToggleMaximize}
            >
              <Square size={11} />
            </button>
            <button
              type="button"
              className="titlebar-btn titlebar-close"
              title="Close"
              aria-label="Close"
              onClick={handleClose}
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function WindowResizeHandles() {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!isTauri) return null;

  const handleResize = async (
    direction: 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West',
    e: React.MouseEvent
  ) => {
    if (e.button !== 0) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startResizeDragging(direction);
    } catch {
      // Not in Tauri or unsupported
    }
  };

  return (
    <>
      <div className="window-resize-edge edge-n" onMouseDown={e => handleResize('North', e)} />
      <div className="window-resize-edge edge-s" onMouseDown={e => handleResize('South', e)} />
      <div className="window-resize-edge edge-w" onMouseDown={e => handleResize('West', e)} />
      <div className="window-resize-edge edge-e" onMouseDown={e => handleResize('East', e)} />
      <div className="window-resize-corner corner-nw" onMouseDown={e => handleResize('NorthWest', e)} />
      <div className="window-resize-corner corner-ne" onMouseDown={e => handleResize('NorthEast', e)} />
      <div className="window-resize-corner corner-sw" onMouseDown={e => handleResize('SouthWest', e)} />
      <div className="window-resize-corner corner-se" onMouseDown={e => handleResize('SouthEast', e)} />
    </>
  );
}
