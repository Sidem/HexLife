#!/usr/bin/env node
// @ts-check

/**
 * Merge a personal-library pack into the committed public catalog (`src/core/library/rulesets.json`).
 *
 * **Owner tool, not the community path.** A community addition goes through the prefilled GitHub
 * issue in `src/services/LibrarySubmission.js`, where a reviewer assigns credit and checks the entry
 * against the intake bar. This script is the other end of that pipe: the maintainer *is* the
 * reviewer, and the review artifact is the git diff. Filing an issue against your own repository and
 * then hand-merging its JSON is ceremony with no reviewer on the other side.
 *
 * It deliberately reuses the exact codecs the app uses rather than reimplementing the shape:
 * `decodePack` sanitizes (the pack file is untrusted input like any download) and
 * `toPublicLibraryEntry` projects to the committed shape. If those change, this follows for free.
 *
 * Those modules reach `config.js`, which imports `neighbor-dirs.json` extensionless — a Vite-ism
 * plain Node rejects — so they are loaded through Vite's own resolver rather than duplicated here.
 * Duplicating the projection is what would let the catalog shape silently drift.
 *
 * Dedupes **by hex**, like `mergeRulesets` — a catalog entry is its rule table; names are labels.
 *
 * Usage:
 *   node scripts/merge-library-pack.mjs <pack.json> [options]
 *
 *   --dry-run            Report what would change; write nothing.
 *   --class <c>          Only merge entries of this constraint class (e.g. `totalistic`).
 *                        Repeatable. Classes: totalistic, n_count, d_sym, r_sym, free.
 *   --hex <HEX>          Only merge these ruleset hexes. Repeatable.
 *   --require-ic         Skip entries with no paired initial condition + seed (they cannot be
 *                        replayed by anyone else, which is what the public catalog promises).
 *   --catalog <path>     Override the catalog path (default `src/core/library/rulesets.json`).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CATALOG = path.join(REPO_ROOT, 'src', 'core', 'library', 'rulesets.json');

/**
 * Load the app's own codecs through Vite, so this script shares one definition of the catalog shape
 * with the running app instead of a copy that can drift.
 * @returns {Promise<{decodePack: Function, toPublicLibraryEntry: Function,
 *   classifyRulesetConstraint: Function, CONSTRAINT_CLASSES: string[], close: () => Promise<void>}>}
 */
async function loadAppModules() {
    const server = await createServer({
        root: REPO_ROOT,
        configFile: false,
        logLevel: 'error',
        server: { middlewareMode: true, watch: null },
    });
    try {
        const codec = await server.ssrLoadModule('/src/services/LibraryPackCodec.js');
        const descriptor = await server.ssrLoadModule('/src/core/rulesetDescriptor.js');
        return {
            decodePack: codec.decodePack,
            toPublicLibraryEntry: codec.toPublicLibraryEntry,
            classifyRulesetConstraint: descriptor.classifyRulesetConstraint,
            CONSTRAINT_CLASSES: descriptor.CONSTRAINT_CLASSES,
            close: () => server.close(),
        };
    } catch (error) {
        await server.close();
        throw error;
    }
}

/**
 * @param {string[]} argv
 * @returns {{packPath: string, dryRun: boolean, classes: Set<string>, hexes: Set<string>,
 *   requireIC: boolean, catalogPath: string}}
 */
function parseArgs(argv) {
    /** @type {string[]} */
    const positional = [];
    const classes = new Set();
    const hexes = new Set();
    let dryRun = false;
    let requireIC = false;
    let catalogPath = DEFAULT_CATALOG;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') dryRun = true;
        else if (arg === '--require-ic') requireIC = true;
        else if (arg === '--class') classes.add(String(argv[++i] || '').trim());
        else if (arg === '--hex') hexes.add(String(argv[++i] || '').trim().toUpperCase());
        else if (arg === '--catalog') catalogPath = path.resolve(String(argv[++i] || ''));
        else if (arg.startsWith('--')) fail(`Unknown option ${arg}.`);
        else positional.push(arg);
    }

    if (positional.length !== 1) fail('Usage: node scripts/merge-library-pack.mjs <pack.json> [--dry-run] [--class <c>] [--hex <HEX>] [--require-ic]');
    return { packPath: path.resolve(positional[0]), dryRun, classes, hexes, requireIC, catalogPath };
}

