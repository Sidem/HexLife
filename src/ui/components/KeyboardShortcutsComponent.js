import { BaseComponent } from './BaseComponent.js';

export class KeyboardShortcutsComponent extends BaseComponent {
    constructor(appContext, options = {}) {
        super(null, options);
        this.appContext = appContext;
        this.element = document.createElement('div');
        this.element.className = 'keyboard-shortcuts-component-content';
        this.render();
    }

    getElement() {
        return this.element;
    }

    render() {
        const shortcuts = this.appContext.keyboardShortcutManager.getShortcuts();
        const groupedShortcuts = this.groupShortcuts(shortcuts);

        let html = '';
        for (const category in groupedShortcuts) {
            html += `<div class="shortcut-category"><h4>${category}</h4><ul>`;
            groupedShortcuts[category].forEach(shortcut => {
                html += `<li>
                    <div class="keys">
                        ${shortcut.ctrlKey ? '<kbd>Ctrl</kbd> + ' : ''}
                        ${shortcut.shiftKey ? '<kbd>Shift</kbd> + ' : ''}
                        <kbd>${shortcut.key.toUpperCase()}</kbd>
                    </div>
                    <div class="description">${shortcut.description}</div>
                </li>`;
            });
            html += `</ul></div>`;
        }
        this.element.innerHTML = html;
    }

    groupShortcuts(shortcuts) {
        return shortcuts.reduce((acc, shortcut) => {
            const category = shortcut.category || 'Misc';
            if (!acc[category]) {
                acc[category] = [];
            }
            acc[category].push(shortcut);
            return acc;
        }, {});
    }

    refresh() {
        this.render();
    }
}
