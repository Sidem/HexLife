/**
 * GPU capability detection, and the copy that tells someone how to fix it.
 *
 * Both HexLife surfaces are WebGL2-only by design — the Explorer renders nine instanced worlds, the
 * embed one — so "your browser has hardware acceleration turned off" is a real, and *silent*, way
 * for either to look broken. Chrome with acceleration disabled still hands out a WebGL2 context;
 * it is just backed by SwiftShader and runs a 64-row world at a few frames a second. Nothing
 * throws, nothing logs, and the user concludes the thing is busted.
 *
 * This module is the one place that knows how to spot that, and the one place that owns the
 * remediation steps, so the Explorer and the Reddit (Devvit) card can't drift apart on either.
 *
 * **The two surfaces treat `software` differently, on purpose.** The Explorer refuses to start —
 * it is a lab someone chose to open, and nine software-rendered worlds is not a usable lab. The
 * Reddit card warns and runs anyway, because `WEBGL_debug_renderer_info` is masked or absent in
 * plenty of mobile webviews, and a false positive there would blank out somebody's *post* on a
 * device whose GPU was fine all along. Blocking is the more costly mistake in a feed.
 */

/**
 * Renderer strings that mean "this is the CPU pretending". `swiftshader` is Chrome's fallback,
 * `llvmpipe` Mesa's; the bare word `software` catches the rest (and Firefox's `Software WebRender`).
 */
const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|software/i;

/**
 * Does this vendor/renderer string describe a CPU rasterizer?
 *
 * Separated out (and exported) because it is the one judgement call in here that can be wrong in
 * both directions, and it is the only part testable without a GL context.
 *
 * @param {string} info Vendor / renderer, as reported by the driver.
 */
export function isSoftwareRenderer(info) {
    return SOFTWARE_RENDERER_RE.test(String(info || ''));
}

/**
 * @typedef {object} GraphicsPath
 * @property {'no-webgl2'|'software'|'likely-hardware'} status What we think we're drawing with.
 * @property {string} info Vendor / renderer, unmasked where the browser allowed it. For logs.
 * @property {boolean} masked True when `WEBGL_debug_renderer_info` was unavailable, which makes a
 *   `likely-hardware` verdict a guess rather than a reading. Callers that block should care.
 */

/**
 * Probe for a hardware-backed WebGL2 context, without disturbing the caller's canvas.
 *
 * Uses a throwaway canvas and then explicitly drops the context: browsers cap live WebGL contexts
 * (~16), and in a Reddit feed several cards may probe within a second of each other. Leaving the
 * probes to garbage collection could starve the very worlds we are checking on behalf of.
 *
 * Never throws — a detector that can itself break the boot would be worse than no detector.
 *
 * @returns {GraphicsPath}
 */
export function detectGraphicsPath() {
    let gl = null;
    try {
        gl = document.createElement('canvas').getContext('webgl2');
    } catch {
        gl = null;
    }
    if (!gl) {
        return { status: 'no-webgl2', info: 'no webgl2 context', masked: true };
    }

    try {
        // Generic VENDOR/RENDERER always exist but are usually the useless "WebKit / WebKit
        // WebGL"; the real driver strings need the debug extension, which some browsers withhold
        // for fingerprinting reasons.
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = (ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL))
            || gl.getParameter(gl.VENDOR) || 'unknown';
        const renderer = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
            || gl.getParameter(gl.RENDERER) || 'unknown';
        const info = `${vendor} / ${renderer}`;

        return {
            status: isSoftwareRenderer(info) ? 'software' : 'likely-hardware',
            info,
            masked: !ext,
        };
    } catch {
        // A context that answers getParameter with an exception is not one we can judge. Let it
        // through — the renderer will fail loudly on its own if it is genuinely unusable.
        return { status: 'likely-hardware', info: 'unreadable', masked: true };
    } finally {
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* best effort */ }
    }
}

/**
 * Which settings UI to describe first. Straight UA sniffing, which is fine *here* and nowhere else:
 * nothing branches on the answer except the order of some help text, and being wrong costs the
 * reader one glance at the "Other browsers" list below it.
 *
 * @returns {'chromium'|'firefox'|'safari'|'unknown'}
 */
