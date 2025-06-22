import { BaseComponent } from './BaseComponent.js';

export class ActionsPopover extends BaseComponent {
    constructor(mountPoint) {
        super(mountPoint);
        this.render();
        this.hide();
        this._addDOMListener(document, 'click', this.handleOutsideClick, true);
    }

    render() {
        this.element = document.createElement('div');
        this.element.id = 'actions-popover';
        this.element.className = 'actions-popover';
        this.mountPoint.appendChild(this.element);
    }

    show = (actions, targetElement) => {
        this.element.innerHTML = '';
        const list = document.createElement('ul');
        actions.forEach(action => {
            const li = document.createElement('li');
            li.textContent = action.label;
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                action.callback();
                this.hide();
            });
            list.appendChild(li);
        });
        this.element.appendChild(list);

        const targetRect = targetElement.getBoundingClientRect();
        this.element.style.top = `${targetRect.bottom + 5}px`;
        this.element.style.left = `${targetRect.right - this.element.offsetWidth}px`;
        this.element.classList.add('visible');
    }

    hide = () => {
        this.element.classList.remove('visible');
    }

    handleOutsideClick = (event) => {
        if (!this.element.contains(event.target)) {
            this.hide();
        }
    }

    destroy() {
        // Clean up document-level listener
        document.removeEventListener('click', this.handleOutsideClick, true);
        super.destroy();
    }
} 