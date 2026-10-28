import { api } from '../../scripts/api.js';
import { el, button, field, request } from './client.js';
import { segmented, toggle } from './controls.js';

// Anima reads Danbooru tags, so it gets the Anima Style Explorer's Animadex lists; the natural-language engines get Stylebook prose.
export const styleSource = engine => ['anima', 'anima_edit'].includes(engine) ? 'animadex' : ['krea', 'krea_edit', 'qwen', 'moss'].includes(engine) ? 'stylebook' : null;

const animadexTabs = [['artist', 'Animadex styles'], ['character', 'Characters']];
const stylebookLabels = { anime_manga: 'Anime & manga', comics: 'Comics', illustration: 'Illustration', painting: 'Painting', art_movements: 'Art movements', print_graphic: 'Print & graphic',
    photography: 'Photography', film_cinema: 'Film & cinema', three_d_digital: '3D & digital', craft_material: 'Craft & material', collage_mixed: 'Collage & mixed', object_artifact: 'Objects & artifacts' };
const tile = 150, pageSize = 120;
const state = { animadex: { tab: 'artist', query: '' }, stylebook: { tab: 'anime_manga', query: '' }, replace: false, characterTags: false };
let stylebook;

const onlinePreviews = () => { try { return localStorage.getItem('anima_online') === 'true'; } catch { return false; } };
const previewUrl = (source, path) => api.apiURL(`/manga-maker/styles/preview/${source}/${path.split('/').map(encodeURIComponent).join('/')}`);
// Adds without repeating an entry already in the section; `separator` matches tag lists or prose.
const merge = (current, text, separator) => !current.trim() || state.replace ? text : current.includes(text) ? current : `${current.trim().replace(/[,\s]+$/, '')}${separator}${text}`;

function animadexCard(item, tab, pick) {
    const src = item.local ? previewUrl('animadex', item.local) : onlinePreviews() ? item.thumb : '';
    return button('', () => pick(item), { class: 'mm-style-card', title: tab === 'artist' ? `@${item.tag}` : [item.tag, ...item.tags].join(', ') },
        src ? el('img', { src, alt: '', loading: 'lazy' }) : el('span', { class: 'mm-style-empty', text: tab === 'artist' ? '@' : item.name.slice(0, 1) }),
        el('strong', { text: item.name }), el('small', { text: [item.copyright, `${Number(item.works).toLocaleString()} works`].filter(Boolean).join(' · ') }));
}

function stylebookCard(style, pick) {
    const { preview } = style, scale = tile / (preview?.w || 256);
    const image = preview ? el('span', { class: 'mm-style-tile', style: `background-image:url("${previewUrl('stylebook', preview.atlas)}");background-size:${preview.size[0] * scale}px ${preview.size[1] * scale}px;background-position:${-preview.x * scale}px ${-preview.y * scale}px` })
        : el('span', { class: 'mm-style-empty', text: style.label.slice(0, 1) });
    return button('', () => pick(style), { class: 'mm-style-card', title: style.prose || style.tags }, image, el('strong', { text: style.label }), el('small', { text: style.aliases.slice(0, 3).join(' · ') }));
}

// `apply(section, update)` receives the prompt section to change and a function from its current text to the new text.
export function openStylePicker(studio, engine, apply) {
    const source = styleSource(engine), current = state[source];
    const grid = el('div', { class: 'mm-style-grid' }), count = el('small', { class: 'mm-style-count' });
    const more = button('Load more', () => studio.action(() => render(true)), { hidden: true });
    const search = el('input', { type: 'search', value: current.query, placeholder: source === 'animadex' ? 'Search artists, characters or series…' : 'Search styles…', 'aria-label': 'Search styles' });
    const options = el('div', { class: 'mm-style-options' });
    let shown = 0, generation = 0, timer;
    const pick = item => {
        if (source === 'stylebook') apply('style', text => merge(text, item.prose || item.tags, ' '));
        else if (current.tab === 'artist') apply('style', text => merge(text, `@${item.tag}`, ', '));
        else apply('subject', text => merge(text, [item.tag, ...state.characterTags ? item.tags : []].join(', '), ', '));
        studio.notify(`${state.replace ? 'Replaced with' : 'Added'} ${source === 'stylebook' ? item.label : item.name}`);
    };
    async function render(append = false) {
        const run = ++generation; if (!append) { shown = 0; grid.replaceChildren(); grid.scrollTop = 0; }
        const terms = current.query.toLowerCase().split(/\s+/).filter(Boolean);
        let items, total;
        if (source === 'stylebook') {
            stylebook ||= await request('/styles/stylebook');
            const all = (stylebook.categories[current.tab] || []).filter(style => terms.every(term => `${style.label} ${style.aliases.join(' ')} ${style.tags}`.toLowerCase().includes(term)));
            items = all.slice(shown, shown + pageSize); total = all.length;
        } else {
            ({ items, total } = await request(`/styles/animadex/${current.tab}?${new URLSearchParams({ q: current.query, offset: shown, limit: pageSize })}`));
        }
        if (run !== generation) return;
        grid.append(...items.map(item => source === 'stylebook' ? stylebookCard(item, pick) : animadexCard(item, current.tab, pick)));
        shown += items.length; more.hidden = shown >= total;
        count.textContent = total ? `${shown.toLocaleString()} of ${total.toLocaleString()}` : 'No matches';
    }
    const renderOptions = () => options.replaceChildren(
        segmented('Insert', [['add', 'Add'], ['replace', 'Replace']], state.replace ? 'replace' : 'add', value => { state.replace = value === 'replace'; }),
        ...source === 'animadex' ? [toggle('Online previews', el('input', { type: 'checkbox', checked: onlinePreviews(), onchange: e => {
            try { localStorage.setItem('anima_online', String(e.target.checked)); } catch { }
            studio.action(() => render());
        } }), 'Shared with Anima Style Explorer; loads previews that are not cached locally from animadex.net.')] : [],
        ...source === 'animadex' && current.tab === 'character' ? [toggle('Include character tags', el('input', { type: 'checkbox', checked: state.characterTags, onchange: e => { state.characterTags = e.target.checked; } }))] : []);
    const tabs = source === 'animadex' ? animadexTabs : Object.keys(stylebookLabels).map(key => [key, stylebookLabels[key]]);
    const tabBar = el('div', { class: 'mm-style-tabs', role: 'tablist' }, ...tabs.map(([key, label]) => button(label, () => {
        current.tab = key; for (const node of tabBar.children) node.setAttribute('aria-selected', String(node.dataset.tab === key));
        renderOptions(); studio.action(() => render());
    }, { role: 'tab', 'data-tab': key, 'aria-selected': String(key === current.tab) })));
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { current.query = search.value.trim(); studio.action(() => render()); }, 200); });
    renderOptions();
    const dialog = studio.modal(source === 'animadex' ? 'Animadex styles and characters' : 'Stylebook styles',
        el('div', { class: 'mm-style-picker' }, tabBar, el('div', { class: 'mm-style-toolbar' }, field('Search', search), count), options, grid, more));
    dialog.classList.add('mm-style-dialog'); search.focus();
    studio.action(() => render());
}
