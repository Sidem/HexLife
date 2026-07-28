import { describe, expect, it, vi } from 'vitest';
import { InputManager } from '../src/ui/InputManager.js';

function createManager(strategy = 'pan') {
    const manager = Object.create(InputManager.prototype);
    manager.currentStrategyName = strategy;
    manager._shiftWorldKeyHeld = false;
    manager._strategyBeforeShiftWorld = null;
    manager._strategyBeforeTorus = 'pan';
    manager.previousStrategyName = 'pan';
    manager.isMobile = false;
    manager.setStrategy = vi.fn((name) => {
        manager.currentStrategyName = name;
    });
    return manager;
}

function keyEvent() {
    return {
        key: InputManager.SHIFT_WORLD_KEY,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault: vi.fn(),
    };
}

describe('InputManager hold-H world shifting', () => {
    it.each(['pan', 'orbit'])('temporarily overrides the %s navigation strategy', (strategy) => {
        const manager = createManager(strategy);
        manager._isTextInputFocused = () => false;
        const event = keyEvent();

        manager._handleShiftWorldKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(manager.currentStrategyName).toBe('shiftWorld');
        expect(manager._strategyBeforeShiftWorld).toBe(strategy);

        manager._handleShiftWorldKeyUp(event);

        expect(manager.currentStrategyName).toBe(strategy);
        expect(manager._shiftWorldKeyHeld).toBe(false);
    });

    it('settles the H override before leaving Torus view', () => {
        const manager = createManager('orbit');
        manager._isTextInputFocused = () => false;
        manager._handleShiftWorldKeyDown(keyEvent());

        manager._handleTorusViewChanged({ enabled: false });

        expect(manager.currentStrategyName).toBe('pan');
        expect(manager._shiftWorldKeyHeld).toBe(false);
    });
});
