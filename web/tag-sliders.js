import { el, button, field } from './client.js';
import { slider, toggle, summarize } from './controls.js';

export function tagSliderControls(host, cfg, changed, installed) {
    const state = cfg.tag_sliders ||= { enabled: false, tags: '', values: {}, mode: 'weight_norm' };
    state.values ||= {};
    const details = el('details', {}, el('summary', { text: 'Tag sliders' }));
    const rows = el('div'), guidance = el('div');
    const update = () => { summarize(details, state.enabled ? state.mode : 'Off'); changed(); };
    const rebuild = () => {
        rows.replaceChildren();
        const lines = [...new Set(state.tags.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')))];
        for (const line of lines) {
            const parts = line.split('|').map(part => part.trim()).filter(Boolean);
            if (!parts.length) continue;
            const maxima = parts.map(part => {
                const split = part.lastIndexOf('#'), value = part.slice(split + 1).trim();
                return split > 0 && value && Number.isFinite(Number(value)) ? Number(value) : parts.length > 2 ? 1 : 1.5;
            });
            const range = parts.length > 2 ? [0, parts.length] : parts.length === 2 ? [-maxima[0], maxima[1]] : [state.mode === 'guidance' ? -maxima[0] : 0, maxima[0]];
            rows.append(slider(line, el('input', { type: 'number', 'aria-label': line, value: state.values[line] ?? 0, step: 0.05,
                onchange: e => { state.values[line] = Number(e.target.value); update(); } }), range));
        }
        guidance.hidden = state.mode !== 'guidance';
    };
    const mode = el('select', { 'aria-label': 'Tag slider mode', onchange: e => { state.mode = e.target.value; rebuild(); update(); } },
        ...['weight', 'weight_norm', 'attention', 'guidance'].map(value => el('option', { value, text: value, selected: state.mode === value })));
    for (const [key, label, fallback] of [['start_percent', 'Start percent', 0], ['end_percent', 'End percent', 1], ['rescale', 'Rescale', 0]]) {
        guidance.append(slider(label, el('input', { type: 'number', 'aria-label': label, value: state[key] ?? fallback, min: 0, max: 1, step: 0.01,
            onchange: e => { state[key] = Number(e.target.value); update(); } }), [0, 1]));
    }
    guidance.append(toggle('Anchor', el('input', { type: 'checkbox', checked: !!state.anchor, onchange: e => { state.anchor = e.target.checked; update(); } }),
        'Keep the tag off before Start percent.'), el('small', { text: 'Guidance uses an extra model pass per tag. Negative strengths push away from a single tag.' }));
    details.append(toggle('Apply tag sliders', el('input', { type: 'checkbox', checked: !!state.enabled, onchange: e => { state.enabled = e.target.checked; update(); } })),
        installed ? null : el('small', { text: 'Requires ComfyUI-Anima-Tag-Sliders. Restart ComfyUI after installation and refresh the lists.' }),
        field('Tags / axes', el('textarea', { value: state.tags, rows: 4, 'aria-label': 'Tags / axes', placeholder: 'big eyes\nfrom below | from above\nchibi | petite | tall\nfisheye#4',
            onchange: e => { state.tags = e.target.value; rebuild(); update(); } }), 'One slider per line. Use | for an axis, #4 for a custom maximum. Leave these tags out of the text prompt; they are added during generation. Zero is off.'),
        field('Mode', mode, 'weight: token weights; weight_norm: preserve attention magnitude; attention: bias attention; guidance: compare with and without each tag.'), rows, guidance,
        button('Reset strengths', () => { state.values = {}; rebuild(); update(); }));
    rebuild(); summarize(details, state.enabled ? state.mode : 'Off'); host.append(details);
}
