import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPrompt, initialSettings, options, composePrompt, referencePrompt, parsePrompt, referencePresets, promptSections, textInstruction, textGeneratorDefaults } from '../web/prompts.js';
import { boxGroups, rectMatrix, transformRect } from '../web/size.js';
import { globalModels, inheritModels } from '../web/models.js';

const defs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const settings = {}; globalModels(settings);
// Fixture selections stand in for weights that are not installed where the tests run.
const configFor = (engine, values = {}) => {
    const cfg = inheritModels({ ...initialSettings(engine), ...values }, settings.models[engine], engine);
    for (const [key, node, field] of [['model', 'UNETLoader', 'unet_name'], ['encoder', 'CLIPLoader', 'clip_name'], ['vae', 'VAELoader', 'vae_name'], ['ref_adapter_lora', 'AnimaRefAdapterLoader', 'lora_name']]) {
        if (cfg[key] && !options(defs, node, field).includes(cfg[key])) cfg[key] = options(defs, node, field)[0];
    }
    return cfg;
};
const jobs = [];

for (const preset of Object.values(referencePresets)) {
    assert.equal(preset.prompt, ''); assert.equal(preset.prompt_sections.task, 'TEXT_TO_IMAGE');
    assert(Object.keys(preset.prompt_sections).every(key => key === 'task' || promptSections.some(([name]) => name === key)));
    assert.deepEqual(parsePrompt(composePrompt(preset)), preset);
    assert(!Object.keys(preset).some(key => ['model', 'encoder', 'vae', 'steps', 'loras'].includes(key)));
}

// Anima follows the Turbo text-to-image workflow: KSampler with the negative prompt and an empty latent.
for (const op of ['references', 'panels']) {
    const cfg = configFor('anima', { prompt_sections: { subject: '1girl, fennec ears.' }, aspect_ratio: '9:16' });
    const built = buildPrompt(defs, op, 'anima', cfg, [], `anima-${op}`);
    const nodes = Object.values(built.graph), sampler = nodes.find(n => n.class_type === 'KSampler');
    assert.equal(sampler.inputs.steps, 8); assert.equal(sampler.inputs.cfg, 1);
    assert.equal(sampler.inputs.sampler_name, 'er_sde'); assert.equal(sampler.inputs.scheduler, 'simple'); assert.equal(sampler.inputs.denoise, 1);
    assert.equal(built.graph[sampler.inputs.positive[0]].inputs.text, composePrompt(cfg));
    assert.equal(built.graph[sampler.inputs.negative[0]].inputs.text, cfg.negative);
    const latent = built.graph[sampler.inputs.latent_image[0]];
    assert.equal(latent.class_type, 'EmptyLatentImage'); assert(latent.inputs.width < latent.inputs.height);
    assert.equal(nodes.find(n => n.class_type === 'CLIPLoader').inputs.type, 'stable_diffusion');
    assert(!nodes.some(n => n.class_type === 'ModelAttentionBackend'));
    assert.equal(built.graph[built.outputNode].class_type, 'SaveImage');
    assert.throws(() => buildPrompt(defs, op, 'anima', cfg, ['source.png'], 'invalid'), /generates from text/);
    assert.throws(() => buildPrompt(defs, op, 'anima', { ...cfg, model: 'missing.safetensors' }, [], 'invalid'), /missing or unregistered/);
    jobs.push({ engine: 'anima', op, count: 0, ...built });
    const lora = options(defs, 'LoraLoaderModelOnly', 'lora_name')[0];
    cfg.loras = [{ name: lora, model: .4, enabled: true }, { name: lora, model: .9, enabled: false }, { name: lora, model: .7, enabled: true }];
    const chained = buildPrompt(defs, op, 'anima', cfg, [], 'loras');
    const loras = Object.entries(chained.graph).filter(([, n]) => n.class_type === 'LoraLoaderModelOnly');
    assert.deepEqual(loras.map(([, n]) => n.inputs.strength_model), [.4, .7]); assert.deepEqual(loras[1][1].inputs.model, [loras[0][0], 0]);
    assert.deepEqual(Object.values(chained.graph).find(n => n.class_type === 'KSampler').inputs.model, [loras[1][0], 0]);
    jobs.push({ engine: 'anima', op, count: 0, ...chained });
}

