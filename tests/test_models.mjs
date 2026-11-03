import assert from 'node:assert/strict';
import { globalModels, inheritModels, applyPreset, savedPreset, profiles } from '../web/models.js';
const settings = { defaults: {}, models: {} }; globalModels(settings);
for (const engine of ['anima', 'anima_ref', 'anima_snapref']) {
    assert.equal(settings.models[engine].model, 'anima/anima-turbo-v1.0-int8-convrot.safetensors');
    assert.equal(settings.models[engine].steps, 8); assert.equal(settings.models[engine].cfg, 1); assert.equal(settings.models[engine].encoder_type, 'stable_diffusion');
}
assert.equal(settings.models.anima_ref.ref_adapter_lora, profiles.anima_ref.settings.ref_adapter_lora);
assert.equal(settings.models.anima_ref.ref_adapter_lora, 'anima_ref_adapter_v2_r64.safetensors'); assert.equal(settings.models.anima_snapref.snapref_mode, 'char');
const stored = { models: { anima: { model: 'anima/mangaVisionANIIL_animaV1.safetensors', steps: 30 } } }; globalModels(stored);
assert.equal(stored.models.anima.model, 'anima/mangaVisionANIIL_animaV1.safetensors'); assert.equal(stored.models.anima.steps, 30); assert.equal(stored.models.anima.vae, 'qwen_image_vae.safetensors');
const config = { prompt: 'Keep this prompt.', references: ['one'], loras: [{ name: 'manual', enabled: true }] };
inheritModels(config, settings.models.anima, 'anima'); assert.equal(config.model, settings.models.anima.model);
config.model_overrides.encoder = 'custom.safetensors'; inheritModels(config, settings.models.anima, 'anima');
assert.equal(config.encoder, 'custom.safetensors'); assert.equal(config.vae, settings.models.anima.vae);
settings.models.anima.vae = 'global-new-vae.safetensors'; inheritModels(config, settings.models.anima, 'anima');
assert.equal(config.vae, 'global-new-vae.safetensors'); assert.equal(config.encoder, 'custom.safetensors');
applyPreset(config, { prompt_sections: { subject: 'Preset subject.' } }); inheritModels(config, settings.models.anima, 'anima');
assert.equal(config.encoder, settings.models.anima.encoder); assert.equal(config.prompt, 'Keep this prompt.'); assert.deepEqual(config.references, ['one']);
applyPreset(config, { model: 'preset-model.safetensors', encoder: '', vae: null, steps: 0, cfg: 0 }); inheritModels(config, settings.models.anima, 'anima');
assert.equal(config.model, 'preset-model.safetensors'); assert.equal(config.encoder, settings.models.anima.encoder); assert.equal(config.vae, 'global-new-vae.safetensors'); assert.equal(config.steps, 0); assert.equal(config.cfg, 0);
const saved = savedPreset(config); assert.equal(saved.model, undefined); assert.equal(saved.model_overrides.model, 'preset-model.safetensors');
applyPreset(config, saved); inheritModels(config, settings.models.anima, 'anima'); assert.equal(config.model, 'preset-model.safetensors');
settings.models.anima.encoder = 'updated-global-encoder'; inheritModels(config, settings.models.anima, 'anima'); assert.equal(config.encoder, 'updated-global-encoder');
applyPreset(config, 'Prompt only'); inheritModels(config, settings.models.anima, 'anima'); assert.equal(config.model, settings.models.anima.model);
const refConfig = { references: [] }; inheritModels(refConfig, settings.models.anima_ref, 'anima_ref');
applyPreset(refConfig, { pag_scale: 0 }); inheritModels(refConfig, settings.models.anima_ref, 'anima_ref'); assert.equal(refConfig.pag_scale, 0);
applyPreset(refConfig, { pag_scale: '' }); inheritModels(refConfig, settings.models.anima_ref, 'anima_ref'); assert.equal(refConfig.pag_scale, 1.3);
console.log('Anima Turbo defaults, stored global models, live field inheritance, partial/empty presets and snapshots passed.');
