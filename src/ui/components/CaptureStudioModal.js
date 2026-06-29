import { BaseComponent } from './BaseComponent.js';
import { EVENTS } from '../../services/EventBus.js';
import { SliderComponent } from './SliderComponent.js';
import { ICONS } from '../icons.js';
import * as Renderer from '../../rendering/renderer.js';
import {
    STILL_PRESETS,
    VIDEO_PRESETS,
    resolvePresetDimensions,
    clampGifDimensions,
    estimateGifBudget,
    formatBytes,
} from '../../services/CaptureService.js';

const MAX_CUSTOM = 8192;
const MIN_CUSTOM = 16;

/**
 * Capture Studio — a dedicated modal for configurable screenshots (PNG/JPEG) and recordings
 * (WebM/animated GIF) of the selected world or the full as-seen canvas, at an arbitrary resolution.
 * Drives {@link CaptureService}; carries a live preview and a recording HUD that survives modal close.
 */
export class CaptureStudioModal extends BaseComponent {
    constructor(mountPoint, appContext) {
        super(mountPoint);
        this.appContext = appContext;
        this.capture = appContext.captureService;
        this.settings = this.capture.loadSettings();
        this.sliders = {};
        this._previewTimer = 0;
        this._visible = false;
        this.render();
        this._buildHud();
        this.hide();
        this._subscribeToEvent(EVENTS.WORLD_RECORDING_STATE_CHANGED, this._onRecordingState);
        this._subscribeToEvent(EVENTS.CAPTURE_RECORDING_PROGRESS, this._onProgress);
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'capture-studio-modal';
        this.element.className = 'modal-overlay hidden';
        this.element.innerHTML = `
            <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="capture-studio-title">
                <h3 id="capture-studio-title">${ICONS.camera} Capture Studio</h3>
                <button class="modal-close-button" aria-label="Close">&times;</button>

                <div class="cs-tabs" role="tablist" aria-label="Capture type">
                    <button type="button" class="cs-tab" data-tab="screenshot" role="tab">${ICONS.camera}<span>Screenshot</span></button>
                    <button type="button" class="cs-tab" data-tab="video" role="tab">${ICONS.video}<span>Video</span></button>
                </div>

                <div class="cs-preview-block">
                    <canvas class="cs-preview-canvas" aria-label="Capture preview"></canvas>
                    <div class="cs-preview-meta">
                        <span class="cs-source-label"></span>
                        <span class="cs-dims-label"></span>
                    </div>
                </div>

                <div class="cs-field">
                    <span class="cs-field-label">What to capture</span>
                    <div class="cs-segmented" data-group="source" role="group" aria-label="Capture source">
                        <button type="button" data-value="selected">Selected world</button>
                        <button type="button" data-value="canvas">Full canvas</button>
                    </div>
                </div>

                <div class="cs-field">
                    <span class="cs-field-label">Resolution</span>
                    <div class="cs-res-row">
                        <select class="cs-preset-select" aria-label="Resolution preset"></select>
                        <label class="cs-custom-toggle"><input type="checkbox" class="cs-custom-check"> Custom</label>
                    </div>
                    <div class="cs-custom-row hidden">
                        <input type="number" class="cs-custom-w" min="${MIN_CUSTOM}" max="${MAX_CUSTOM}" step="1" aria-label="Custom width">
                        <span class="cs-custom-x">×</span>
                        <input type="number" class="cs-custom-h" min="${MIN_CUSTOM}" max="${MAX_CUSTOM}" step="1" aria-label="Custom height">
                        <span class="cs-custom-unit">px</span>
                    </div>
                </div>

                <!-- Screenshot panel -->
                <div class="cs-panel cs-panel-screenshot">
                    <div class="cs-field">
                        <span class="cs-field-label">Format</span>
                        <div class="cs-segmented" data-group="stillFormat" role="group" aria-label="Image format">
                            <button type="button" data-value="png">PNG</button>
                            <button type="button" data-value="jpeg">JPEG</button>
                        </div>
                    </div>
                    <div class="cs-field cs-jpeg-quality"></div>
                </div>

                <!-- Video panel -->
                <div class="cs-panel cs-panel-video">
                    <div class="cs-field">
                        <span class="cs-field-label">Format</span>
                        <div class="cs-segmented" data-group="videoFormat" role="group" aria-label="Video format">
                            <button type="button" data-value="webm">WebM</button>
                            <button type="button" data-value="gif">GIF</button>
                        </div>
                    </div>
                    <div class="cs-field cs-fps"></div>
                    <div class="cs-field cs-webm-quality"></div>
                    <div class="cs-field cs-duration"></div>
                    <p class="cs-gif-budget info-text hidden"></p>
                    <p class="cs-rec-status info-text hidden" role="status"></p>
                </div>

                <div class="modal-actions">
                    <button class="button" data-action="close">Close</button>
                    <button class="button cs-primary" data-action="primary"></button>
                </div>
            </div>
        `;
        this.mountPoint.appendChild(this.element);

        this.ui = {
            content: this.element.querySelector('.modal-content'),
            closeBtn: this.element.querySelector('.modal-close-button'),
            tabs: Array.from(this.element.querySelectorAll('.cs-tab')),
            preview: this.element.querySelector('.cs-preview-canvas'),
            sourceLabel: this.element.querySelector('.cs-source-label'),
            dimsLabel: this.element.querySelector('.cs-dims-label'),
            sourceGroup: this.element.querySelector('[data-group="source"]'),
            presetSelect: this.element.querySelector('.cs-preset-select'),
            customCheck: this.element.querySelector('.cs-custom-check'),
            customRow: this.element.querySelector('.cs-custom-row'),
            customW: this.element.querySelector('.cs-custom-w'),
            customH: this.element.querySelector('.cs-custom-h'),
            panelStill: this.element.querySelector('.cs-panel-screenshot'),
            panelVideo: this.element.querySelector('.cs-panel-video'),
            stillFormatGroup: this.element.querySelector('[data-group="stillFormat"]'),
            jpegQuality: this.element.querySelector('.cs-jpeg-quality'),
            videoFormatGroup: this.element.querySelector('[data-group="videoFormat"]'),
            fps: this.element.querySelector('.cs-fps'),
            webmQuality: this.element.querySelector('.cs-webm-quality'),
            duration: this.element.querySelector('.cs-duration'),
            gifBudget: this.element.querySelector('.cs-gif-budget'),
            recStatus: this.element.querySelector('.cs-rec-status'),
            primaryBtn: this.element.querySelector('.cs-primary'),
            closeActionBtn: this.element.querySelector('[data-action="close"]'),
        };

        this._buildSliders();
        this._attachListeners();
    }

