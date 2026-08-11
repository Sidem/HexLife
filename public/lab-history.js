/**
 * What a lab remembers about what it has already done.
 *
 * Two kinds of memory, both DOM-free and Wasm-free so they can be unit-tested, and both shared by
 * pages that are copied verbatim out of `public/`:
 *
 * - `RunHistory` — the whole of ONE run as a time series. Used by Outbreak Counterfactuals, where
 *   the interesting quantity is not the current generation but the shape of the entire epidemic.
 * - `pushRunEntry` / `bestRunIndex` — a log of MANY finished runs, one row per configuration. Used
 *   by the coffee labs, where a brew ends and the question is how this recipe did against the last
 *   six.
 *
 * Neither of them samples the simulation: the host hands over the bounded aggregates it already read
 * for its own readout, so remembering a run costs no extra boundary crossing per tick.
 */

/**
 * A whole run as a fixed-memory time series.
 *
 * A run has no length limit — an outbreak can settle in 200 generations or ring for 20,000 — so the
 * series THINS rather than scrolls: at capacity it drops every other sample and halves its sampling
 * rate, which keeps the memory bounded while the x-axis still spans the whole run. That is the
 * opposite of the rolling window the demos' small trace canvas uses, and it is the point: a window
 * shows you the last few seconds, this shows you the run.
 *
 * Thinning loses samples, so peaks are tracked over EVERY sample pushed rather than over what was
 * kept. The curve on screen may not go through the peak; the number printed beside it is exact.
 */
export class RunHistory {
    #channels;
    #capacity;
    #markLimit;
    #generations = [];
    #series = [];
    #peaks = [];
    #marks = [];
    #stride = 1;
    #countdown = 0;
    #lastGeneration = -Infinity;

    /**
     * @param {{channels: string[], capacity?: number, markLimit?: number}} options `capacity` is the
     *   most samples ever held, not the most ever seen.
     */
    constructor({channels, capacity = 480, markLimit = 24}) {
        if (!Array.isArray(channels) || channels.length === 0) {
            throw new RangeError('RunHistory needs at least one channel.');
        }
        if (!Number.isInteger(capacity) || capacity < 4) {
            throw new RangeError('capacity must be an integer of at least 4.');
        }
        this.#channels = [...channels];
        this.#capacity = capacity;
        this.#markLimit = markLimit;
        this.clear();
    }

