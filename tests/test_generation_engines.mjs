import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPrompt, initialSettings, composePrompt, options } from '../web/prompts.js';
import { boxGroups, rectMatrix, transformRect } from '../web/size.js';
import { globalModels, inheritModels, applyPreset, savedPreset } from '../web/models.js';

const defs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const catalog = JSON.parse(fs.readFileSync(new URL('../model-catalog.json', import.meta.url)));
const settings = {}; globalModels(settings, catalog);
const jobs = [];
for (const engine of ['moss', 'anima']) for (const op of ['references', 'panels']) {
    const cfg = inheritModels({ ...initialSettings(engine), prompt_sections: { subject: 'A manga character.' }, aspect_ratio: '9:16' }, settings.models[engine], engine);
    const built = buildPrompt(defs, op, engine, cfg, [], `${engine}-${op}`);
    const nodes = Object.values(built.graph), sampler = nodes.find(n => n.class_type === 'KSampler');
    assert.equal(sampler.inputs.steps, 8); assert.equal(sampler.inputs.cfg, 1);
    assert.equal(sampler.inputs.sampler_name, 'er_sde'); assert.equal(sampler.inputs.scheduler, 'simple'); assert.equal(sampler.inputs.denoise, 1);
    assert.equal(built.graph[sampler.inputs.positive[0]].inputs.text, composePrompt(cfg));
    const negative = built.graph[sampler.inputs.negative[0]];
    assert.equal(negative.class_type, engine === 'moss' ? 'ConditioningZeroOut' : 'CLIPTextEncode');
    if (engine === 'moss') assert.deepEqual(negative.inputs.conditioning, sampler.inputs.positive);
    else assert.equal(negative.inputs.text, cfg.negative);
    const latent = built.graph[sampler.inputs.latent_image[0]];
    assert.equal(latent.class_type, engine === 'moss' ? 'EmptyFlux2LatentImage' : 'EmptyLatentImage');
    assert(latent.inputs.width < latent.inputs.height);
    assert(!nodes.some(n => ['TextEncodeQwenImage21', 'QwenImage21Cache', 'ModelSamplingFlux', 'SetNode', 'GetNode'].includes(n.class_type)));
    assert.equal(built.graph[built.outputNode].class_type, 'SaveImage');
    assert.throws(() => buildPrompt(defs, op, engine, cfg, ['source.png'], 'invalid'), /generates from text/);
    assert.throws(() => buildPrompt(defs, op, engine, { ...cfg, model: 'missing.safetensors' }, [], 'invalid'), /missing or unregistered/);
    jobs.push({ engine, op, count: 0, ...built });
    const extra = options(defs, 'LoraLoaderModelOnly', 'lora_name').find(name => name !== cfg.accelerator_lora);
    cfg.loras = [{ name: extra, model: .4, clip: .8, enabled: true }, { name: extra, model: .9, enabled: false }];
    if (engine === 'moss') cfg.loras.push({ name: cfg.accelerator_lora, model: .7, enabled: true });
    const chained = buildPrompt(defs, op, engine, cfg, [], 'loras');
    const loras = Object.values(chained.graph).filter(n => n.class_type === 'LoraLoaderModelOnly');
    assert.equal(loras.length, engine === 'moss' ? 2 : 1);
    assert.equal(loras.at(-1).inputs.strength_model, .4);
    if (engine === 'moss') { assert.equal(loras[0].inputs.lora_name, cfg.accelerator_lora); assert.equal(loras[0].inputs.strength_model, .7); }
    assert(!Object.values(chained.graph).some(n => n.class_type === 'LoraLoader'));
    jobs.push({ engine, op, count: 0, ...chained });
    applyPreset(cfg, { steps: 6, accelerator_lora: 'custom.safetensors' }); inheritModels(cfg, settings.models[engine], engine);
    assert.equal(cfg.steps, 6); assert.equal(savedPreset(cfg).model_overrides.accelerator_lora, 'custom.safetensors');
    applyPreset(cfg, { prompt: 'New prompt' }); inheritModels(cfg, settings.models[engine], engine);
    assert.equal(cfg.steps, 8); assert.equal(cfg.accelerator_lora, settings.models[engine].accelerator_lora || '');
}
const layoutBoxes = [
    { x: 0, y: 0, width: 1, height: 0.5, type: 'object', desc: 'Sunset sky' },
    { x: 0.25, y: 0.4, width: 0.5, height: 0.6, type: 'character', desc: 'A girl with fennec ears' },
    { x: 0.1, y: 0.05, width: 0.8, height: 0.1, type: 'text', desc: 'Bold title', text: 'MANGA' }];
