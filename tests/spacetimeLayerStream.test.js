import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootWorker } from './helpers/workerHarness.js';

/**
 * #40 §8.1 as a test rather than a claim: with the spacetime view off, the worker posts **zero**
 * `SPACETIME_LAYER` messages, however many ticks run; with it on, it posts exactly one per advancing
 * tick and stops dead the moment it is disarmed.
 *
 * These run the worker's real `runTickBatch`, not `runTick`, on purpose. A batch runs as many ticks
 * as elapsed time owes and posts ONE `STATE_UPDATE` for all of them, so a layer stream derived
 * anywhere downstream would silently drop layers at speed. Counting layers against ticks across a
 * batch is the only thing that catches that (#40 §1.4).
 */

const TICKS = 40;

/** Drive the worker's setInterval tick loop far enough to owe `ticks` ticks. */
async function runTicks(worker, ticks, speed = 30) {
    await worker.send('SET_SPEED_TARGET', { speed });
    await worker.send('START_SIMULATION', {});
    // The batch accumulator books ticks from elapsed wall-clock time, so the fake clock has to move
    // `performance.now()` too — see the `toFake` list below. Advance one interval at a time: a
    // single long jump would be capped at a second of catch-up debt and run far fewer ticks.
    for (let i = 0; i < ticks; i++) await vi.advanceTimersByTimeAsync(1000 / speed);
    await worker.send('STOP_SIMULATION', {});
}

