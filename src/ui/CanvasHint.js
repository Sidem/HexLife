// One-time, dismissible hint teaching the two non-obvious canvas gestures: the 3×3
// minimap tiles are click-to-focus, and the big selected view is drawable. The caller
// gates it behind a persisted flag (so it never repeats) and only invokes it when the
// onboarding tour is not running, so it never overlaps the spotlight.

let _activeHint = null;

/**
 * Show the canvas-interaction hint anchored to the bottom of the main view.
 * Idempotent while one is on screen. Auto-dismisses after a read window, or on the
 * "Got it" button.
 * @param {{ onDismiss?: () => void }} [opts]
 * @returns {{ dismiss: () => void }}
 */
export function showCanvasHint({ onDismiss } = {}) {
    if (_activeHint) return _activeHint;
    const host = document.getElementById('main-content-area') || document.body;

    const hint = document.createElement('div');
    hint.className = 'canvas-hint';
    hint.setAttribute('role', 'status');
    hint.innerHTML = `
        <span class="canvas-hint-icon" aria-hidden="true">👆</span>
        <div class="canvas-hint-text">
            <strong>Two ways to explore</strong>
            <span>Click a tile in the 3×3 minimap to focus it — and click or drag on the big view to draw cells.</span>
        </div>
        <button type="button" class="canvas-hint-dismiss" aria-label="Dismiss hint">Got it</button>
    `;
    host.appendChild(hint);
    requestAnimationFrame(() => hint.classList.add('show'));

    let timeoutId = null;
    const dismiss = () => {
        if (!_activeHint) return;
        _activeHint = null;
        if (timeoutId) clearTimeout(timeoutId);
        hint.classList.remove('show');
        hint.classList.add('fade-out');
        setTimeout(() => hint.remove(), 300);
        if (typeof onDismiss === 'function') onDismiss();
    };

    hint.querySelector('.canvas-hint-dismiss').addEventListener('click', dismiss);
    // Generous read window so the hint is genuinely seen before it self-dismisses.
    timeoutId = setTimeout(dismiss, 12000);

    _activeHint = { dismiss };
    return _activeHint;
}