// MOSS-Image, Anima and Qwen receive the MOSS-Image layout prompt through their own text encoder; Krea2 gets its JSON layout below.
for (const [engine, encoder, input, empty] of [['moss', 'CLIPTextEncode', 'text', 'EmptyFlux2LatentImage'], ['anima', 'CLIPTextEncode', 'text', 'EmptyLatentImage'],
    ['qwen', 'TextEncodeQwenImage21', 'prompt', 'EmptyImage']]) {
    const cfg = inheritModels({ ...initialSettings(engine), prompt: 'A rooftop at dusk.', aspect_ratio: '1000:1500', megapixels: 1 }, settings.models[engine], engine);
    for (const [key, node, field] of [['model', 'UNETLoader', 'unet_name'], ['encoder', 'CLIPLoader', 'clip_name'], ['vae', 'VAELoader', 'vae_name']]) {
        if (!options(defs, node, field).includes(cfg[key])) cfg[key] = options(defs, node, field)[0];
    }
    for (const boxes of [layoutBoxes, layoutBoxes.slice(0, 2), []]) {
        const built = buildPrompt(defs, 'bbox', engine, { ...cfg, boxes }, [], 'bbox');
        const ids = Object.keys(built.graph), node = type => built.graph[ids.find(id => built.graph[id].class_type === type)];
        const layoutId = ids.find(id => built.graph[id].class_type === 'MOSSImageLayoutPrompt'), layout = built.graph[layoutId], create = node('CreateBoundingBoxes'), size = node(empty).inputs;
        assert.deepEqual(node(encoder).inputs[input], [layoutId, 0], `${engine} encodes the layout prompt`);
        assert.equal(layout.inputs.prompt, composePrompt(cfg)); assert.deepEqual(layout.inputs.element, [ids.find(id => built.graph[id] === create), 2]);
        assert.deepEqual([create.inputs.width, create.inputs.height, layout.inputs.width, layout.inputs.height], [size.width, size.height, size.width, size.height]);
        if (engine === 'moss') assert.equal(size.width % 16 + size.height % 16, 0);
        assert(size.width < size.height);
        assert.equal(create.inputs.editor_state.__value__.length, boxes.length);
        assert.equal(layout.inputs.character_boxes, boxes.length > 1 ? '2' : '');
        assert.equal(built.graph[built.outputNode].class_type, 'PreviewImage');
        jobs.push({ engine, op: 'bbox', count: 0, ...built });
    }
}
const kreaCfg = inheritModels({ ...initialSettings('krea'), prompt: 'A rooftop at dusk.', prompt_sections: { environment: 'Neon city at night.' }, aspect_ratio: '1000:1500', megapixels: 1 }, settings.models.krea, 'krea');
for (const [key, node, field] of [['model', 'UNETLoader', 'unet_name'], ['encoder', 'CLIPLoader', 'clip_name'], ['vae', 'VAELoader', 'vae_name']]) {
    if (!options(defs, node, field).includes(kreaCfg[key])) kreaCfg[key] = options(defs, node, field)[0];
}
const kreaBuilt = buildPrompt(defs, 'bbox', 'krea', { ...kreaCfg, boxes: [...layoutBoxes, { x: 0.5, y: 0.5, width: 0.1, height: 0.1, type: 'object', desc: ' ' }] }, [], 'bbox');
const kreaNodes = Object.values(kreaBuilt.graph), kreaSize = kreaNodes.find(n => n.class_type === 'EmptyImage').inputs;
assert(!kreaNodes.some(n => ['CreateBoundingBoxes', 'MOSSImageLayoutPrompt'].includes(n.class_type)), 'Krea2 needs no MOSS layout nodes');
const kreaLayout = JSON.parse(kreaNodes.find(n => n.class_type === 'CLIPTextEncode').inputs.text);
assert(kreaSize.width < kreaSize.height); assert.equal(kreaLayout.aspect_ratio.split(':').map(Number).reduce((w, h) => w / h), kreaSize.width / kreaSize.height);
assert.equal(kreaLayout.high_level_description, 'A rooftop at dusk.');
assert.deepEqual(kreaLayout.compositional_deconstruction, { background: 'Neon city at night.', elements: [
    { type: 'obj', bbox: [0, 0, 1000, 500], desc: 'Sunset sky, positioned in the upper-center area, occupying a large area' },
    { type: 'obj', bbox: [250, 400, 750, 1000], desc: 'A girl with fennec ears, positioned in the lower-center area, occupying a large area' },
    { type: 'text', bbox: [100, 50, 900, 150], text: 'MANGA', desc: 'Bold title, positioned in the upper-center area, occupying a small area' }] }, 'Boxes without a description are skipped');
