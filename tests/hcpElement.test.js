import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

describe('<hexlife-hcp> package contract', () => {
    it('registers only from hcp-element and never from hcp.js', async () => {
        const element = await read('src/embed/hcp-element.js');
        const engine = await read('src/embed/hcp.js');
        expect(element).toContain("customElements.define(HCP_TAG_NAME, HexHcpElement)");
        expect(engine).not.toContain('customElements');
        expect(engine).not.toContain('HTMLElement');
    });

    it('draws from the live state view and never setCells after a tick', async () => {
        const element = await read('src/embed/HexHcpElement.js');
        expect(element).toContain('this.world.advance(dt)');
        expect(element).toContain('this.renderer.draw(this.world.state');
        expect(element).toContain("from './hcp.js'");
        expect(element).not.toContain('/spacetime');
        expect(element).not.toContain('SpacetimeCore');
    });

    it('computes instance positions in the vertex shader', async () => {
        const renderer = await read('src/embed/HcpRenderer.js');
        expect(renderer).toContain('gl_InstanceID');
        expect(renderer).toContain('texelFetch');
        expect(renderer).not.toContain('spacetime_fragment');
        expect(renderer).toContain('u_clipPlane');
    });

    it('publishes the contract in tracked files', async () => {
        const readme = await read('packages/hexlife-embed/README.md');
        const doc = await read('docs/embed/hcp.md');
        const entrypoints = await read('docs/embed/entrypoints.md');
        for (const source of [readme, doc]) {
            expect(source).toContain('@hexlife/embed/hcp');
            expect(source).toContain('HexHcp');
            expect(source).toContain('blockRuleFromTet');
            expect(source).toContain('HXP1');
        }
        expect(entrypoints).toContain('@hexlife/embed/hcp');
        expect(entrypoints).toContain('](./hcp.md)');
        expect(doc).not.toContain('/+esm');
        expect(readme).not.toContain('/+esm');
    });
});