/** @param {string} message */
function fail(message) {
    console.error(message);
    process.exit(1);
}

async function main() {
    const { packPath, dryRun, classes, hexes, requireIC, catalogPath } = parseArgs(process.argv.slice(2));
    const app = await loadAppModules();
    try {
        run(app, { packPath, dryRun, classes, hexes, requireIC, catalogPath });
    } finally {
        await app.close();
    }
}

/**
 * @param {Awaited<ReturnType<typeof loadAppModules>>} app
 * @param {{packPath: string, dryRun: boolean, classes: Set<string>, hexes: Set<string>,
 *   requireIC: boolean, catalogPath: string}} options
 */
function run(app, { packPath, dryRun, classes, hexes, requireIC, catalogPath }) {
    const { decodePack, toPublicLibraryEntry, classifyRulesetConstraint, CONSTRAINT_CLASSES } = app;

    for (const c of classes) {
        if (!CONSTRAINT_CLASSES.includes(c)) {
            fail(`Unknown constraint class ${JSON.stringify(c)}. Known: ${CONSTRAINT_CLASSES.join(', ')}.`);
        }
    }

    let decoded;
    try {
        decoded = decodePack(readFileSync(packPath, 'utf8'));
    } catch (error) {
        fail(`Could not read pack ${packPath}: ${error instanceof Error ? error.message : error}`);
        return;
    }
    for (const warning of decoded.warnings) console.warn(`  pack warning: ${warning}`);

    /** @type {Array<Record<string, any>>} */
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    if (!Array.isArray(catalog)) fail(`${catalogPath} is not a JSON array.`);
    const known = new Set(catalog.map((e) => String(e.hex || '').toUpperCase()));

    const added = [];
    const skipped = { duplicate: 0, filteredClass: 0, filteredHex: 0, noIC: 0 };

    for (const entry of decoded.rulesets) {
        const hex = String(entry.hex || '').toUpperCase();
        if (hexes.size && !hexes.has(hex)) { skipped.filteredHex++; continue; }

        const constraintClass = classifyRulesetConstraint(hex);
        if (classes.size && !(constraintClass && classes.has(constraintClass))) { skipped.filteredClass++; continue; }

        if (known.has(hex)) { skipped.duplicate++; continue; }

        const publicEntry = toPublicLibraryEntry(entry);
        if (requireIC && !(publicEntry.initialState && Number.isFinite(publicEntry.seed))) {
            skipped.noIC++;
            console.warn(`  skipped "${publicEntry.name}" — no paired initial condition + seed.`);
            continue;
        }

        known.add(hex);
        catalog.push(publicEntry);
        added.push({ name: publicEntry.name, hex, constraintClass });
    }

    for (const { name, hex, constraintClass } of added) {
        console.log(`  + ${constraintClass ?? '?'}  ${hex}  ${name}`);
    }
    console.log(
        `\n${added.length} added, ${skipped.duplicate} already in the catalog` +
        `${skipped.filteredClass ? `, ${skipped.filteredClass} filtered by class` : ''}` +
        `${skipped.filteredHex ? `, ${skipped.filteredHex} filtered by hex` : ''}` +
        `${skipped.noIC ? `, ${skipped.noIC} missing an initial condition` : ''}.`
    );

    if (!added.length) {
        console.log('Catalog unchanged.');
        return;
    }
    if (dryRun) {
        console.log('Dry run — nothing written.');
        return;
    }

    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${catalogPath} (${catalog.length} entries). Review the diff before committing.`);
}

main().catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