    get channels() { return [...this.#channels]; }
    /** How many samples are held right now — never more than `capacity`. */
    get length() { return this.#generations.length; }
    /** How many pushes there are between two held samples. 1 until the first thinning. */
    get stride() { return this.#stride; }
    get generations() { return this.#generations; }
    get marks() { return this.#marks; }
    /** The generation of the newest sample seen, thinned away or not. */
    get lastGeneration() { return Number.isFinite(this.#lastGeneration) ? this.#lastGeneration : 0; }

    clear() {
        this.#generations = [];
        this.#series = this.#channels.map(() => []);
        this.#peaks = this.#channels.map(() => ({value: 0, generation: 0}));
        this.#marks = [];
        this.#stride = 1;
        this.#countdown = 0;
        this.#lastGeneration = -Infinity;
    }

    /**
     * Record one sample.
     *
     * Generations must arrive in strictly increasing order; a repeat is ignored rather than
     * appended, because the host's readout is refreshed by things other than a tick — a recompiled
     * rule, an intervention, a resized world — and none of those advance the run.
     *
     * @param {number} generation
     * @param {number[]} values One per channel, in the order the channels were declared.
     * @returns {boolean} Whether the sample was kept. `false` also means "thinned away", not "bad".
     */
    push(generation, values) {
        if (!Number.isFinite(generation) || generation <= this.#lastGeneration) return false;
        if (!Array.isArray(values) || values.length !== this.#channels.length) {
            throw new RangeError(`RunHistory.push expects ${this.#channels.length} values.`);
        }
        this.#lastGeneration = generation;
        // Peaks first, and unconditionally: this is the half of the record thinning may not touch.
        for (let channel = 0; channel < values.length; channel++) {
            const value = Number(values[channel]) || 0;
            if (value > this.#peaks[channel].value) this.#peaks[channel] = {value, generation};
        }
        if (this.#countdown > 0) {
            this.#countdown--;
            return false;
        }
        this.#countdown = this.#stride - 1;
        this.#generations.push(generation);
        for (let channel = 0; channel < values.length; channel++) {
            this.#series[channel].push(Number(values[channel]) || 0);
        }
        if (this.#generations.length > this.#capacity) this.#thin();
        return true;
    }

    /** Note something the operator did at this generation, for the chart's rules and the event log. */
    mark(generation, label) {
        if (!Number.isFinite(generation)) return;
        this.#marks.push({generation, label: String(label)});
        if (this.#marks.length > this.#markLimit) this.#marks.splice(0, this.#marks.length - this.#markLimit);
    }

    /** @param {string} name @returns {number[]} The kept samples of one channel. */
    channel(name) {
        const index = this.#channels.indexOf(name);
        if (index < 0) throw new RangeError(`Unknown channel: ${name}`);
        return this.#series[index];
    }

    /** @param {string} name @returns {{value: number, generation: number}} Exact, never thinned. */
    peak(name) {
        const index = this.#channels.indexOf(name);
        if (index < 0) throw new RangeError(`Unknown channel: ${name}`);
        return {...this.#peaks[index]};
    }

    /** The largest value held across the named channels, for a shared chart axis. */
    ceiling(names = this.#channels) {
        let max = 0;
        for (const name of names) {
            for (const value of this.channel(name)) if (value > max) max = value;
        }
        return max;
    }

    /** The held samples as row objects — what `toCsv` and any export want. */
    records() {
        return this.#generations.map((generation, index) => {
            const row = {generation};
            for (let channel = 0; channel < this.#channels.length; channel++) {
                row[this.#channels[channel]] = this.#series[channel][index];
            }
            return row;
        });
    }

    /** Halve the resolution: drop every other sample, and keep only every other future one. */
    #thin() {
        const keep = (list) => {
            let write = 0;
            for (let read = 0; read < list.length; read += 2) list[write++] = list[read];
            list.length = write;
        };
        keep(this.#generations);
        for (const series of this.#series) keep(series);
        this.#stride *= 2;
        this.#countdown = this.#stride - 1;
    }
}

/**
 * Add a finished run to a log, newest first.
 *
 * Newest first because the row you want to compare against is almost always the one you just ran,
 * and because a log that grows downward pushes the interesting end off the bottom of a fixed-height
 * panel. Mutates and returns the same array so a page can hold one `const`.
 *
 * @template T
 * @param {T[]} runs
 * @param {T} entry
 * @param {{limit?: number}} options
 * @returns {T[]}
 */
export function pushRunEntry(runs, entry, {limit = 25} = {}) {
    runs.unshift(entry);
    if (runs.length > limit) runs.length = limit;
    return runs;
}

/**
 * Which logged run scored highest on `key`. `-1` when nothing has a finite score there.
 *
 * Ties go to the OLDEST run — the first configuration to reach a score keeps the crown, so re-running
 * the same recipe does not keep moving the marker around for no reason.
 */
export function bestRunIndex(runs, key) {
    let best = -1;
    let bestValue = -Infinity;
    // The array is newest-first, so scanning forward with `>=` walks a tie back to the older run.
    for (let index = 0; index < runs.length; index++) {
        const value = Number(runs[index]?.[key]);
        if (!Number.isFinite(value)) continue;
        if (value >= bestValue) { best = index; bestValue = value; }
    }
    return best;
}

/**
 * Rows of objects as CSV, so a run log or a run history can leave the page and go into a spreadsheet.
 *
 * @param {{key: string, label?: string}[]} columns
 * @param {Record<string, unknown>[]} rows
 * @returns {string}
 */
export function toCsv(columns, rows) {
    const cell = (value) => {
        if (value === null || value === undefined) return '';
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const header = columns.map((column) => cell(column.label ?? column.key)).join(',');
    const body = rows.map((row) => columns.map((column) => cell(row[column.key])).join(','));
    return [header, ...body].join('\n');
}
