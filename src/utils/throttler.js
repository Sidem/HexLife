/**
 * A utility class to throttle the execution of a function.
 * It ensures that the function is called at most once per specified interval,
 * queueing the latest call to be executed after the interval has passed.
 */
export class Throttler {
    /**
     * @param {Function} callback The function to execute after the throttle interval.
     * @param {number} intervalMs The minimum interval in milliseconds between executions.
     */
    constructor(callback, intervalMs) {
        this.callback = callback;
        this.intervalMs = intervalMs;
        this.lastExecutionTime = 0;
        this.pendingTimeoutId = null;
        this.hasPendingArgs = false;
        this.pendingArgs = [];
    }

    /**
     * Schedules the callback to be executed with the provided arguments.
     * If called multiple times within the throttle interval, only the arguments from
     * the most recent call will be used when the callback is finally executed.
     * @param  {...any} args The arguments to pass to the callback function.
     */
    schedule(...args) {
        this.pendingArgs = args;
        this.hasPendingArgs = true;

        const now = Date.now();
        const timeSinceLastExecution = now - this.lastExecutionTime;

        if (this.pendingTimeoutId) {
            // A timeout is already scheduled. We've updated the pending args, so we can wait.
            return;
        }

        if (timeSinceLastExecution >= this.intervalMs) {
            // Interval has passed, execute immediately.
            this._execute();
        } else {
            // Schedule for future execution.
            const delay = this.intervalMs - timeSinceLastExecution;
            this.pendingTimeoutId = setTimeout(() => this._execute(), delay);
        }
    }

    _execute() {
        if (this.pendingTimeoutId) {
            clearTimeout(this.pendingTimeoutId);
            this.pendingTimeoutId = null;
        }
        
        if (this.hasPendingArgs) {
            this.callback(...this.pendingArgs);
            this.lastExecutionTime = Date.now();
            this.hasPendingArgs = false;
            this.pendingArgs = [];
        }
    }
    
    cancel() {
        if (this.pendingTimeoutId) {
            clearTimeout(this.pendingTimeoutId);
            this.pendingTimeoutId = null;
        }
        // Also clear any arguments that were waiting for the cancelled execution
        this.hasPendingArgs = false;
        this.pendingArgs = [];
    }

    /**
     * Cleans up any pending timeout to prevent memory leaks.
     */
    destroy() {
        if (this.pendingTimeoutId) {
            clearTimeout(this.pendingTimeoutId);
        }
    }
} 