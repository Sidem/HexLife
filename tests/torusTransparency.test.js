import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

describe('torus transparency passes', () => {
    it('selects live and off fragments in separate shader passes', () => {
        const fragmentShader = read('shaders/torus_fragment.glsl');
        const renderer = read('src/rendering/renderer.js');

        expect(fragmentShader).toContain('uniform int u_surfacePass;');
        expect(fragmentShader).toContain('u_surfacePass == 1 && v_state < 0.5');
        expect(fragmentShader).toContain('u_surfacePass == 2 && v_state >= 0.5');
        expect(renderer).toContain('surfacePass: gl.getUniformLocation');
    });

    it('uses a depth-writing solid pass at full opacity', () => {
        const renderer = read('src/rendering/renderer.js');

        expect(renderer).toContain('const opaqueSurface = torusView.offOpacity >= 0.999;');
        expect(renderer).toMatch(
            /if \(opaqueSurface\)[\s\S]*TORUS_SURFACE_PASS\.ALL[\s\S]*gl\.depthMask\(true\);[\s\S]*gl\.drawArraysInstanced/,
        );
    });

    it('depth-selects one off layer instead of accumulating every torus intersection', () => {
        const renderer = read('src/rendering/renderer.js');

        expect(renderer).toMatch(
            /TORUS_SURFACE_PASS\.LIVE[\s\S]*gl\.depthMask\(true\);[\s\S]*gl\.drawArraysInstanced/,
        );
        expect(renderer).toMatch(
            /gl\.colorMask\(false, false, false, false\);[\s\S]*TORUS_SURFACE_PASS\.OFF[\s\S]*gl\.drawArraysInstanced/,
        );
        expect(renderer).toMatch(
            /gl\.colorMask\(true, true, true, true\);[\s\S]*gl\.depthFunc\(gl\.EQUAL\);[\s\S]*gl\.enable\(gl\.BLEND\);[\s\S]*gl\.depthMask\(false\);[\s\S]*gl\.drawArraysInstanced/,
        );
    });

    it('keeps the requested opacity unchanged on back-facing cells', () => {
        const fragmentShader = read('shaders/torus_fragment.glsl');

        expect(fragmentShader).not.toContain('u_backSurface');
        expect(fragmentShader).not.toMatch(/alpha\s*\*=/);
        expect(fragmentShader).toContain('float alpha = v_state < 0.5 ? u_offOpacity : 1.0;');
    });

    it('shades both sides consistently and keeps black off cells visible', () => {
        const fragmentShader = read('shaders/torus_fragment.glsl');

        expect(fragmentShader).toContain('float viewFacing = abs(dot(normal, viewDirection));');
        expect(fragmentShader).toContain('float diffuse = mix(0.35, 1.0, viewFacing);');
        expect(fragmentShader).not.toContain('lightDirection');
        expect(fragmentShader).toMatch(
            /if \(v_state < 0\.5\)[\s\S]*litColor = max\(baseColor \* 0\.7, vec3\(0\.22, 0\.24, 0\.3\)\)/,
        );
        expect(fragmentShader).toContain('vec3(0.015, 0.02, 0.03) * rim');
    });
});