// Anima Ref follows anima_ref_adapter_pag_multi: references stitched into one image, adapter guider and Safe PAG.
const animaRef = configFor('anima_ref', { prompt: '1girl, solo, smile, beach', aspect_ratio: '3:4' });
assert.throws(() => buildPrompt(defs, 'panels', 'anima_ref', animaRef, [], 'anima-ref'), /at least one reference/);
for (const [op, images] of [['references', ['a.png']], ['panels', ['a.png', 'b.png', 'c.png', 'd.png']], ['sketch', ['sketch.png']]]) {
    const built = buildPrompt(defs, op, 'anima_ref', { ...animaRef, pag_scale: op === 'references' ? 0 : 1.3, alpha: op === 'panels' ? 'chromakey' : '' }, images, `anima-ref-${op}`);
    const nodes = Object.values(built.graph), node = type => nodes.find(n => n.class_type === type);
    assert.equal(nodes.filter(n => n.class_type === 'ImageStitch').length, images.length - 1);
    assert.equal(!!node('AnimaSafePAG'), op !== 'references');
    assert.equal(!!node('VNCCSChromaKey'), op === 'panels');
    assert.equal(node('ModelAttentionBackend').inputs.attention, options(defs, 'ModelAttentionBackend', 'attention').includes('comfy kitchen attention') ? 'comfy kitchen attention' : 'pytorch attention');
    const latent = node('AnimaRefLatent').inputs, sigmas = node('BasicScheduler').inputs;
    assert.equal(latent.width % 16, 0); assert(latent.width < latent.height);
    assert.equal(sigmas.denoise, op === 'sketch' ? animaRef.denoise : 1);
    assert.equal(node('AnimaRefGuider').inputs.ref_guidance, 1);
    assert.equal(built.graph[node('SamplerCustomAdvanced').inputs.latent_image[0]].class_type, op === 'sketch' ? 'VAEEncode' : 'AnimaRefLatent');
    assert.equal(built.graph[built.outputNode].class_type, op === 'sketch' ? 'PreviewImage' : 'SaveImage');
    jobs.push({ engine: 'anima_ref', op, count: images.length, ...built });
}

// Anima receives the MOSS-Image layout prompt through its own text encoder.
const layoutBoxes = [
    { x: 0, y: 0, width: 1, height: 0.5, type: 'object', desc: 'Sunset sky' },
    { x: 0.25, y: 0.4, width: 0.5, height: 0.6, type: 'character', desc: 'A girl with fennec ears' },
    { x: 0.1, y: 0.05, width: 0.8, height: 0.1, type: 'text', desc: 'Bold title', text: 'MANGA' }];