jobs.push({ engine: 'krea', op: 'bbox', count: 0, ...kreaBuilt });
// Project style previews are shown from ComfyUI's temp folder and never saved as project assets.
for (const graph of [buildPrompt(defs, 'style', 'krea', kreaCfg, [], 'style').graph, buildPrompt(defs, 'style', 'anima', inheritModels({ ...initialSettings('anima'), prompt: 'x' }, settings.models.anima, 'anima'), [], 'style').graph]) {
    const types = Object.values(graph).map(n => n.class_type);
    assert(types.includes('PreviewImage') && !types.includes('SaveImage'));
}
const mossCfg = inheritModels({ ...initialSettings('moss'), aspect_ratio: '1000:1500', megapixels: 1, boxes: layoutBoxes }, settings.models.moss, 'moss');
const mossGraph = Object.values(buildPrompt(defs, 'bbox', 'moss', mossCfg, [], 'bbox').graph);
const [sky, character, text] = mossGraph.find(n => n.class_type === 'CreateBoundingBoxes').inputs.editor_state.__value__;
assert.deepEqual([sky.x, sky.y, sky.width], [0, 0, mossGraph.find(n => n.class_type === 'EmptyFlux2LatentImage').inputs.width]);
assert.deepEqual(text.metadata, { type: 'text', text: 'MANGA', desc: 'Bold title', palette: [] });
assert.equal(character.metadata.type, 'obj'); assert.equal(character.metadata.text, '');
assert.throws(() => buildPrompt(defs, 'bbox', 'krea_edit', { ...mossCfg, engine: 'krea_edit' }, [], 'bbox'), /requires at least one reference image/);
// Alpha output: the LoRA joins the sampler model and the decode produces RGBA; Qwen's VAE is already RGBA.
for (const [engine, op, images] of [['moss', 'bbox', []], ['krea', 'bbox', []], ['krea_edit', 'sketch', ['sketch.png']], ['qwen', 'bbox', []]]) {
    for (const alpha of engine === 'qwen' ? ['native'] : ['lora', 'chromakey']) {
        const cfg = inheritModels({ ...initialSettings(engine), prompt: 'A girl with fennec ears.', aspect_ratio: '1:1', megapixels: 1, boxes: [], alpha }, settings.models[engine], engine);
        for (const [key, node, field] of [['model', 'UNETLoader', 'unet_name'], ['encoder', 'CLIPLoader', 'clip_name'], ['vae', 'VAELoader', 'vae_name'], ['alpha_vae', engine === 'moss' ? 'RGBAVAELoader' : 'VAELoader', 'vae_name'], ['alpha_rgb_vae', 'VAELoader', 'vae_name']]) {
            if (cfg[key] && !options(defs, node, field).includes(cfg[key])) cfg[key] = options(defs, node, field)[0];
        }
        if (!options(defs, 'LoraLoaderModelOnly', 'lora_name').includes(cfg.alpha_lora)) cfg.alpha_lora = options(defs, 'LoraLoaderModelOnly', 'lora_name')[0];
        if (engine === 'moss' && !options(defs, 'LoraLoaderModelOnly', 'lora_name').includes(cfg.accelerator_lora)) cfg.accelerator_lora = '';
        const built = buildPrompt(defs, op, engine, cfg, images, 'alpha'), nodes = Object.values(built.graph);
        const decoded = built.graph[built.graph[built.outputNode].inputs.images[0]];
        assert.equal(decoded.class_type, { lora: engine === 'moss' ? 'VAEDecode' : 'JoinImageWithAlpha', chromakey: 'VNCCSChromaKey', native: 'VAEDecode' }[alpha]);
        if (alpha === 'lora' && engine === 'moss') assert.equal(built.graph[decoded.inputs.vae[0]].class_type, 'RGBAVAELoader');
        const alphaLoras = nodes.filter(n => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === cfg.alpha_lora);
        assert.equal(alphaLoras.length, alpha === 'lora' ? 1 : 0);
        const encoded = nodes.find(n => ['CLIPTextEncode', 'Krea2EditGroundedEncode', 'TextEncodeQwenImage21', 'MOSSImageLayoutPrompt'].includes(n.class_type));
        assert.match(JSON.stringify(encoded.inputs), alpha === 'chromakey' ? /#1E0050/ : /transparent background/);
        jobs.push({ engine, op, count: images.length, ...built });
    }
}
// Box 3 overlaps only box 2, so 1, 2 and 3 move as one layer; touching edges do not merge.
const groups = boxGroups([{ x: 0, y: 0, width: 0.3, height: 0.3 }, { x: 0.2, y: 0.2, width: 0.3, height: 0.3 }, { x: 0.45, y: 0.45, width: 0.2, height: 0.2 },
    { x: 0.7, y: 0, width: 0.3, height: 0.3 }, { x: 0.65, y: 0.7, width: 0.05, height: 0.1 }], { width: 1000, height: 500 });
assert.deepEqual(groups.map(g => g.boxes), [[1, 2, 3], [4], [5]]);
assert.deepEqual(groups[1].rects, [{ x: 700, y: 0, width: 300, height: 150 }]);
// Moving or resizing a box maps the old rect onto the new one; transformed rects stay inside the canvas.
const resize = rectMatrix({ x: 10, y: 20, width: 100, height: 50 }, { x: 30, y: 10, width: 200, height: 25 });
assert.deepEqual(transformRect({ x: 10, y: 20, width: 100, height: 50 }, resize, { width: 1000, height: 500 }), { x: 30, y: 10, width: 200, height: 25 });
assert.deepEqual(transformRect({ x: 60, y: 70, width: 10, height: 10 }, resize, { width: 1000, height: 500 }), { x: 130, y: 35, width: 20, height: 5 });
assert.deepEqual(transformRect({ x: 900, y: 0, width: 100, height: 10 }, { a: 1, b: 0, c: 0, d: 1, e: 50, f: -5 }, { width: 1000, height: 500 }), { x: 950, y: 0, width: 50, height: 5 });
const plain = buildPrompt(defs, 'bbox', 'anima', inheritModels({ ...initialSettings('anima'), prompt: 'x', boxes: [], alpha: 'lora' }, settings.models.anima, 'anima'), [], 'alpha');
assert(!Object.values(plain.graph).some(n => ['JoinImageWithAlpha', 'VNCCSChromaKey', 'RGBAVAELoader'].includes(n.class_type)));
// Anima Ref follows anima_ref_adapter_pag_multi: references stitched into one image, adapter guider and Safe PAG.
const animaRef = inheritModels({ ...initialSettings('anima_edit'), prompt: '1girl, solo, smile, beach', aspect_ratio: '3:4' }, settings.models.anima_edit, 'anima_edit');
for (const key of [['model', 'UNETLoader', 'unet_name'], ['encoder', 'CLIPLoader', 'clip_name'], ['vae', 'VAELoader', 'vae_name'], ['ref_adapter_lora', 'AnimaRefAdapterLoader', 'lora_name']]) {
    if (!options(defs, key[1], key[2]).includes(animaRef[key[0]])) animaRef[key[0]] = options(defs, key[1], key[2])[0];
}
assert.throws(() => buildPrompt(defs, 'panels', 'anima_edit', animaRef, [], 'anima-ref'), /at least one reference/);
for (const [op, images] of [['references', ['a.png']], ['panels', ['a.png', 'b.png', 'c.png']], ['sketch', ['sketch.png']]]) {
    const built = buildPrompt(defs, op, 'anima_edit', { ...animaRef, pag_scale: op === 'references' ? 0 : 1.3, alpha: op === 'panels' ? 'chromakey' : '' }, images, `anima-ref-${op}`);
    const nodes = Object.values(built.graph), node = type => nodes.find(n => n.class_type === type);
    assert.equal(nodes.filter(n => n.class_type === 'ImageStitch').length, images.length - 1);
    assert.equal(!!node('AnimaSafePAG'), op !== 'references');
    assert.equal(!!node('VNCCSChromaKey'), op === 'panels');
    const latent = node('AnimaRefLatent').inputs, sigmas = node('BasicScheduler').inputs;
    assert.equal(latent.width % 16, 0); assert(latent.width < latent.height);
    assert.equal(sigmas.denoise, op === 'sketch' ? animaRef.denoise : 1);
    assert.equal(node('AnimaRefGuider').inputs.ref_guidance, 1);
    assert.equal(built.graph[node('SamplerCustomAdvanced').inputs.latent_image[0]].class_type, op === 'sketch' ? 'VAEEncode' : 'AnimaRefLatent');
    assert.equal(built.graph[built.outputNode].class_type, op === 'sketch' ? 'PreviewImage' : 'SaveImage');
    jobs.push({ engine: 'anima_edit', op, count: images.length, ...built });
}
fs.writeFileSync('/tmp/manga-generation-engines-graphs.json', JSON.stringify(jobs));
console.log(`${jobs.length} Moss/Anima graphs passed: workflow sampling, conditioning, latent types, LoRA order, overrides, bbox layout prompts for every text-to-image engine and model errors.`);
