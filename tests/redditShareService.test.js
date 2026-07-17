import { describe, it, expect } from 'vitest';
import {
    buildPostTitle,
    buildPostKit,
    formatCodeSize,
    generatorFromLibraryEntry,
    encodeWorldCodeFromLibraryEntry,
    postKitFromLibraryEntry,
    redditHandoffToast,
    DEFAULT_SHOWCASE_GENERATOR,
    REDDIT_SUB_URL,
    REDDIT_SUB_NAME,
} from '../src/services/RedditShareService.js';
import { decodeWorldCode } from '../src/core/WorldCodec.js';

const HEX = '12482080480080006880800180010117';
const COLOR = { mode: 'preset', activePreset: 'default' };

describe('buildPostTitle', () => {
    it('uses the name alone when there are no tags', () => {
        expect(buildPostTitle({ name: 'Spiral Weaver' })).toBe('Spiral Weaver');
    });

    it('appends up to three tag labels', () => {
        expect(buildPostTitle({
            name: 'Mossy',
            tags: ['gliders', 'spirals', 'chaos', 'waves'],
        })).toBe('Mossy · Gliders, Spirals, Chaos');
    });

    it('falls back to HexLife and clamps length', () => {
        expect(buildPostTitle({})).toBe('HexLife');
        const long = 'x'.repeat(400);
        expect(buildPostTitle({ name: long }).length).toBe(300);
    });
});

describe('buildPostKit', () => {
    const code = 'HXW1.deadbeef';

    it('includes title, description, tags, explorer, IC, and world code first', () => {
        const kit = buildPostKit({
            title: 'Spiral Weaver · Gliders',
            description: 'A tidy little glider gun.',
            tags: ['gliders'],
            explorerUrl: 'https://sidem.github.io/HexLife/?r=ABC',
            icLabel: 'IC · 12% fill',
            worldCode: code,
        });
        expect(kit.startsWith(code)).toBe(true);
        expect(kit).toContain('Title: Spiral Weaver · Gliders');
        expect(kit).toContain('A tidy little glider gun.');
        expect(kit).toContain('Tags: Gliders');
        expect(kit).toContain('Explorer: https://sidem.github.io/HexLife/?r=ABC');
        expect(kit).toContain('IC: IC · 12% fill');
        expect(kit).toContain('Leave the title field blank');
    });

    it('rejects non-HXW1 codes', () => {
        expect(() => buildPostKit({ title: 'x', worldCode: 'nope' })).toThrow(/HXW1/);
    });
});

describe('generatorFromLibraryEntry', () => {
    it('uses a paired density/clusters IC', () => {
        const { generator, icLabel, usedDefaultIc } = generatorFromLibraryEntry({
            initialState: { mode: 'density', params: { density: 0.25 } },
        });
        expect(usedDefaultIc).toBe(false);
        expect(generator).toEqual({ mode: 'density', params: { density: 0.25 } });
        expect(icLabel).toMatch(/25%/);
    });

    it('falls back to the default sparse generator', () => {
        const { generator, usedDefaultIc, icLabel } = generatorFromLibraryEntry({ hex: HEX });
        expect(usedDefaultIc).toBe(true);
        expect(generator.mode).toBe(DEFAULT_SHOWCASE_GENERATOR.mode);
        expect(generator.params.density).toBe(0.12);
        expect(icLabel).toMatch(/sparse/i);
    });
});

describe('encodeWorldCodeFromLibraryEntry + postKitFromLibraryEntry', () => {
    it('encodes a density IC entry into a decodable world code and builds a kit', async () => {
        const entry = {
            name: 'Cluster Party',
            description: 'Clumps that crawl.',
            tags: ['blobs', 'growth'],
            hex: HEX,
            initialState: { mode: 'clusters', params: { count: 5, density: 0.7 } },
        };
        const encoded = await encodeWorldCodeFromLibraryEntry(entry, {
            rows: 32,
            cols: 36,
            colorSettings: COLOR,
        });
        expect(encoded).not.toBeNull();
        expect(encoded.code.startsWith('HXW1.')).toBe(true);
        expect(encoded.usedDefaultIc).toBe(false);

        const back = await decodeWorldCode(encoded.code);
        expect(back.rulesetHex.toUpperCase()).toBe(HEX.toUpperCase());
        expect(back.generator?.mode).toBe('clusters');
        expect(back.rows).toBe(32);

        const { title, kit } = postKitFromLibraryEntry(entry, encoded.code, { rows: 32 });
        expect(title).toContain('Cluster Party');
        expect(kit).toContain('Clumps that crawl.');
        expect(kit).toContain(encoded.code);
        expect(kit).toContain('Explorer:');
    });

    it('encodes entries without IC using the default generator', async () => {
        const entry = { name: 'Bare', hex: HEX };
        const encoded = await encodeWorldCodeFromLibraryEntry(entry, {
            rows: 16,
            cols: 18,
            colorSettings: COLOR,
        });
        expect(encoded.usedDefaultIc).toBe(true);
        const back = await decodeWorldCode(encoded.code);
        expect(back.generator?.mode).toBe('density');
        expect(back.generator?.params?.density).toBe(0.12);
    });
});

describe('redditHandoffToast / constants', () => {
    it('mentions the sub and HXW1 paste instruction', () => {
        const ok = redditHandoffToast({ size: '1.2 KB', title: 'Nice Find' });
        expect(ok.type).toBe('success');
        expect(ok.message).toContain(REDDIT_SUB_NAME);
        expect(ok.message).toContain('HXW1');
        expect(ok.message).toContain('Nice Find');

        const blocked = redditHandoffToast({ size: '1.2 KB', title: 'x', popupBlocked: true });
        expect(blocked.type).toBe('error');
    });

    it('exports the subreddit URL', () => {
        expect(REDDIT_SUB_URL).toBe('https://www.reddit.com/r/hexlife/');
    });

    it('formats code size', () => {
        expect(formatCodeSize('x'.repeat(1024))).toBe('1.0 KB');
    });
});
