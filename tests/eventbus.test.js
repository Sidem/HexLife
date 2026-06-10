import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/services/EventBus.js';

// Each test uses a unique event name so the module-level subscription registry stays isolated.
let counter = 0;
const evt = () => `test:event:${counter++}`;

describe('EventBus subscribe / dispatch', () => {
    it('delivers payloads to subscribers', () => {
        const e = evt();
        const cb = vi.fn();
        EventBus.subscribe(e, cb);
        EventBus.dispatch(e, { value: 42 });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ value: 42 });
    });

    it('delivers to multiple subscribers in order', () => {
        const e = evt();
        const order = [];
        EventBus.subscribe(e, () => order.push('a'));
        EventBus.subscribe(e, () => order.push('b'));
        EventBus.dispatch(e);
        expect(order).toEqual(['a', 'b']);
    });

    it('isolates a throwing subscriber from the others', () => {
        const e = evt();
        const good = vi.fn();
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        EventBus.subscribe(e, () => { throw new Error('boom'); });
        EventBus.subscribe(e, good);
        expect(() => EventBus.dispatch(e)).not.toThrow();
        expect(good).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('EventBus unsubscribe (regression for index-capture bug)', () => {
    it('removing the first of three leaves the other two intact', () => {
        const e = evt();
        const a = vi.fn();
        const b = vi.fn();
        const c = vi.fn();
        const unsubA = EventBus.subscribe(e, a);
        EventBus.subscribe(e, b);
        EventBus.subscribe(e, c);

        unsubA();
        EventBus.dispatch(e);

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
        expect(c).toHaveBeenCalledTimes(1);
    });

    it('unsubscribing the same callback twice is a no-op', () => {
        const e = evt();
        const a = vi.fn();
        const b = vi.fn();
        const unsubA = EventBus.subscribe(e, a);
        EventBus.subscribe(e, b);

        unsubA();
        expect(() => unsubA()).not.toThrow();
        EventBus.dispatch(e);

        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('unsubscribing during dispatch does not skip later subscribers', () => {
        const e = evt();
        const b = vi.fn();
        // `a` removes itself when invoked; the dispatch snapshot must still reach `b`.
        const unsubA = EventBus.subscribe(e, () => unsubA());
        EventBus.subscribe(e, b);
        EventBus.dispatch(e);
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('dispatching an event with no subscribers is safe', () => {
        expect(() => EventBus.dispatch('test:never:subscribed', {})).not.toThrow();
    });
});