    _buildSliders() {
        this.sliders.jpegQuality = new SliderComponent(this.ui.jpegQuality, {
            id: 'cs-jpeg-quality', label: 'Quality', min: 0.3, max: 1, step: 0.05,
            value: this.settings.stillQuality, showValue: true,
            onInput: (v) => { this.settings.stillQuality = v; this._persist(); },
        });
        this.sliders.fps = new SliderComponent(this.ui.fps, {
            id: 'cs-fps', label: 'Frame rate', min: 5, max: 60, step: 1, unit: 'fps',
            value: this.settings.fps, showValue: true,
            onInput: (v) => { this.settings.fps = v; this._persist(); this._updateBudget(); },
        });
        this.sliders.webmQuality = new SliderComponent(this.ui.webmQuality, {
            id: 'cs-webm-quality', label: 'Quality', min: 0.2, max: 1, step: 0.05,
            value: this.settings.videoQuality, showValue: true,
            onInput: (v) => { this.settings.videoQuality = v; this._persist(); },
        });
        this.sliders.duration = new SliderComponent(this.ui.duration, {
            id: 'cs-duration', label: 'Max length', min: 1, max: 60, step: 1, unit: 's',
            value: this.settings.maxDurationSec, showValue: true,
            onInput: (v) => { this.settings.maxDurationSec = v; this._persist(); this._updateBudget(); },
        });
    }