const bboxCfg = configFor('anima', { prompt: 'A rooftop at dusk.', aspect_ratio: '1000:1500', megapixels: 1 });
for (const boxes of [layoutBoxes, layoutBoxes.slice(0, 2), []]) for (const alpha of ['', 'chromakey']) {
    const built = buildPrompt(defs, 'bbox', 'anima', { ...bboxCfg, boxes, alpha }, [], 'bbox');
    const ids = Object.keys(built.graph), node = type => built.graph[ids.find(id => built.graph[id].class_type === type)];
    const layoutId = ids.find(id => built.graph[id].class_type === 'MOSSImageLayoutPrompt'), layout = built.graph[layoutId], create = node('CreateBoundingBoxes'), size = node('EmptyLatentImage').inputs;
    assert.deepEqual(node('KSampler').inputs.positive, [ids.find(id => built.graph[id].class_type === 'CLIPTextEncode' && built.graph[id].inputs.text[0] === layoutId), 0]);
    assert.match(layout.inputs.prompt, alpha ? /#1E0050/ : /^A rooftop at dusk\.$/);
    assert.deepEqual([create.inputs.width, create.inputs.height, layout.inputs.width, layout.inputs.height], [size.width, size.height, size.width, size.height]);
    assert(size.width < size.height);
    assert.equal(create.inputs.editor_state.__value__.length, boxes.length);
    assert.equal(layout.inputs.character_boxes, boxes.length > 1 ? '2' : '');
    assert.equal(built.graph[built.graph[built.outputNode].inputs.images[0]].class_type, alpha ? 'VNCCSChromaKey' : 'VAEDecode');
    assert.equal(built.graph[built.outputNode].class_type, 'PreviewImage');
    jobs.push({ engine: 'anima', op: 'bbox', count: 0, ...built });
}
const [sky, character, text] = Object.values(buildPrompt(defs, 'bbox', 'anima', { ...bboxCfg, boxes: layoutBoxes }, [], 'bbox').graph).find(n => n.class_type === 'CreateBoundingBoxes').inputs.editor_state.__value__;
assert.deepEqual([sky.x, sky.y], [0, 0]);
assert.deepEqual(text.metadata, { type: 'text', text: 'MANGA', desc: 'Bold title', palette: [] });
assert.equal(character.metadata.type, 'obj'); assert.equal(character.metadata.text, '');
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

// Project style previews are shown from ComfyUI's temp folder and never saved as project assets.
const style = buildPrompt(defs, 'style', 'anima', configFor('anima', { prompt: 'x' }), [], 'style');
assert.equal(style.graph[style.outputNode].class_type, 'PreviewImage');
jobs.push({ engine: 'anima', op: 'style', count: 0, ...style });

for (const task of ['enhance', 'describe']) {
    const context = { prompt_sections: { subject: 'A character.', style: 'Manga.' }, prompt: 'Keep the costume.' };
    const instruction = textInstruction(task, context, 'subject');
    const config = { ...textGeneratorDefaults, encoder: options(defs, 'CLIPLoader', 'clip_name')[0], instruction };
    const built = buildPrompt(defs, task, 'text', config, task === 'describe' ? ['reference.png'] : [], crypto.randomUUID());
    const generated = Object.values(built.graph).find(n => n.class_type === 'TextGenerate');
    assert.equal(generated.inputs.prompt, instruction);
    assert.equal(!!generated.inputs.image, task === 'describe');
    assert(!Object.values(built.graph).some(n => ['UNETLoader', 'VAELoader', 'KSampler'].includes(n.class_type)));
    if (task === 'enhance') { assert(instruction.includes('Improve only the Subject')); assert(instruction.includes('[Style] Manga.')); }
    jobs.push({ engine: 'text', op: task, count: task === 'describe' ? 1 : 0, ...built });
}
assert.equal(referencePrompt({ kind: 'references', metadata: { description_prompt: '[Subject] Imported character.\n\n[Style] Manga.' } }).prompt_sections.subject, 'Imported character.');
assert.equal(parsePrompt('No recognizable sections.'), null);
const sections = { task: 'TEXT_TO_IMAGE', subject: 'One adult woman on a couch.', appearance: 'Blue eyes and a black dress.', pose: 'Seated, looking forward.', lighting: '  \n ', style: 'Anime illustration.' };
const free = 'Keep the costume consistent.';
const reference = { kind: 'references', metadata: { settings: { prompt_sections: sections, prompt: free } } };
const restored = referencePrompt(reference);
assert.equal(restored.prompt_sections.subject, sections.subject);
assert.equal(restored.prompt, free);
restored.prompt_sections.subject = 'Changed';
assert.equal(reference.metadata.settings.prompt_sections.subject, sections.subject);
for (const asset of [{ kind: 'references' }, { ...reference, deleted: true }, { ...reference, missing: true }]) assert.equal(referencePrompt(asset), null);
for (const kind of ['references', 'panels', 'pages']) {
    assert.deepEqual(referencePrompt({ ...reference, kind }), referencePrompt(reference));
    assert.deepEqual(referencePrompt({ kind, metadata: { settings: { prompt: 'An unstructured prompt.' } } }), { prompt_sections: {}, prompt: 'An unstructured prompt.' });
}
const expected = '[TASK: TEXT_TO_IMAGE]\n\n[Subject] One adult woman on a couch.\n\n[Appearance] Blue eyes and a black dress.\n\n[Pose] Seated, looking forward.\n\n[Style] Anime illustration.\n\nKeep the costume consistent.';
assert.equal(composePrompt({ prompt_sections: sections, prompt: free }), expected);
assert.equal(composePrompt({ prompt_sections: { lighting: '  ' }, prompt: '  free prompt\n' }), '  free prompt\n');
assert.equal(composePrompt({ prompt_sections: {}, prompt: '' }), '');
assert.throws(() => buildPrompt({}, 'panels', 'anima', configFor('anima'), [], crypto.randomUUID()), /Missing node/);

if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(jobs));
console.log(`${jobs.length} Anima graphs passed: Turbo sampling, negative prompt, LoRA order, Anima Ref stitching and PAG, sketch latent, bbox layout prompts, chroma key, style previews and text tasks.`);
