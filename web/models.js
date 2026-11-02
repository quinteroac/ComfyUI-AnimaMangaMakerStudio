import { initialSettings } from './prompts.js';

export const modelFields = ['model', 'encoder', 'vae', 'encoder_type', 'weight_dtype', 'encoder_device', 'attention', 'steps', 'cfg', 'sampler', 'scheduler',
    'ref_adapter_lora', 'ref_guidance', 'pag_scale'];
const defined = value => value !== undefined && value !== null && value !== '';
export const modelValues = value => Object.fromEntries(modelFields.filter(key => defined(value?.[key])).map(key => [key, structuredClone(value[key])]));

// Anima Turbo defaults from the local anima_ref_adapter_pag_multi and Anima-Komikku workflows; every field stays editable in Settings.
const animaModels = { model: 'anima/anima-turbo-v1.0-int8-convrot.safetensors', encoder: 'qwen_3_06b_base.safetensors', vae: 'qwen_image_vae.safetensors',
    encoder_type: 'stable_diffusion', weight_dtype: 'default', encoder_device: 'default', steps: 8, cfg: 1 };
export const profiles = {
    anima: { name: 'Anima', settings: { ...animaModels, sampler: 'er_sde', scheduler: 'simple' } },
    anima_ref: { name: 'Anima Ref', settings: { ...animaModels, sampler: 'euler', scheduler: 'simple', ref_adapter_lora: 'anima_ref_adapter_pilot_r32.safetensors', ref_guidance: 1, pag_scale: 1.3 } },
};

export function globalModels(settings) {
    settings.models ||= {};
    for (const [engine, profile] of Object.entries(profiles)) {
        settings.models[engine] = { ...modelValues(initialSettings(engine)), ...profile.settings, ...settings.models[engine], engine };
    }
}

export function inheritModels(config, global, engine) {
    const base = { ...initialSettings(engine), ...global };
    if (!config.model_overrides) {
        config.model_overrides = {};
        if (config.model || config.encoder || config.vae) {
            for (const [key, value] of Object.entries(modelValues(config))) if (value !== base[key]) config.model_overrides[key] = value;
        }
    }
    for (const key of modelFields) config[key] = defined(config.model_overrides[key]) ? config.model_overrides[key] : base[key];
    return config;
}

export function applyPreset(config, preset) {
    if (typeof preset === 'string') { config.prompt = preset; config.model_overrides = {}; return; }
    Object.assign(config, structuredClone(preset));
    config.model_overrides = modelValues(preset.model_overrides || preset);
}

export function savedPreset(config) {
    const preset = structuredClone(config);
    for (const key of modelFields) delete preset[key];
    return preset;
}