describe('the spacetime layer stream costs nothing while the view is closed (#40 §8.1)', () => {
    beforeEach(() => {
        // `performance` has to be faked as well as the timers: runTickBatch decides how many ticks
        // it owes from `performance.now()` deltas, so a fake setInterval over a real clock fires the
        // callback and then books zero ticks.
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date', 'performance'] });
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.doUnmock('../src/core/wasm-engine/hexlife_wasm.js');
        delete globalThis.self;
    });

    it('posts no layer message at all over a long run with the mode off', async () => {
        const worker = await bootWorker();
        worker.reset();
        await runTicks(worker, TICKS);

        const counts = worker.typeCounts();
        expect(counts.SPACETIME_LAYER ?? 0).toBe(0);
        expect(counts.SPACETIME_BACKFILL ?? 0).toBe(0);
        expect(counts.SPACETIME_RESET ?? 0).toBe(0);
        expect(counts.SPACETIME_TRUNCATE ?? 0).toBe(0);
        // The ticks really happened — otherwise this would pass for the wrong reason.
        expect(worker.world.tick).toBeGreaterThanOrEqual(TICKS - 2);
        // And the Rust staging buffer was never asked for, so nothing was allocated for it.
        expect(worker.world.renderLayerEnabled).toBe(false);
    });

    it('posts exactly one layer per advancing tick once armed, batching included', async () => {
        const worker = await bootWorker();
        await worker.send('SET_HISTORY_CAPTURE', { enabled: true });
        await worker.send('SET_SPACETIME_CAPTURE', { enabled: true });
        expect(worker.world.renderLayerEnabled).toBe(true);

        const ticksBefore = worker.world.tick;
        worker.reset();
        await runTicks(worker, TICKS);
        const ticksRun = worker.world.tick - ticksBefore;

        expect(ticksRun).toBeGreaterThan(0);
        expect(worker.typeCounts().SPACETIME_LAYER).toBe(ticksRun);
    });

    it('keeps one layer per tick when a single batch runs many ticks', async () => {
        // The trap this exists for: `runTickBatch` services all the ticks elapsed time owes in ONE
        // timer fire and posts a single STATE_UPDATE for the lot. Anything deriving layers from that
        // update — or from the render loop — would ship one layer where fifty ticks happened.
        const worker = await bootWorker();
        await worker.send('SET_HISTORY_CAPTURE', { enabled: true });
        await worker.send('SET_SPACETIME_CAPTURE', { enabled: true });
        await worker.send('SET_SPEED_TARGET', { speed: 200 });
        await worker.send('START_SIMULATION', {});

        const ticksBefore = worker.world.tick;
        worker.reset();
        await vi.advanceTimersByTimeAsync(250); // ~50 ticks owed, serviced in very few fires
        await worker.send('STOP_SIMULATION', {});
        const ticksRun = worker.world.tick - ticksBefore;

        expect(ticksRun).toBeGreaterThan(10);
        const counts = worker.typeCounts();
        expect(counts.SPACETIME_LAYER).toBe(ticksRun);
        // The state updates really were batched — this is the loss the stream had to avoid.
        expect(counts.STATE_UPDATE ?? 0).toBeLessThan(ticksRun);
    });

    it('ships the ring it already holds when armed, and nothing when the ring is empty', async () => {
        const worker = await bootWorker();
        await worker.send('SET_HISTORY_CAPTURE', { enabled: true });
        await runTicks(worker, 12);

        worker.reset();
        await worker.send('SET_SPACETIME_CAPTURE', { enabled: true });
        const [backfill] = worker.messagesOfType('SPACETIME_BACKFILL');
        expect(backfill).toBeDefined();
        expect(backfill.count).toBeGreaterThan(0);
        expect(backfill.layersBuffer.byteLength).toBe(backfill.count * backfill.numCells);
        expect(typeof backfill.buildMs).toBe('number');
        // The object appears already grown; it does not rebuild itself over the next 240 ticks.
        expect(backfill.count).toBe(worker.world.tick);
    });

    it('stops dead when disarmed and releases the staging buffer', async () => {
        const worker = await bootWorker();
        await worker.send('SET_HISTORY_CAPTURE', { enabled: true });
        await worker.send('SET_SPACETIME_CAPTURE', { enabled: true });
        await runTicks(worker, 10);

        await worker.send('SET_SPACETIME_CAPTURE', { enabled: false });
        expect(worker.world.renderLayerEnabled).toBe(false);

        worker.reset();
        await runTicks(worker, TICKS);
        expect(worker.typeCounts().SPACETIME_LAYER ?? 0).toBe(0);
    });

    it('mirrors the ring: a reset empties the volume, a scrub-resume truncates it', async () => {
        const worker = await bootWorker();
        await worker.send('SET_HISTORY_CAPTURE', { enabled: true });
        await worker.send('SET_SPACETIME_CAPTURE', { enabled: true });
        await runTicks(worker, 20);

        // Park 5 ticks back, then resume: the recorded future is discarded, and the volume must
        // lose exactly the same layers or the object stops agreeing with the transport bar.
        worker.reset();
        await worker.send('STATE_HISTORY_SCRUB', { offset: 5 });
        await worker.send('STATE_HISTORY_RESUME', {});
        const [truncate] = worker.messagesOfType('SPACETIME_TRUNCATE');
        expect(truncate).toBeDefined();
        expect(truncate.length).toBeGreaterThan(0);

        // A reset is a new timeline: the object vanishes rather than splicing two histories.
        worker.reset();
        await worker.send('RESET_WORLD', {
            seed: 999,
            initialState: { mode: 'density', params: { density: 0.35 } },
        });
        expect(worker.typeCounts().SPACETIME_RESET).toBe(1);
    });

    it('packs the byte the shader indexes the palette with', async () => {
        const worker = await bootWorker({ cols: 8, rows: 6 });
        await worker.send('SET_HISTORY_CAPTURE', { enabled: true });
        await worker.send('SET_SPACETIME_CAPTURE', { enabled: true });
        worker.reset();
        await runTicks(worker, 3);

        const [layer] = worker.messagesOfType('SPACETIME_LAYER');
        expect(layer).toBeDefined();
        expect(layer.layerBuffer.byteLength).toBe(8 * 6);
        // Low bit is the state, high seven are the rule index — a direct index into the 128x2 LUT.
        const bytes = new Uint8Array(layer.layerBuffer);
        expect(bytes.every((b) => b >= 0 && b <= 255)).toBe(true);
        expect(new Set(bytes.map((b) => b & 1)).size).toBeGreaterThan(0);
    });
});
