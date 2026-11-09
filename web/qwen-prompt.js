import { options } from './prompts.js';

// Qwen Image 2.1 Turbo instruction editing, as QWEN-Manga in Manga Maker Studio: 8 steps, euler, its own Turbo sigmas.
export const qwenEditDefaults = {
    qwen_model: 'qwen_image_2.1_turbo_bf16.safetensors', qwen_encoder: 'Huihui-Qwen3-VL-8B-Instruct-abliterated_int8_convrot.safetensors', qwen_vae: 'qwen_image_2.1_vae_bf16.safetensors',
    instruction: 'Remove the sign from <image1> and continue the surrounding background in its place. Keep everything else in <image1> unchanged.',
    megapixels: 1, qwen_sampler: 'euler', sigmas: '1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0',
    cache_device: 'auto', cache_dtype: 'default', seed: 0, random_seed: true, feather: 16, blend_opacity: 100,
};

// The installed copy of a default file, found by filename in any subfolder.
export const installedFile = (defs, node, key, name) => options(defs, node, key).find(file => file.split('/').at(-1) === name) || name;

export function buildQwenEditPrompt(defs, cfg, imagePath) {
    const graph = {}; let count = 0;
    const add = (type, inputs) => {
        if (!defs[type]) throw new Error(`Missing node ${type}. Update ComfyUI and refresh the lists.`);
        const id = String(++count); graph[id] = { class_type: type, inputs }; return [id, 0];
    };
    const selected = (node, key, value) => {
        if (!options(defs, node, key).includes(value)) throw new Error(`${key}: missing or unregistered selection (${value || 'not selected'}).`);
        return value;
    };
    const names = defs.TextEncodeQwenImage21?.input.required.images?.[1]?.template?.names;
    if (!names?.length) throw new Error('Missing node TextEncodeQwenImage21 with visual inputs. Update ComfyUI and refresh the lists.');
    if (!cfg.instruction?.trim()) throw new Error('Write the edit instruction first.');
    let image = add('LoadImage', { image: imagePath });
    image = add('ImageScaleToTotalPixels', { image, upscale_method: 'lanczos', megapixels: Number(cfg.megapixels), resolution_steps: 32 });
    let model = add('UNETLoader', { unet_name: selected('UNETLoader', 'unet_name', cfg.qwen_model), weight_dtype: 'default' });
    const clip = add('CLIPLoader', { clip_name: selected('CLIPLoader', 'clip_name', cfg.qwen_encoder), type: 'qwen_image', device: 'default' });
    const vae = add('VAELoader', { vae_name: selected('VAELoader', 'vae_name', cfg.qwen_vae) });
    const encoded = add('TextEncodeQwenImage21', { clip, vae, prompt: cfg.instruction, negative_prompt: '', resolution: 0, [`images.${names[0]}`]: image });
    if (defs.QwenImage21Cache) model = add('QwenImage21Cache', { model, device: cfg.cache_device, dtype: cfg.cache_dtype });
    const samples = add('SamplerCustomAdvanced', { noise: add('RandomNoise', { noise_seed: Number(cfg.seed) }), guider: add('BasicGuider', { model, conditioning: encoded }),
        sampler: add('KSamplerSelect', { sampler_name: selected('KSamplerSelect', 'sampler_name', cfg.qwen_sampler) }), sigmas: add('ManualSigmas', { sigmas: cfg.sigmas }),
        latent_image: [encoded[0], 2] });
    const output = add('PreviewImage', { images: add('VAEDecode', { samples, vae }) });
    return { graph, outputNode: output[0] };
}
