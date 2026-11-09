import assert from 'node:assert/strict';
import fs from 'node:fs';
import { qwenEditDefaults, installedFile, buildQwenEditPrompt } from '../web/qwen-prompt.js';

const defs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cfg = { ...qwenEditDefaults, seed: 7 };
for (const [key, node, input] of [['qwen_model', 'UNETLoader', 'unet_name'], ['qwen_encoder', 'CLIPLoader', 'clip_name'], ['qwen_vae', 'VAELoader', 'vae_name']]) {
    cfg[key] = installedFile(defs, node, input, cfg[key]);
    // Stand-in when the default weights are not installed where the tests run.
    if (!defs[node].input.required[input][0].includes(cfg[key])) defs[node].input.required[input][0].push(cfg[key]);
}
const built = buildQwenEditPrompt(defs, cfg, 'drawing.png');
const nodes = Object.values(built.graph), by = type => nodes.find(n => n.class_type === type);
const encoder = by('TextEncodeQwenImage21'), image = Object.keys(encoder.inputs).find(key => key.startsWith('images.'));
assert.equal(encoder.inputs.prompt, cfg.instruction);
assert.equal(built.graph[encoder.inputs[image][0]].class_type, 'ImageScaleToTotalPixels');
assert.equal(by('CLIPLoader').inputs.type, 'qwen_image');
assert.deepEqual(by('SamplerCustomAdvanced').inputs.latent_image, [Object.entries(built.graph).find(([, n]) => n === encoder)[0], 2]);
assert.equal(by('ManualSigmas').inputs.sigmas, qwenEditDefaults.sigmas);
assert.equal(by('RandomNoise').inputs.noise_seed, 7);
assert.equal(built.graph[built.outputNode].class_type, 'PreviewImage');
assert.throws(() => buildQwenEditPrompt(defs, { ...cfg, instruction: ' ' }, 'drawing.png'), /instruction/);
assert.throws(() => buildQwenEditPrompt(defs, { ...cfg, qwen_model: 'missing.safetensors' }, 'drawing.png'), /unet_name/);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify([{ op: 'edit', engine: 'qwen_edit', count: 1, ...built }]));
console.log('Qwen edit graph passed: instruction, scaled drawing as <image1>, Turbo sigmas, encoder latent, preview and missing selections.');