    _attachListeners() {
        this._addDOMListener(this.ui.closeBtn, 'click', this.hide);
        this._addDOMListener(this.ui.closeActionBtn, 'click', this.hide);
        this._addDOMListener(this.element, 'click', (e) => { if (e.target === this.element) this.hide(); });

        this.ui.tabs.forEach((tab) => {
            this._addDOMListener(tab, 'click', () => { this.settings.tab = tab.dataset.tab; this._persist(); this._syncAll(); });
        });

        this._wireSegmented(this.ui.sourceGroup, (v) => {
            this.settings.source = v;
            this._ensureValidPreset();
            this._persist();
            this._syncAll();
        });
        this._wireSegmented(this.ui.stillFormatGroup, (v) => { this.settings.stillFormat = v; this._persist(); this._syncFormatVisibility(); });
        this._wireSegmented(this.ui.videoFormatGroup, (v) => { this.settings.videoFormat = v; this._persist(); this._syncFormatVisibility(); });

        this._addDOMListener(this.ui.presetSelect, 'change', (e) => {
            if (this.settings.tab === 'screenshot') this.settings.stillPreset = e.target.value;
            else this.settings.videoPreset = e.target.value;
            this._persist();
            this._updateDims();
        });
        this._addDOMListener(this.ui.customCheck, 'change', (e) => {
            this.settings.useCustom = e.target.checked;
            this._persist();
            this._syncCustomVisibility();
            this._updateDims();
        });
        this._addDOMListener(this.ui.customW, 'change', (e) => { this.settings.customWidth = this._clampCustom(e.target.value); e.target.value = this.settings.customWidth; this._persist(); this._updateDims(); });
        this._addDOMListener(this.ui.customH, 'change', (e) => { this.settings.customHeight = this._clampCustom(e.target.value); e.target.value = this.settings.customHeight; this._persist(); this._updateDims(); });

        this._addDOMListener(this.ui.primaryBtn, 'click', this._onPrimary);
    }

    _wireSegmented(group, onChange) {
        group.querySelectorAll('button').forEach((btn) => {
            this._addDOMListener(btn, 'click', () => onChange(btn.dataset.value));
        });
    }

    // ---- show / hide ----
    show = (opts = {}) => {
        // `this.settings` is the live source of truth (persisted on every change; seeded from saved
        // settings at construction for cross-session recall) — only the requested tab is overridden.
        if (opts && opts.tab) this.settings.tab = opts.tab;
        this._ensureValidPreset();
        this.element.classList.remove('hidden');
        this._visible = true;
        this._syncAll();
        this._startPreview();
    };

    hide = () => {
        this.element.classList.add('hidden');
        this._visible = false;
        this._stopPreview();
    };

