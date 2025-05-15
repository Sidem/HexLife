export class DraggablePanel {
    constructor(panelElement, handleSelector = 'h3', constrainToViewport = true) {
        this.panelElement = panelElement;
        this.handleElement = panelElement.querySelector(handleSelector);
        this.constrainToViewport = constrainToViewport;
        this.offsetX = 0;
        this.offsetY = 0;

        if (!this.panelElement) {
            console.error('DraggablePanel: panelElement is null or undefined.');
            return; 
        }

        if (!this.handleElement) {
            console.warn('DraggablePanel: Handle element not found with selector:', handleSelector, 'in panel:', panelElement);
            
            this.handleElement = this.panelElement;
            console.warn('DraggablePanel: Using the panel element itself as the drag handle.');
        }
        this._initDragging();
    }

    _initDragging() {
        this.handleElement.style.cursor = 'move';
        this.boundOnMouseDown = this._onMouseDown.bind(this);
        this.handleElement.addEventListener('mousedown', this.boundOnMouseDown);
    }

    _onMouseDown(event) {
        
        if (event.target.closest('input, button, select, textarea, .rule-viz, .neighbor-count-rule-viz, a')) {
            return;
        }
        event.preventDefault();
        const rect = this.panelElement.getBoundingClientRect();
        this.offsetX = event.clientX - rect.left;
        this.offsetY = event.clientY - rect.top;
        const computedStyle = window.getComputedStyle(this.panelElement);
        if (computedStyle.transform !== 'none' && computedStyle.position === 'fixed') { 
            this.panelElement.style.left = `${rect.left}px`;
            this.panelElement.style.top = `${rect.top}px`;
            this.panelElement.style.transform = 'none';
        } else if (computedStyle.position === 'absolute' && computedStyle.transform !== 'none') {
             
            this.panelElement.style.left = `${this.panelElement.offsetLeft}px`;
            this.panelElement.style.top = `${this.panelElement.offsetTop}px`;
            this.panelElement.style.transform = 'none';
        }
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
        const computedStyle = window.getComputedStyle(this.panelElement);
        if (computedStyle.transform.includes('translate') &&
            (computedStyle.left === '50%' || computedStyle.top === '50%')) {
        } else if ( (computedStyle.left === '0px' || computedStyle.left === '') &&
                    (computedStyle.top === '0px' || computedStyle.top === '') &&
                     this.panelElement.style.transform !== 'none') {
            
            this.panelElement.style.left = '50%';
            this.panelElement.style.top = '50%';
            
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
        return !isHidden; 
    }

    isHidden() {
        return this.panelElement.classList.contains('hidden');
    }
    
    destroy() {
        if (this.handleElement && this.boundOnMouseDown) {
            this.handleElement.removeEventListener('mousedown', this.boundOnMouseDown);
        }
        
        document.removeEventListener('mousemove', this.boundDragMouseMove);
        document.removeEventListener('mouseup', this.boundDragMouseUp);
    }
}
