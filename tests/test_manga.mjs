import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mangaDefaults, buildMangaPrompt, mangaControlRanges, normalizeMangaConfig } from '../web/manga-prompt.js';
import { initialSettings, options } from '../web/prompts.js';

const defs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cfg = { ...initialSettings('qwen'), ...mangaDefaults,
    model: options(defs, 'UNETLoader', 'unet_name')[0], encoder: options(defs, 'CLIPLoader', 'clip_name')[0], vae: options(defs, 'VAELoader', 'vae_name')[0] };
const graphs = [];
const invalid = { ...cfg, black: 1, white: 0, gamma: 0.18, gradation: 1.63 };
const corrected = normalizeMangaConfig({ ...invalid }, mangaControlRanges(defs));
assert.equal(corrected.black, 0.9);
assert.equal(corrected.white, 0.1);
assert.equal(corrected.gamma, 0.3);
assert.equal(corrected.gradation, 1);
const repaired = Object.values(buildMangaPrompt(defs, invalid, 'art.png').graph);
assert.equal(repaired.find(n => n.class_type === 'MangaLevels').inputs.gamma, 0.3);
assert.equal(repaired.find(n => n.class_type === 'MangaFinish').inputs.gradation, 1);
assert.equal(invalid.gradation, 1.63, 'Building a prompt does not mutate saved settings');
const updatedDefs = { ...defs, MangaLevels: { input: { required: { gamma: ['FLOAT', { min: 0.5, max: 2 }] } } } };
assert.deepEqual(mangaControlRanges(updatedDefs).gamma, [0.5, 2], 'Controls follow installed node limits');
for (const bound of [0, 1]) {
    const ranges = mangaControlRanges(defs);
    const settings = { ...cfg, ...Object.fromEntries(Object.entries(ranges).map(([key, range]) => [key, range[bound]])) };
    const nodes = Object.values(buildMangaPrompt(defs, settings, 'art.png').graph);
    for (const node of nodes) for (const [key, value] of Object.entries(node.inputs)) {
        const limits = defs[node.class_type]?.input?.required?.[key]?.[1];
        if (typeof value === 'number' && limits && typeof limits === 'object') {
            if (limits.min !== undefined) assert(value >= limits.min, `${node.class_type}.${key} below minimum`);
            if (limits.max !== undefined) assert(value <= limits.max, `${node.class_type}.${key} above maximum`);
        }
    }
}
for (const mode of ['lite', 'qwen']) for (const pen_lines of [false, true]) {
    const built = buildMangaPrompt(defs, { ...cfg, mode, pen_lines }, 'art.png');
    const nodes = Object.values(built.graph);
    assert.equal(nodes.some(n => n.class_type === 'UNETLoader'), mode === 'qwen');
    assert.equal(nodes.some(n => n.class_type === 'MangaLevels'), mode === 'lite');
    assert.equal(nodes.some(n => n.class_type === 'Manga2Anime_LineArt_Preprocessor'), pen_lines);
    assert.equal(nodes.some(n => n.class_type === 'SaveImage'), false);
    assert.equal(built.graph[built.outputNode].class_type, 'PreviewImage');
    const finish = nodes.find(n => n.class_type === 'MangaFinish');
    assert.equal(finish.inputs.screen_lines, 250);
    assert.equal(!!finish.inputs.pen_lines, pen_lines);
    const panel = nodes.find(n => n.class_type === 'MangaPanel');
    assert.equal(built.graph[panel.inputs.image[0]].class_type, 'MangaFinish');
    if (mode === 'qwen') {
        const sample = nodes.find(n => n.class_type === 'SamplerCustomAdvanced');
        assert.equal(built.graph[sample.inputs.latent_image[0]].class_type, 'TextEncodeQwenImage21');
        assert.equal(sample.inputs.latent_image[1], 2);
        assert.equal(nodes.find(n => n.class_type === 'ManualSigmas').inputs.sigmas, mangaDefaults.sigmas);
    }
    graphs.push({ ...built, op: 'manga', count: mode === 'qwen' ? 1 : 0 });
}
const missing = { ...defs }; delete missing.MangaFinish;
assert.throws(() => buildMangaPrompt(missing, cfg, 'art.png'), /ComfyUI-MangaScreen/);
delete missing.Manga2Anime_LineArt_Preprocessor;
assert.throws(() => buildMangaPrompt(missing, { ...cfg, pen_lines: true }, 'art.png'), /comfyui_controlnet_aux/);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(graphs));
console.log('Manga graphs passed: Lite/Qwen, optional pen lines, source latent, workflow sigmas, panel chain, preview and missing dependencies.');
