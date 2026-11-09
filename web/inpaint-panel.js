import { el, button, field, iconButton, assetUrl } from './client.js';
import { options, referenceLimits } from './prompts.js';
import { combo, segmented, slider, seed } from './controls.js';
import { maskLayer } from './control-layers.js';

// Starting values per task. Fix works like a detailer: the masked area is cropped with context, generated at the working resolution and stitched back.
export const inpaintTasks = {
    inpaint: { label: 'Inpaint', denoise: 1, hint: 'Paint the area to replace on the Control · Mask layer (any color). Inpainting v2 blends the new content with the rest at denoise 1.' },
    outpaint: { label: 'Outpaint', denoise: 1, hint: 'Extend the canvas below: the new area stays transparent and is filled, together with anything painted on the mask layer. Extending reopens the drawing, so Klecks\' undo history starts again.' },
    fix: { label: 'Fix details', denoise: 0.5, hint: 'Mask a face, hands or another detail. The area is redrawn at the working resolution and scaled back, keeping the original at denoise 0.5.' },
};

// Kept when switching engine, so the task, area, prompt and references carry over.
const shared = ['task', 'denoise', 'padding', 'megapixels', 'outpaint_overlap', 'feather', 'blend_opacity', 'seed', 'random_seed', 'inpaint_patch', 'inpaint_strength', 'extend', 'prompt', 'prompt_sections', 'references'];

export function inpaintControls(studio, kind, send, dimensions, changed) {
    const scope = `inpaint_${kind}`, state = studio.state(scope);
    if (state.engine !== 'anima_snapref') state.engine = 'anima';
    // Anima repaints from the prompt; SnapRef also draws the masked figure as the character in its references.
    const inpaintConfig = (engine, previous) => {
        const existing = studio.project.config[`${scope}:${engine}`];
        const cfg = studio.config(scope, engine); cfg.engine = engine;
        if (!existing) Object.assign(cfg, { task: 'inpaint', denoise: 1, padding: 96, megapixels: 1, outpaint_overlap: 24, feather: 12, blend_opacity: 100, seed: 0, random_seed: true,
            inpaint_patch: options(studio.defs, 'ModelPatchLoader', 'name').find(name => name.split('/').at(-1) === 'anima-lllite-inpainting-v2.safetensors') || 'anima-lllite-inpainting-v2.safetensors', inpaint_strength: 1 });
        if (previous) for (const key of shared) if (key in previous) cfg[key] = structuredClone(previous[key]);
        studio.saveSoon();
        return cfg;
    };
    let cfg = inpaintConfig(state.engine);
    const element = el('div'), maskRow = el('div', { class: 'amm-row' });
    let hasMask = false;
    const renderMask = () => maskRow.replaceChildren(button(hasMask ? 'Clear mask' : 'Add mask layer', () => mask(maskLayer)));
    const mask = name => { if (!dimensions()) { studio.fail(new Error('Wait for the drawing to open.')); return; } send('manga-drawing-control-layer', { name, ...dimensions() }); };
    function render() {
        const update = () => { changed(); studio.presetChanged(scope, element); };
        const number = (label, key, range, step) => slider(label, el('input', { type: 'number', 'aria-label': label, value: cfg[key], step, onchange: e => { cfg[key] = Number(e.target.value); update(); } }), range);
        const presets = el('div', { class: 'amm-row' }); studio.presets(presets, scope, cfg, {}, () => { render(); changed(); });
        const engine = segmented('Inpaint engine', [['anima', 'Anima'], ['anima_snapref', 'SnapRef · character']], cfg.engine, value => {
            cfg = inpaintConfig(value, cfg); state.engine = value; update(); render();
        });
        const references = cfg.engine === 'anima_snapref' ? referenceControls(studio, cfg, update) : null;
        const prompt = el('details', { open: true }, el('summary', { text: 'Prompt for the masked area' })); studio.promptControls(prompt, cfg, update);
        const sampling = el('div'); studio.samplingControls(sampling, cfg, cfg.engine, update, scope); sampling.append(seed('Seed', cfg, update));
        const blend = el('details', {}, el('summary', { text: 'Area and blending' }), number('Context padding · px', 'padding', [0, 512], 8), number('Working resolution · MP', 'megapixels', [0.25, 4], 0.05),
            number('Outpaint overlap · px', 'outpaint_overlap', [0, 128], 4), number('Edge feather · px', 'feather', [0, 128], 1), number('Blend opacity · %', 'blend_opacity', [0, 100], 1));
        const model = el('details', {}, el('summary', { text: 'Inpainting model' }),
            combo('Inpainting LLLite · empty uses the noise mask only', options(studio.defs, 'ModelPatchLoader', 'name'), cfg.inpaint_patch, value => { cfg.inpaint_patch = value; update(); }),
            number('Inpainting strength', 'inpaint_strength', [0, 2], 0.05));
        element.replaceChildren(presets, engine, references,
            segmented('Task', Object.entries(inpaintTasks).map(([value, task]) => [value, task.label]), cfg.task, value => { cfg.task = value; cfg.denoise = inpaintTasks[value].denoise; update(); render(); }),
            el('small', { text: inpaintTasks[cfg.task].hint }),
            maskRow,
            ...cfg.task === 'outpaint' ? [el('div', { class: 'amm-sketch-coordinates' }, ...['left', 'top', 'right', 'bottom'].map(side => field(`Extend ${side} · px`,
                el('input', { type: 'number', min: 0, step: 8, value: cfg.extend?.[side] ?? 0, 'aria-label': `Extend ${side} · px`, onchange: e => { (cfg.extend ||= {})[side] = Math.max(0, Math.round(Number(e.target.value) || 0)); update(); } })))),
                button('Extend canvas', () => send('manga-drawing-extend', { margins: { left: 0, top: 0, right: 0, bottom: 0, ...cfg.extend } }))] : [],
            number('Denoise', 'denoise', [0, 1], 0.05), prompt, blend, model, sampling);
        studio.modelControls(element, cfg, cfg.engine, update, false, scope, render);
    }
    render(); renderMask();
    return { get cfg() { return cfg; }, element, sync(names) { hasMask = names.includes(maskLayer); renderMask(); } };
}

// Up to eight pictures of the character that fills the masked area.
function referenceControls(studio, cfg, update) {
    const limit = referenceLimits.anima_snapref, box = el('details', { open: true }, el('summary', { text: 'Character references' })), list = el('div', { class: 'amm-reference-strip' });
    cfg.references ||= [];
    const refresh = () => list.replaceChildren(...cfg.references.map((id, i) => {
        const a = studio.project.assets.find(a => a.id === id);
        return el('div', { 'data-asset-id': id }, el('img', { src: assetUrl(studio.project.id, id, true), alt: a?.name || 'Missing', loading: 'lazy' }),
            el('small', { text: `${i + 1}. ${a?.name || 'Missing'}` }), iconButton('Remove', 'clear', () => { cfg.references.splice(i, 1); update(); refresh(); }));
    }));
    refresh();
    box.append(list, iconButton('Choose references', 'link', () => studio.chooseImage('Connect references', id => {
        if (!cfg.references.includes(id) && cfg.references.length < limit) { cfg.references.push(id); update(); }
        refresh(); return false;
    }, id => cfg.references.length >= limit && !cfg.references.includes(id)), {}, true),
    el('small', { text: 'Pictures of the one character to draw in the masked area. Mask one figure at a time and describe only that figure in the prompt.' }));
    return box;
}
