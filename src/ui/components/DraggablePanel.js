export class DraggablePanel {
    constructor(panelElement, handleSelector = 'h3', constrainToViewport = true) {
        this.panelElement = panelElement;
        this.handleElement = panelElement.querySelector(handleSelector);
        this.constrainToViewport = constrainToViewport;
        this.offsetX = 0;
        this.offsetY = 0;

        if (!this.panelElement) {
            console.error('DraggablePanel: panelElement is null or undefined.');
            return; // Do not proceed if panelElement is not valid
        }

        if (!this.handleElement) {
            console.warn('DraggablePanel: Handle element not found with selector:', handleSelector, 'in panel:', panelElement);
            // Fallback to panelElement itself if handle not found
            this.handleElement = this.panelElement;
            console.warn('DraggablePanel: Using the panel element itself as the drag handle.');
        }
        this._initDragging();
    }

    _initDragging() {
        this.handleElement.style.cursor = 'move';
        // Bind 'this' for event listeners to ensure correct context
        this.boundOnMouseDown = this._onMouseDown.bind(this);
        this.handleElement.addEventListener('mousedown', this.boundOnMouseDown);
    }

    _onMouseDown(event) {
        // Prevent dragging if clicking on interactive elements within the panel
        if (event.target.closest('input, button, select, textarea, .rule-viz, .neighbor-count-rule-viz, a')) {
            return;
        }
        event.preventDefault();

        const rect = this.panelElement.getBoundingClientRect();
        this.offsetX = event.clientX - rect.left;
        this.offsetY = event.clientY - rect.top;

        // If the panel uses transform for centering, explicitly set top/left
        // based on current visual position and remove transform for direct positioning.
        const computedStyle = window.getComputedStyle(this.panelElement);
        if (computedStyle.transform !== 'none' && computedStyle.position === 'fixed') { // Common for centered modals
            this.panelElement.style.left = `${rect.left}px`;
            this.panelElement.style.top = `${rect.top}px`;
            this.panelElement.style.transform = 'none';
        } else if (computedStyle.position === 'absolute' && computedStyle.transform !== 'none') {
             // For absolutely positioned elements that might also use transform
            this.panelElement.style.left = `${this.panelElement.offsetLeft}px`;
            this.panelElement.style.top = `${this.panelElement.offsetTop}px`;
            this.panelElement.style.transform = 'none';
        }


        // Bind methods to 'this' and store them to allow removal later
        this.boundDragMouseMove = this._dragMouseMove.bind(this);
        this.boundDragMouseUp = this._dragMouseUp.bind(this);

        document.addEventListener('mousemove', this.boundDragMouseMove);
        document.addEventListener('mouseup', this.boundDragMouseUp);
    }

    _dragMouseMove(event) {
        let newLeft = event.clientX - this.offsetX;
        let newTop = event.clientY - this.offsetY;

        if (this.constrainToViewport) {
            const panelWidth = this.panelElement.offsetWidth;
            const panelHeight = this.panelElement.offsetHeight;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            if (newLeft < 0) newLeft = 0;
            if (newTop < 0) newTop = 0;
            if (newLeft + panelWidth > viewportWidth) newLeft = viewportWidth - panelWidth;
            if (newTop + panelHeight > viewportHeight) newTop = viewportHeight - panelHeight;
        }

        this.panelElement.style.left = `${newLeft}px`;
        this.panelElement.style.top = `${newTop}px`;
    }

    _dragMouseUp() {
        document.removeEventListener('mousemove', this.boundDragMouseMove);
        document.removeEventListener('mouseup', this.boundDragMouseUp);
    }

    show() {
        this.panelElement.classList.remove('hidden');
        // Ensure panel is centered if it was hidden and uses transform for centering
        // This logic assumes the "hidden" state doesn't override fixed positioning values
        // and that initial centering is done via CSS (e.g., top: 50%, left: 50%, transform: translate(-50%, -50%))
        const computedStyle = window.getComputedStyle(this.panelElement);
        if (computedStyle.transform.includes('translate') &&
            (computedStyle.left === '50%' || computedStyle.top === '50%')) {
            // If it's still using transform for centering, no need to change left/top here
            // unless it was previously dragged and then hidden.
            // If it was dragged, left/top are already set in pixels.
        } else if ( (computedStyle.left === '0px' || computedStyle.left === '') &&
                    (computedStyle.top === '0px' || computedStyle.top === '') &&
                     this.panelElement.style.transform !== 'none') {
            // Fallback if it seems unpositioned but has transform - attempt to center
            this.panelElement.style.left = '50%';
            this.panelElement.style.top = '50%';
            // The transform should already be in CSS, e.g., translate(-50%, -50%)
        }
    }

    hide() {
        this.panelElement.classList.add('hidden');
    }

    toggle() {
        const isHidden = this.panelElement.classList.contains('hidden');
        if (isHidden) {
            this.show();
        } else {
            this.hide();
        }
        return !isHidden; // Returns true if panel is now visible
    }

    // Method to remove event listeners if the panel is destroyed
    destroy() {
        if (this.handleElement && this.boundOnMouseDown) {
            this.handleElement.removeEventListener('mousedown', this.boundOnMouseDown);
        }
        // Ensure mousemove and mouseup are also cleaned up if a drag was interrupted
        document.removeEventListener('mousemove', this.boundDragMouseMove);
        document.removeEventListener('mouseup', this.boundDragMouseUp);
    }
}
