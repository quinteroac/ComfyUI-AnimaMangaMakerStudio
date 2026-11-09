import { el, field } from './client.js';
import { options } from './prompts.js';
import { combo, slider, seed } from './controls.js';
import { qwenEditDefaults, installedFile } from './qwen-prompt.js';

const editPresets = {
    'Remove object': { instruction: qwenEditDefaults.instruction },
    'Remove text': { instruction: 'Remove all text and lettering from <image1> and restore the artwork behind it. Keep everything else in <image1> unchanged.' },
    'Clean lines': { instruction: 'Clean up <image1> as finished manga art: crisp ink lines, no sketch strokes or smudges. Keep the composition, characters and shading of <image1>.' },
};

export function editControls(studio, kind, changed) {
    const scope = `edit_${kind}`, existing = studio.project.config[`${scope}:qwen_edit`];
    const cfg = studio.config(scope, 'qwen_edit');
    if (!existing) {
        Object.assign(cfg, structuredClone(qwenEditDefaults), { qwen_model: installedFile(studio.defs, 'UNETLoader', 'unet_name', qwenEditDefaults.qwen_model),
            qwen_encoder: installedFile(studio.defs, 'CLIPLoader', 'clip_name', qwenEditDefaults.qwen_encoder), qwen_vae: installedFile(studio.defs, 'VAELoader', 'vae_name', qwenEditDefaults.qwen_vae) });
        studio.saveSoon();
    }
    const element = el('div');
    function render() {
        const update = () => { changed(); studio.presetChanged(scope, element); };
        const number = (label, key, range, step) => slider(label, el('input', { type: 'number', 'aria-label': label, value: cfg[key], step, onchange: e => { cfg[key] = Number(e.target.value); update(); } }), range);
        const presets = el('div', { class: 'amm-row' }); studio.presets(presets, scope, cfg, editPresets, () => { render(); changed(); });
        const blend = el('details', {}, el('summary', { text: 'Resolution and blending' }), number('Working resolution · MP', 'megapixels', [0.25, 4], 0.05),
            number('Edge feather · px', 'feather', [0, 128], 1), number('Blend opacity · %', 'blend_opacity', [0, 100], 1));
        const models = el('details', {}, el('summary', { text: 'Qwen models' }),
            combo('Diffusion model', options(studio.defs, 'UNETLoader', 'unet_name'), cfg.qwen_model, value => { cfg.qwen_model = value; update(); }),
            combo('Text encoder · Qwen3-VL', options(studio.defs, 'CLIPLoader', 'clip_name'), cfg.qwen_encoder, value => { cfg.qwen_encoder = value; update(); }),
            combo('VAE', options(studio.defs, 'VAELoader', 'vae_name'), cfg.qwen_vae, value => { cfg.qwen_vae = value; update(); }),
            combo('Sampler', options(studio.defs, 'KSamplerSelect', 'sampler_name'), cfg.qwen_sampler, value => { cfg.qwen_sampler = value; update(); }),
            field('Sampling sigmas', el('input', { value: cfg.sigmas, 'aria-label': 'Sampling sigmas', onchange: e => { cfg.sigmas = e.target.value; update(); } })));
        element.replaceChildren(presets,
            field('Instruction', el('textarea', { value: cfg.instruction, rows: 5, 'aria-label': 'Instruction', onchange: e => { cfg.instruction = e.target.value; update(); } }),
                'Say what to change in <image1>, the canvas or selected region, and what to keep. Paint the stitch mask to keep the result only where it changed.'),
            blend, models, seed('Seed', cfg, update));
    }
    render();
    return { get cfg() { return cfg; }, element };
}
