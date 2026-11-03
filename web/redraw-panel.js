import { el, field } from './client.js';
import { options, controlTypes, redrawModes, tilePatches, installedPatch } from './prompts.js';
import { combo, segmented, slider, seed } from './controls.js';

// Redraw presets fill only the Style section; the subject comes from the drawing's structure and the rest of the prompt.
const redrawPresets = {
    'Color → Manga': { prompt: '', prompt_sections: { style: 'monochrome, greyscale, manga, screentone, clean ink lines' } },
    Watercolor: { prompt: '', prompt_sections: { style: 'watercolor (medium), traditional media' } },
};

// The installed copy of a mode's LLLite, found by filename in any subfolder.
export const modePatch = (defs, mode) => {
    const type = controlTypes[redrawModes[mode].type];
    return type ? installedPatch(defs, [type.patch]) || type.patch : installedPatch(defs, tilePatches) || '';
};

export function redrawControls(studio, kind, changed) {
    const scope = `redraw_${kind}`, existing = studio.project.config[`${scope}:anima`];
    const cfg = studio.config(scope, 'anima');
    if (!existing) {
        // From the November 2026 check: Lineart at 1.0 on mangaVision inks a color illustration as clean manga.
        Object.assign(cfg, { task: 'redraw', redraw_mode: 'lineart', redraw_patch: modePatch(studio.defs, 'lineart'), redraw_strength: 1, redraw_end: 1, denoise: 1, megapixels: 1,
            feather: 16, blend_opacity: 100, seed: 0, random_seed: true });
        studio.saveSoon();
    }
    const element = el('div');
    function render() {
        const update = () => { changed(); studio.presetChanged(scope, element); };
        const number = (label, key, range, step) => slider(label, el('input', { type: 'number', 'aria-label': label, value: cfg[key], step, onchange: e => { cfg[key] = Number(e.target.value); update(); } }), range);
        const task = segmented('Redraw task', [['redraw', 'Redraw'], ['lineart', 'Extract lineart']], cfg.task, value => { cfg.task = value; update(); render(); });
        if (cfg.task === 'lineart') {
            element.replaceChildren(task, el('small', { text: 'Extracts the lines of the canvas or selected region into an editable ink layer: black lines whose opacity follows their strength. Requires comfyui_controlnet_aux.' }));
            return;
        }
        const presets = el('div', { class: 'amm-row' }); studio.presets(presets, scope, cfg, redrawPresets, () => { render(); changed(); });
        const mode = el('select', { 'aria-label': 'Keep from the drawing', onchange: e => {
            cfg.redraw_mode = e.target.value; cfg.redraw_patch = modePatch(studio.defs, cfg.redraw_mode);
            cfg.redraw_strength = controlTypes[redrawModes[cfg.redraw_mode].type]?.strength ?? 1; update(); render();
        } }, ...Object.entries(redrawModes).map(([value, item]) => el('option', { value, text: item.label })));
        mode.value = cfg.redraw_mode;
        const prompt = el('details', { open: true }, el('summary', { text: 'Prompt' })); studio.promptControls(prompt, cfg, update);
        const sampling = el('div'); studio.samplingControls(sampling, cfg, 'anima', update, scope); sampling.append(seed('Seed', cfg, update));
        const blend = el('details', {}, el('summary', { text: 'Resolution and blending' }), number('Working resolution · MP', 'megapixels', [0.25, 4], 0.05),
            number('Edge feather · px', 'feather', [0, 128], 1), number('Blend opacity · %', 'blend_opacity', [0, 100], 1));
        element.replaceChildren(task, presets, field('Keep from the drawing', mode),
            combo('Redraw LLLite', options(studio.defs, 'ModelPatchLoader', 'name'), cfg.redraw_patch, value => { cfg.redraw_patch = value; update(); }),
            number('Fidelity · LLLite strength', 'redraw_strength', [0, 2], 0.05), number('End · fraction of denoising', 'redraw_end', [0, 1], 0.01),
            number('Denoise · below 1 starts from the drawing and keeps its colors', 'denoise', [0, 1], 0.05),
            el('small', { text: 'Lineart and Grayscale keep the drawing closely; with a manga model and the Color → Manga preset they ink it as clean manga. Depth keeps only the layout.' }),
            prompt, blend, sampling);
        studio.modelControls(element, cfg, 'anima', update, false, scope, render);
    }
    render();
    return { get cfg() { return cfg; }, element };
}
