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
        expect(element).toContain('hexlife-hcp-ready');
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
        expect(renderer).toContain('cameraDepths');
        expect(renderer).toContain('u_layers - 1 - layer');
        expect(renderer).toContain('u_opacity');
        expect(renderer).toContain('function hexPrism');
    });

    it('tiles in-plane neighbours at circumradius R', async () => {
        const {SITE_SCALE} = await import('../src/embed/HcpRenderer.js');
        const {sitePosition} = await import('../src/embed/hcpCoords.js');
        expect(SITE_SCALE).toBe(1);
        const verts = (col, row) => {
            const c = sitePosition(col, row, 0, 1);
            return Array.from({length: 6}, (_, i) => {
                const a = i * Math.PI / 3;
                return `${(c.x + Math.cos(a) * SITE_SCALE).toFixed(6)},${(c.y + Math.sin(a) * SITE_SCALE).toFixed(6)}`;
            });
        };
        const shared = verts(0, 0).filter((key) => verts(1, 0).includes(key));
        expect(shared).toHaveLength(2);
    });

    it('depth-selects one nearest site instead of accumulating every instance', async () => {
        const renderer = await read('src/embed/HcpRenderer.js');
        expect(renderer).toContain('const opaqueSurface = this._opacity >= OPAQUE_OPACITY');
        expect(renderer).toMatch(
            /gl\.colorMask\(false, false, false, false\);[\s\S]*gl\.drawArraysInstanced/,
        );
        expect(renderer).toMatch(
            /gl\.colorMask\(true, true, true, true\);[\s\S]*gl\.depthFunc\(gl\.EQUAL\);[\s\S]*gl\.enable\(gl\.BLEND\);[\s\S]*gl\.depthMask\(false\);[\s\S]*gl\.drawArraysInstanced/,
        );
        expect(renderer).not.toMatch(/const translucent = this\._opacity < 0\.995/);
    });

    it('draws layer 0 above the last layer', async () => {
        const {visualHeight} = await import('../src/embed/HcpRenderer.js');
        expect(visualHeight(0, 24)).toBeGreaterThan(visualHeight(23, 24));
        expect(visualHeight(23, 24)).toBe(0);
    });

    it('places the far plane beyond a demo-size volume', async () => {
        const {cameraDepths} = await import('../src/embed/HcpRenderer.js');
        const span = 84;
        const distance = 1.15 * span;
        const {near, far} = cameraDepths(distance, span);
        expect(far).toBeGreaterThan(distance + span);
        expect(near).toBeLessThan(far);
        expect(far).toBeGreaterThan(40);
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
