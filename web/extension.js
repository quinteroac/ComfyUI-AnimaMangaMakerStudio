import { app } from '../../scripts/app.js';
import { Studio } from './studio.js';
import { el, button } from './client.js';

let studio;
function openStudio() {
    if (studio) { studio.dialog.focus(); return; }
    studio = new Studio(); studio.onClose = () => studio = null;
}
app.registerExtension({
    name: 'AnimaMangaMaker.Studio',
    commands: [{ id: 'AnimaMangaMaker.Open', label: 'Anima Manga Maker Studio', icon: 'pi pi-book', function: openStudio }],
    menuCommands: [{ path: ['Anima Manga Maker'], commands: ['AnimaMangaMaker.Open'] }],
    async setup() {
        const style = el('link', { rel: 'stylesheet', href: new URL('./studio.css', import.meta.url).href }); document.head.append(style);
        app.extensionManager.registerSidebarTab({
            id: 'anima-manga-maker-studio', icon: 'pi pi-book', title: 'Anima Manga Maker Studio', tooltip: 'Manga projects', type: 'custom',
            render(container) { container.replaceChildren(el('div', { class: 'amm-sidebar' }, el('h2', { text: 'Anima Manga Maker Studio' }),
                el('p', { text: 'References, panels, and pages in a local workspace.' }), button('Open Anima Manga Maker Studio', openStudio, { class: 'amm-primary' }))); },
        });
    },
});
