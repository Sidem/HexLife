import { describe, expect, it, vi } from 'vitest';
import { DraggablePanel } from '../src/ui/components/DraggablePanel.js';

describe('DraggablePanel.resetLayout', () => {
    it('restores default geometry and persists the result', () => {
        const style = {
            left: '9999px',
            top: '-800px',
            width: '900px',
            height: '700px',
            maxWidth: 'none',
            maxHeight: 'none',
            transform: 'translate(-50%, -50%)',
        };
        const panel = {
            panelElement: { style },
            options: { defaultPosition: { x: 128, y: 108 } },
            _clampIntoViewport: vi.fn(),
            _saveState: vi.fn(),
        };

        DraggablePanel.prototype.resetLayout.call(panel);

        expect(style).toMatchObject({
            left: '128px',
            top: '108px',
            width: '',
            height: '',
            maxWidth: '',
            maxHeight: '',
            transform: 'none',
        });
        expect(panel._clampIntoViewport).toHaveBeenCalledOnce();
        expect(panel._saveState).toHaveBeenCalledOnce();
    });
});