export function detectBrowserFamily(ua = navigator.userAgent || '') {
    if (/Firefox\/|FxiOS/i.test(ua)) return 'firefox';
    // Chromium ships as Chrome, Edg, OPR, Brave, SamsungBrowser… all with the same setting.
    if (/Edg\/|EdgA\/|OPR\/|Chrome\/|CriOS|SamsungBrowser/i.test(ua)) return 'chromium';
    if (/Safari\//i.test(ua)) return 'safari';
    return 'unknown';
}

/**
 * The remediation steps, per browser family. Written as short imperatives because they are read by
 * someone who is already annoyed that a page didn't load.
 *
 * @type {Record<string, {label: string, steps: string[]}>}
 */
export const GPU_HELP_BY_BROWSER = {
    chromium: {
        label: 'Chrome, Edge, Brave, Opera',
        steps: [
            'Open the ⋮ menu → Settings.',
            'Go to System (Edge: System and performance).',
            'Turn on “Use graphics acceleration when available”.',
            'Press Relaunch — the setting only takes effect after a restart.',
        ],
    },
    firefox: {
        label: 'Firefox',
        steps: [
            'Open the ☰ menu → Settings → General.',
            'Scroll down to Performance.',
            'Uncheck “Use recommended performance settings”, then check “Use hardware acceleration when available”.',
            'Restart Firefox.',
        ],
    },
    safari: {
        label: 'Safari',
        steps: [
            'Safari has no acceleration toggle — it is always on.',
            'If you are seeing this, open Develop → Experimental features and make sure WebGL is not disabled.',
            'Otherwise update macOS / iOS; very old versions lack WebGL2.',
        ],
    },
    unknown: {
        label: 'Other browsers',
        steps: [
            'Search your browser’s settings for “hardware acceleration” or “GPU” and turn it on.',
            'Restart the browser afterwards.',
        ],
    },
};

/**
 * Causes that are not a settings toggle, and that people hit often enough to be worth naming — a
 * help panel that only ever says "check your settings" wastes the time of everyone whose settings
 * were already correct.
 */
export const GPU_HELP_CAVEATS = [
    'Remote desktop, virtual machines and some Linux setups have no GPU to accelerate with.',
    'A driver on the browser’s blocklist disables acceleration silently — updating graphics drivers often fixes it.',
    'In Chrome or Edge, paste chrome://gpu (edge://gpu) into the address bar to see what is actually being used.',
];

/**
 * Build the help panel as detached DOM. Returns an element the caller places wherever its own
 * layout wants it; styling lives with each surface (`loader.css`, Devvit's `chrome.css`) under the
 * `gpu-help` class names.
 *
 * Built as nodes rather than an HTML string because the Devvit webview runs under a strict CSP and
 * the embed's own rule is that we never hand a host page markup to parse.
 *
 * @param {object} opts
 * @param {'no-webgl2'|'software'} opts.status Which problem we are explaining.
 * @param {string} [opts.reloadHint] Trailing line — what to do once the setting is changed.
 * @param {string} [opts.extraNote] Surface-specific aside (the Reddit card adds an in-app tip).
 * @returns {HTMLElement}
 */
export function createGpuHelpPanel({ status, reloadHint = 'Then reload this page.', extraNote = '' }) {
    const panel = document.createElement('div');
    panel.className = 'gpu-help';
    panel.setAttribute('role', 'note');

    const title = document.createElement('h2');
    title.className = 'gpu-help-title';
    title.textContent = status === 'software'
        ? 'Running without GPU acceleration'
        : 'This needs GPU hardware acceleration';
    panel.append(title);

    const lede = document.createElement('p');
    lede.className = 'gpu-help-lede';
    lede.textContent = status === 'software'
        ? 'Your browser is drawing WebGL on the CPU, so this will run slowly. Turning on hardware acceleration fixes it:'
        : 'HexLife draws with WebGL2, which your browser can’t provide right now — usually because hardware acceleration is switched off.';
    panel.append(lede);

    if (extraNote) {
        const note = document.createElement('p');
        note.className = 'gpu-help-note';
        note.textContent = extraNote;
        panel.append(note);
    }

    const family = detectBrowserFamily();
    panel.append(stepsBlock(GPU_HELP_BY_BROWSER[family] || GPU_HELP_BY_BROWSER.unknown));

    // Everything we didn't guess, folded away. The reader needs one list, not four — but a wrong
    // guess must not leave them with no instructions at all.
    const others = Object.entries(GPU_HELP_BY_BROWSER).filter(([key]) => key !== family);
    if (others.length) {
        const more = document.createElement('details');
        more.className = 'gpu-help-more';
        const summary = document.createElement('summary');
        summary.textContent = 'Other browsers';
        more.append(summary);
        for (const [, entry] of others) more.append(stepsBlock(entry));
        panel.append(more);
    }

    const caveats = document.createElement('ul');
    caveats.className = 'gpu-help-caveats';
    for (const text of GPU_HELP_CAVEATS) {
        const li = document.createElement('li');
        li.textContent = text;
        caveats.append(li);
    }
    panel.append(caveats);

    const foot = document.createElement('p');
    foot.className = 'gpu-help-foot';
    foot.textContent = reloadHint;
    panel.append(foot);

    return panel;
}

function stepsBlock({ label, steps }) {
    const wrap = document.createElement('div');
    wrap.className = 'gpu-help-block';

    const heading = document.createElement('h3');
    heading.className = 'gpu-help-browser';
    heading.textContent = label;
    wrap.append(heading);

    const list = document.createElement('ol');
    list.className = 'gpu-help-steps';
    for (const step of steps) {
        const li = document.createElement('li');
        li.textContent = step;
        list.append(li);
    }
    wrap.append(list);
    return wrap;
}