    // ---- sync UI from settings ----
    _syncAll() {
        // Tabs / panels
        this.ui.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === this.settings.tab));
        const isStill = this.settings.tab === 'screenshot';
        this.ui.panelStill.classList.toggle('hidden', !isStill);
        this.ui.panelVideo.classList.toggle('hidden', isStill);

        this._syncSegmented(this.ui.sourceGroup, this.settings.source);
        this._syncSegmented(this.ui.stillFormatGroup, this.settings.stillFormat);
        this._syncSegmented(this.ui.videoFormatGroup, this.settings.videoFormat);

        this.ui.customCheck.checked = !!this.settings.useCustom;
        this.ui.customW.value = this.settings.customWidth;
        this.ui.customH.value = this.settings.customHeight;

        this._rebuildPresetOptions();
        this._syncCustomVisibility();
        this._syncFormatVisibility();
        this._syncRecordingUi(this.capture.isRecording);
        this._updateDims();
    }

    _syncSegmented(group, value) {
        group.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === value));
    }

    _rebuildPresetOptions() {
        const table = this.settings.tab === 'screenshot' ? STILL_PRESETS : VIDEO_PRESETS;
        const list = table[this.settings.source] || table.selected;
        const current = this.settings.tab === 'screenshot' ? this.settings.stillPreset : this.settings.videoPreset;
        this.ui.presetSelect.innerHTML = list.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');
        this.ui.presetSelect.value = list.some((p) => p.id === current) ? current : list[0].id;
    }

    _ensureValidPreset() {
        const valid = (table) => {
            const list = (this.settings.tab === 'screenshot' ? STILL_PRESETS : VIDEO_PRESETS)[this.settings.source] || [];
            return list.some((p) => p.id === table);
        };
        if (this.settings.tab === 'screenshot' && !valid(this.settings.stillPreset)) this.settings.stillPreset = 'native';
        if (this.settings.tab === 'video' && !valid(this.settings.videoPreset)) this.settings.videoPreset = 'native';
    }

    _syncCustomVisibility() {
        this.ui.customRow.classList.toggle('hidden', !this.settings.useCustom);
        this.ui.presetSelect.disabled = !!this.settings.useCustom;
    }

    _syncFormatVisibility() {
        this.ui.jpegQuality.classList.toggle('hidden', this.settings.stillFormat !== 'jpeg');
        const isGif = this.settings.videoFormat === 'gif';
        this.ui.webmQuality.classList.toggle('hidden', isGif);
        this.ui.gifBudget.classList.toggle('hidden', !isGif);
        this._updateBudget();
    }

    _syncRecordingUi(recording) {
        const isVideo = this.settings.tab === 'video';
        if (recording) {
            this.ui.primaryBtn.innerHTML = `${ICONS.stopCircle} Stop &amp; Save`;
            this.ui.primaryBtn.classList.add('is-recording');
            this.ui.recStatus.classList.toggle('hidden', !isVideo);
            // Lock option controls while recording.
            this._setOptionsDisabled(true);
        } else {
            this.ui.primaryBtn.innerHTML = isVideo
                ? `${ICONS.video} Start recording`
                : `${ICONS.camera} Capture &amp; Download`;
            this.ui.primaryBtn.classList.remove('is-recording');
            this.ui.recStatus.classList.add('hidden');
            this._setOptionsDisabled(false);
        }
    }

    _setOptionsDisabled(disabled) {
        this.ui.tabs.forEach((t) => { t.disabled = disabled; });
        this.element.querySelectorAll('.cs-segmented button, .cs-preset-select, .cs-custom-check, .cs-custom-w, .cs-custom-h')
            .forEach((el) => { el.disabled = disabled; });
    }

    // ---- dimensions / budget ----
    _clampCustom(v) {
        const n = Math.round(Number(v) || 0);
        return Math.min(MAX_CUSTOM, Math.max(MIN_CUSTOM, n));
    }

    _currentDims() {
        if (this.settings.useCustom) {
            return { width: this._clampCustom(this.settings.customWidth), height: this._clampCustom(this.settings.customHeight) };
        }
        const live = Renderer.getCanvasElement && Renderer.getCanvasElement();
        const preset = this.settings.tab === 'screenshot' ? this.settings.stillPreset : this.settings.videoPreset;
        return resolvePresetDimensions(preset, {
            source: this.settings.source,
            liveWidth: live ? live.width : undefined,
            liveHeight: live ? live.height : undefined,
        });
    }

    _updateDims() {
        const { width, height } = this._currentDims();
        this.ui.dimsLabel.textContent = `${width} × ${height} px`;
        this.ui.sourceLabel.textContent = this.settings.source === 'selected' ? 'Selected world' : 'Full canvas';
        this._resizePreview();
        this._updateBudget();
        this._refreshPreview();
    }

    _updateBudget() {
        if (this.settings.videoFormat !== 'gif' || this.settings.tab !== 'video') return;
        const raw = this._currentDims();
        // GIF frames are held in memory, so the recorder clamps the longest edge — reflect the
        // real (clamped) resolution in the budget so the size estimate is honest.
        const { width, height } = clampGifDimensions(raw.width, raw.height);
        const { frames, approxBytes } = estimateGifBudget(width, height, this.settings.fps, this.settings.maxDurationSec);
        this.ui.gifBudget.textContent = `GIF capped to ${width}×${height} · ~${frames} frames · ~${formatBytes(approxBytes)}.`;
    }

    // ---- preview ----
    _resizePreview() {
        const { width, height } = this._currentDims();
        const aspect = height ? width / height : 1;
        const maxEdge = 360;
        let pw = maxEdge, ph = maxEdge;
        if (aspect >= 1) ph = Math.round(maxEdge / aspect);
        else pw = Math.round(maxEdge * aspect);
        this.ui.preview.width = pw;
        this.ui.preview.height = ph;
    }

    _startPreview() {
        this._stopPreview();
        this._resizePreview();
        this._refreshPreview();
        this._previewTimer = setInterval(() => this._refreshPreview(), 250);
    }

    _stopPreview() {
        if (this._previewTimer) clearInterval(this._previewTimer);
        this._previewTimer = 0;
    }

    _refreshPreview() {
        if (!this._visible) return;
        const ctx = this.ui.preview.getContext('2d');
        if (!ctx) return;
        const selectedIndex = this.appContext.worldManager.getSelectedWorldIndex();
        Renderer.composeCaptureFrame(ctx, {
            source: this.settings.source,
            width: this.ui.preview.width,
            height: this.ui.preview.height,
            selectedIndex,
        });
    }

    // ---- actions ----
    _onPrimary = () => {
        if (this.settings.tab === 'screenshot') {
            const { width, height } = this._currentDims();
            this.capture.captureStill({ source: this.settings.source, width, height, format: this.settings.stillFormat, quality: this.settings.stillQuality });
            return;
        }
        // video
        if (this.capture.isRecording) {
            this.capture.stopRecording();
            return;
        }
        const { width, height } = this._currentDims();
        const started = this.capture.startRecording({
            source: this.settings.source,
            width, height,
            format: this.settings.videoFormat,
            fps: this.settings.fps,
            quality: this.settings.videoQuality,
            maxDurationSec: this.settings.maxDurationSec,
        });
        // Get out of the user's way: recording behind a full-screen modal is pointless. The draggable
        // HUD (and the V / Shift+V hotkeys) take over from here.
        if (started) this.hide();
    };

    _persist() {
        this.capture.saveSettings(this.settings);
    }

    // ---- recording HUD (lives on body, draggable, survives modal close) ----
    _buildHud() {
        this.hud = document.createElement('div');
        this.hud.id = 'capture-rec-hud';
        this.hud.className = 'hidden';
        this.hud.innerHTML = `
            <span class="cs-hud-grip" aria-hidden="true" title="Drag to move">${ICONS.gripVertical || '⠿'}</span>
            <span class="cs-hud-dot" aria-hidden="true"></span>
            <span class="cs-hud-time">0:00</span>
            <span class="cs-hud-size"></span>
            <button type="button" class="cs-hud-pause" title="Pause / resume (Shift+V)">${ICONS.pause} Pause</button>
            <button type="button" class="cs-hud-stop" title="Stop & save (V)">${ICONS.stopCircle} Stop</button>
        `;
        document.body.appendChild(this.hud);
        this.hudUi = {
            grip: this.hud.querySelector('.cs-hud-grip'),
            dot: this.hud.querySelector('.cs-hud-dot'),
            time: this.hud.querySelector('.cs-hud-time'),
            size: this.hud.querySelector('.cs-hud-size'),
            pause: this.hud.querySelector('.cs-hud-pause'),
            stop: this.hud.querySelector('.cs-hud-stop'),
        };
        this._addDOMListener(this.hudUi.stop, 'click', () => this.capture.stopRecording());
        this._addDOMListener(this.hudUi.pause, 'click', () => this.capture.togglePause());
        this._initHudDrag();
        this._restoreHudPosition();
    }

    _initHudDrag() {
        let dragging = false;
        let startX = 0, startY = 0, originLeft = 0, originTop = 0;
        const onDown = (e) => {
            // Don't start a drag from the action buttons.
            if (e.target.closest('button')) return;
            dragging = true;
            const r = this.hud.getBoundingClientRect();
            originLeft = r.left;
            originTop = r.top;
            startX = e.clientX;
            startY = e.clientY;
            // Switch from the centering transform to absolute left/top so dragging is 1:1.
            this.hud.style.transform = 'none';
            this.hud.style.left = `${originLeft}px`;
            this.hud.style.top = `${originTop}px`;
            this.hud.classList.add('is-dragging');
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            e.preventDefault();
        };
        const onMove = (e) => {
            if (!dragging) return;
            const w = this.hud.offsetWidth, h = this.hud.offsetHeight;
            const left = Math.min(window.innerWidth - w, Math.max(0, originLeft + (e.clientX - startX)));
            const top = Math.min(window.innerHeight - h, Math.max(0, originTop + (e.clientY - startY)));
            this.hud.style.left = `${left}px`;
            this.hud.style.top = `${top}px`;
        };
        const onUp = () => {
            dragging = false;
            this.hud.classList.remove('is-dragging');
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            this.appContext.persistenceService.saveUISetting('captureHudPos', {
                left: parseInt(this.hud.style.left, 10),
                top: parseInt(this.hud.style.top, 10),
            });
        };
        this._addDOMListener(this.hud, 'pointerdown', onDown);
    }

    _restoreHudPosition() {
        const pos = this.appContext.persistenceService.loadUISetting('captureHudPos', null);
        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
            const left = Math.min(window.innerWidth - 80, Math.max(0, pos.left));
            const top = Math.min(window.innerHeight - 40, Math.max(0, pos.top));
            this.hud.style.transform = 'none';
            this.hud.style.left = `${left}px`;
            this.hud.style.top = `${top}px`;
        }
    }

    _onRecordingState = ({ recording }) => {
        this.hud.classList.toggle('hidden', !recording);
        if (recording) {
            this._restoreHudPosition();
        } else {
            this.hudUi.time.textContent = '0:00';
            this.hudUi.size.textContent = '';
            this._setHudPaused(false);
        }
        this._syncRecordingUi(recording);
    };

    _setHudPaused(paused) {
        this.hud.classList.toggle('is-paused', paused);
        this.hudUi.pause.innerHTML = paused ? `${ICONS.play} Resume` : `${ICONS.pause} Pause`;
    }

    _onProgress = ({ elapsedMs, frames, format, estBytes, paused }) => {
        const total = Math.floor(elapsedMs / 1000);
        const mm = Math.floor(total / 60);
        const ss = String(total % 60).padStart(2, '0');
        const time = `${mm}:${ss}`;
        const sizeStr = `~${formatBytes(estBytes)}`;
        this.hudUi.time.textContent = paused ? `${time} (paused)` : time;
        this.hudUi.size.textContent = sizeStr;
        this._setHudPaused(!!paused);
        if (this._visible && this.settings.tab === 'video') {
            const frameStr = format === 'gif' && frames != null ? ` · ${frames} frames` : '';
            const state = paused ? 'Paused' : 'Recording';
            this.ui.recStatus.textContent = `● ${state} ${format.toUpperCase()} — ${time} · ${sizeStr}${frameStr}`;
        }
    };
}
