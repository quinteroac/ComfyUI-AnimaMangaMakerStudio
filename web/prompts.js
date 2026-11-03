import { imageDimensions } from './size.js';

export const promptSections = [['subject', 'Subject'], ['appearance', 'Appearance'], ['pose', 'Pose'], ['expression', 'Expression'], ['composition', 'Composition'], ['environment', 'Environment'], ['lighting', 'Lighting'], ['style', 'Style']];
const referenceStyle = 'Neutral full-color reference illustration with natural colors, clear details and consistent rendering.';

export const referencePresets = {
    Character: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Neutral standing pose with relaxed arms, showing the full body clearly.',
        expression: 'Neutral expression, consistent across views.',
        composition: 'Character reference sheet with front and side views at the same scale. Keep facial features, hairstyle, body proportions, clothing and accessories consistent across all views.',
        environment: 'Plain neutral background without distracting objects.',
        lighting: 'Even lighting that clearly reveals anatomy and costume details.',
        style: referenceStyle,
    } },
    Expressions: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Consistent head angle and portrait framing across expressions.',
        expression: 'Distinct, readable emotions: neutral, happy, sad, angry, surprised and worried. Preserve facial identity in every expression.',
        composition: 'Expression reference sheet arranged as evenly spaced close-up portraits of the same character.',
        environment: 'Plain neutral background without distracting objects.',
        style: referenceStyle,
    } },
    Poses: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Varied full-body poses with clear anatomy, balanced proportions and readable silhouettes. Preserve the same character identity and costume.',
        composition: 'Full-body pose reference sheet with separated figures, complete limbs and enough space to read each silhouette.',
        environment: 'Plain neutral background without distracting objects.',
        style: referenceStyle,
    } },
    Clothing: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        pose: 'Neutral stance that clearly displays the outfit.',
        composition: 'Costume reference sheet with front and back views and close-ups of important fabric, fastenings and accessory details. Keep the outfit consistent across views.',
        environment: 'Plain neutral background without distracting objects.',
        lighting: 'Even lighting that reveals fabric construction, texture and folds.',
        style: referenceStyle,
    } },
    Objects: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        composition: 'Object reference sheet with several clearly separated angles. Preserve the same shape, proportions, materials and identifying details in every view.',
        environment: 'Plain neutral background without distracting objects.',
        lighting: 'Clear lighting that reveals the object geometry and material details.',
        style: referenceStyle,
    } },
    Environments: { prompt: '', prompt_sections: {
        task: 'TEXT_TO_IMAGE',
        composition: 'Wide environment reference with readable perspective, coherent scale and clear foreground, middle ground and background. Show architectural and spatial details useful for consistent manga backgrounds.',
        style: referenceStyle,
    } },
};

export function referencePrompt(asset) {
    if (asset.deleted || asset.missing) return null;
    const settings = asset.metadata?.settings || {};
    const sections = {};
    for (const key of ['task', ...promptSections.map(([key]) => key)]) {
        const value = settings.prompt_sections?.[key];
        if (typeof value === 'string' && value.trim()) sections[key] = value;
    }
    const prompt = typeof settings.prompt === 'string' ? settings.prompt : '';
    if (Object.keys(sections).length) return { prompt_sections: sections, prompt };
    if (prompt.trim()) return parsePrompt(prompt) || { prompt_sections: {}, prompt };
    return parsePrompt(asset.metadata?.description_prompt || '');
}

export function parsePrompt(prompt) {
    const sections = {};
    const tags = [...prompt.matchAll(/^\s*\[(TASK\s*:\s*([^\]\n]+)|Subject|Appearance|Pose|Expression|Composition|Environment|Lighting|Style)\][ \t]*/gim)];
    const free = tags.length ? [prompt.slice(0, tags[0].index).trim()] : [];
    for (const [index, tag] of tags.entries()) {
        const key = tag[2] ? 'task' : tag[1].toLowerCase();
        const body = prompt.slice(tag.index + tag[0].length, tags[index + 1]?.index ?? prompt.length).trim();
        const value = tag[2]?.trim() || body;
        if (tag[2] && body) free.push(body);
        if (value) sections[key] = sections[key] ? `${sections[key]}\n\n${value}` : value;
    }
    return Object.keys(sections).length ? { prompt_sections: sections, prompt: free.filter(Boolean).join('\n\n') } : null;
}

export function composePrompt(config) {
    const sections = config.prompt_sections || {};
    const parts = [];
    if (sections.task?.trim()) parts.push(`[TASK: ${sections.task.trim()}]`);
    for (const [key, tag] of promptSections) {
        const value = sections[key]?.trim();
        if (value) parts.push(`[${tag}] ${value}`);
    }
    if (!parts.length) return config.prompt || '';
    if (config.prompt?.trim()) parts.push(config.prompt.trim());
    return parts.join('\n\n');
}

export function options(defs, node, field) {
    const input = defs[node]?.input;
    const spec = input?.required?.[field] || input?.optional?.[field];
    return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || [];
}

// Reference engines and how many pictures each takes: Anima Ref stitches up to four, SnapRef takes up to three of one character.
export const referenceLimits = { anima_ref: 4, anima_snapref: 3 };

// Starting values per LLLite type, from the November 2026 benchmark on Anima Turbo and mangaVision (VALIDATION.md).
// `background` fills the transparent parts of a Klecks control layer before it is sent.
export const controlTypes = {
    pose3d: { label: '3D pose', background: 'black', patch: 'anima_3dpose_6200.safetensors', strength: 1, start: 0, end: 1,
        hint: 'Shaded 3D mannequin on black. Locks the pose firmly from 0.7; above 1.0 mangaVision can add borders.' },
    depth: { label: 'Depth', background: 'black', patch: 'anima-lllite-depth-1.safetensors', strength: 1, start: 0, end: 1,
        hint: 'White near, black far. Keeps silhouette and layout while the prompt changes clothes and setting.' },
    scribble: { label: 'Scribble', background: 'black', patch: 'anima-lllite-scribble-1.safetensors', strength: 0.7, start: 0, end: 1,
        hint: 'White lines on black. Keeps the drawing\'s shapes; higher strengths copy more of its details.' },
    lineart: { label: 'Lineart', background: 'white', patch: 'anima-lllite-lineart-1.safetensors', strength: 1, start: 0, end: 1,
        hint: 'Black lines on white. Keeps every line, so it redraws the source; use it to color or ink existing art.' },
    anytest: { label: 'Any (lineart, scribble or grayscale)', background: 'white', patch: 'anima-lllite-any-test-like-v2.safetensors', strength: 0.7, start: 0, end: 1,
        hint: 'Reads lineart, scribble or a grayscale image. Grayscale at 1.0 or more reproduces the source almost exactly.' },
    regional: { label: 'Regions', background: 'black', patch: 'anima_regional_4335.safetensors', strength: 1, start: 0, end: 0.3,
        hint: 'One flat color per figure on black, shaped like the figures; the model follows the shapes literally. Name each figure\'s position in the prompt.' },
    pose: { label: 'Pose skeleton (weak)', background: 'black', patch: 'anima-lllite-pose-1.safetensors', strength: 1.3, start: 0, end: 1,
        hint: 'DWPose skeleton. Weak below 1.3; prefer 3D pose.' },
};

export function defaultAttention(defs, engine) {
    if (!referenceLimits[engine]) return '';
    return options(defs, 'ModelAttentionBackend', 'attention').includes('comfy kitchen attention') ? 'comfy kitchen attention' : 'pytorch attention';
}

// Chroma key asks for a flat background and removes it with VNCCS Chroma Key.
export const alphaMethods = { anima: ['chromakey'], anima_ref: ['chromakey'], anima_snapref: ['chromakey'] };
const alphaBackground = {
    chromakey: 'Isolated on a completely flat, uniform, solid dark indigo purple background (hex #1E0050) with no gradient, no shadow and no texture.',
};

export const textGeneratorDefaults ={ encoder: '', encoder_type: 'stable_diffusion', encoder_device: 'default', max_length: 1024 };

export function textInstruction(task, config, section) {
    const format = 'Return only an image prompt in this format: [TASK: TEXT_TO_IMAGE], then [Subject], [Appearance], [Pose], [Expression], [Composition], [Environment], [Lighting], [Style]. Put each tag and its content on a separate paragraph. Omit empty sections. Do not use markdown fences or explanations.';
    if (task === 'describe') return `Describe the supplied image precisely so an image generator can recreate it. Include visible identity, clothing, pose, expression, framing, environment, lighting, art style and legible text. Do not invent details that are not visible. ${format}`;
    const name = section === 'free' ? 'free prompt' : promptSections.find(([key]) => key === section)[1];
    const value = section === 'free' ? config.prompt : config.prompt_sections?.[section] || '';
    return `Improve only the ${name} section for clarity and useful visual detail. Preserve its meaning, identity, exact text and constraints. Use the full prompt as context to avoid contradictions. Do not change other sections or invent unrelated details. Return only the improved content of this section, without tags, markdown fences or explanations.\n\nFull prompt context:\n${composePrompt(config)}\n\nSection to improve (${name}):\n${value}`;
}

export const initialSettings = (engine) => ({
    engine, model: '', encoder: '', vae: '', encoder_type: 'stable_diffusion',
    weight_dtype: 'default', encoder_device: 'default', prompt: '', prompt_sections: {},
    aspect_ratio: '1:1', megapixels: 1, seed: 0, random_seed: true, steps: 8, cfg: 1, denoise: 0.6,
    attention: '', references: [], loras: [], controls: [], artist_chain: '', artist_strength: 1, max_length: 512, alpha: '',
    ...(engine === 'anima' ? { sampler: 'er_sde', scheduler: 'simple',
        negative: 'score_6, score_5, score_4, worst quality, low quality, text, censored, deformed, bad hand, blurry, (watermark),' } : {}),
    ...(referenceLimits[engine] ? { sampler: 'euler', scheduler: 'simple',
        negative: 'worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, chromatic aberration, bad anatomy, bad hands, extra arms, extra fingers, missing fingers, text, watermark, signature, artist name, multiple views, split screen, comic, 2koma, 4koma' } : {}),
    ...(engine === 'anima_ref' ? { ref_adapter_lora: 'anima_ref_adapter_v2_r64.safetensors', ref_guidance: 1, pag_scale: 1.3 } : {}),
    ...(engine === 'anima_snapref' ? { snapref_adapter: 'snapref_v2a_pre2.safetensors', snapref_mode: 'char', snapref_strength: 0, snapref_fidelity: 1 } : {}),
});

export function buildPrompt(defs, operation, engine, config, imagePaths, jobId) {
    const graph = {};
    let count = 0;
    const add = (type, inputs) => {
        if (!defs[type]) throw new Error(`Missing node ${type}. Install or enable its dependency and refresh the lists.`);
        const id = String(++count);
        graph[id] = { class_type: type, inputs };
        return [id, 0];
    };
    const check = (node, input, value, label) => {
        if (!defs[node]) throw new Error(`Missing node ${node}. Install or enable its dependency and refresh the lists.`);
        if (!value || !options(defs, node, input).includes(value)) throw new Error(`${label}: missing or unregistered selection (${value || 'not selected'}).`);
        return value;
    };
    const load = (name, type) => add('CLIPLoader', {
        clip_name: check('CLIPLoader', 'clip_name', name, 'Encoder'), type: check('CLIPLoader', 'type', type, 'Encoder type'), device: config.encoder_device,
    });
    const images = imagePaths.map(image => add('LoadImage', { image }));
    if (operation === 'enhance' || operation === 'describe') {
        if (operation === 'describe' && !images.length) throw new Error('Select a reference to analyze.');
        const clip = load(config.encoder, config.encoder_type);
        const text = add('TextGenerate', { clip, prompt: config.instruction, max_length: Number(config.max_length),
            sampling_mode: 'off', thinking: false, use_default_template: true, mtp: 'auto', ...(operation === 'describe' ? { image: images[0] } : {}) });
        const output = add('SaveText', { text, filename_prefix: `anima-manga-maker/${jobId}/${operation}`, format: 'txt' });
        return { graph, outputNode: output[0] };
    }
    const alpha = alphaMethods[engine]?.includes(config.alpha) ? config.alpha : '';
    const prompt = [composePrompt(config), alphaBackground[alpha]].filter(Boolean).join('\n\n');
    // Settings follow the chroma key workflows.
    const decode = (samples, vae) => alpha === 'chromakey' ? add('VNCCSChromaKey', { image: add('VAEDecode', { samples, vae }), tolerance: 0.15, softness: 0.12, despill_strength: 0.65, edge_width: 3,
        matte_cleanup: 0.1, foreground_recover: 0.35, edge_decontaminate: 0.75, edge_choke: 0.08, matte_method: 'guided_edge', screen_mode: 'auto', output_mode: 'straight_rgba', use_sam3_recovery_mask: false })
        : add('VAEDecode', { samples, vae });
    // Drawing editor results and project style previews stay in ComfyUI's temp folder instead of the project.
    const save = images => ['sketch', 'bbox', 'style', 'inpaint'].includes(operation) ? add('PreviewImage', { images }) : add('SaveImage', { images, filename_prefix: `anima-manga-maker/${jobId}/result` });
    const size = imageDimensions(config, 8);
    let model = add('UNETLoader', { unet_name: check('UNETLoader', 'unet_name', config.model, 'Model'), weight_dtype: config.weight_dtype });
    const clip = load(config.encoder, config.encoder_type);
    const vae = add('VAELoader', { vae_name: check('VAELoader', 'vae_name', config.vae, 'VAE') });
    const limit = referenceLimits[engine];
    if (limit && !images.length) throw new Error(`${engine === 'anima_ref' ? 'Anima Ref' : 'SnapRef'} requires at least one reference image.`);
    if (limit && images.length > limit) throw new Error(`${engine === 'anima_ref' ? 'Anima Ref' : 'SnapRef'} supports up to ${limit} reference images.`);
    if (!limit && images.length) throw new Error('This workflow generates from text. Use Anima Ref or SnapRef to connect visual references.');
    // Chain order follows the CharRef-LLLite workflows: LoRAs, LLLite controls, then the reference adapter.
    for (const lora of config.loras.filter(l => l.enabled)) {
        model = add('LoraLoaderModelOnly', { model, lora_name: check('LoraLoaderModelOnly', 'lora_name', lora.name, 'LoRA'), strength_model: Number(lora.model) });
    }
    // Controls are staged with the job; operations that stage no control image (sketch, bbox, previews) run without them.
    const controls = (config.controls || []).filter(c => c.enabled && c.image_path);
    let inpaint;
    if (operation === 'inpaint') {
        // Masked image-to-image on the staged crop: the inpainting LLLite sees the image outside the mask, and only the mask is denoised.
        if (engine !== 'anima') throw new Error('Inpainting uses the Anima engine.');
        const pixels = add('ImageScale', { image: add('LoadImage', { image: config.inpaint.image_path }), upscale_method: 'lanczos', ...size, crop: 'disabled' });
        const mask = add('ImageToMask', { image: add('LoadImage', { image: config.inpaint.mask_path }), channel: 'red' });
        if (config.inpaint.patch) model = add('AnimaLLLiteApply', { model, model_patch: add('ModelPatchLoader', { name: check('ModelPatchLoader', 'name', config.inpaint.patch, 'Inpainting model') }),
            image: pixels, strength: Number(config.inpaint.strength ?? 1), start_percent: 0, end_percent: 1, mask });
        inpaint = add('SetLatentNoiseMask', { samples: add('VAEEncode', { pixels, vae }), mask });
    }
    for (const control of controls) {
        // The Ref Adapter adds the reference frame to the sequence, so its LLLite must skip that frame (ComfyUI-Anima-CharRef-LLLite).
        model = add(engine === 'anima_ref' ? 'ExperimentalAnimaLLLiteRefApply' : 'AnimaLLLiteApply', { model,
            model_patch: add('ModelPatchLoader', { name: check('ModelPatchLoader', 'name', control.patch, 'Control model') }), image: add('LoadImage', { image: control.image_path }),
            strength: Number(control.strength), start_percent: Number(control.start), end_percent: Number(control.end) });
    }
    if (engine === 'anima_ref') {
        const loader = controls.length ? 'ExperimentalAnimaRefAdapterControlsLoader' : 'AnimaRefAdapterLoader';
        model = add(loader, { model, lora_name: check(loader, 'lora_name', config.ref_adapter_lora, 'Ref Adapter LoRA'), strength: 1, ref_offset_h: 1 });
    }
    if (engine === 'anima_snapref') {
        // SnapRef's extra pictures are more views of the same character.
        model = add('SnapRef', { model, clip, vae, ...Object.fromEntries(images.map((image, i) => [['image', 'image_2', 'image_3'][i], image])),
            adapter: check('SnapRef', 'adapter', config.snapref_adapter, 'SnapRef adapter'), mode: config.snapref_mode, ref_in_uncond: false, ref_megapixels: 1,
            strength: Number(config.snapref_strength), ref_caption: '', ref_guidance_on: false, ref_guidance: 4.5, correction: 'apg', ref_end: 1,
            use_batch: false, multi_layout: 'separate', weight_1: 1, weight_2: 1, weight_3: 1, fidelity: Number(config.snapref_fidelity) });
    }
    if (limit) model = add('ModelComputeDtype', { model, dtype: 'bf16' });
    const attention = config.attention || defaultAttention(defs, engine);
    if (attention) model = add('ModelAttentionBackend', { model, attention: check('ModelAttentionBackend', 'attention', attention, 'Attention') });
    if (engine === 'anima_ref' && Number(config.pag_scale)) model = add('AnimaSafePAG', { model, scale: Number(config.pag_scale), block_indices: '18', perturbation_strength: 0.75, head_indices: '',
        start_percent: 0.3, end_percent: 0.8, rescale: 0.2, rescale_mode: 'full' });
    let text = prompt;
    if (operation === 'bbox') {
        // Boxes are stored as canvas fractions and written in the MOSS-Image layout format, like the official bbox template; Anima receives it as prompt text.
        // List widget values are wrapped in __value__ because a bare list means a link in API prompts.
        const boxes = add('CreateBoundingBoxes', { ...size, editor_state: { __value__: config.boxes.map(box => ({
            x: Math.round(box.x * size.width), y: Math.round(box.y * size.height), width: Math.round(box.width * size.width), height: Math.round(box.height * size.height),
            metadata: { type: box.type === 'text' ? 'text' : 'obj', text: box.type === 'text' ? box.text || '' : '', desc: box.desc || '', palette: [] } })) } });
        text = add('MOSSImageLayoutPrompt', { prompt, element: [boxes[0], 2], ...size,
            character_boxes: config.boxes.flatMap((box, i) => box.type === 'character' ? [i + 1] : []).join(', ') });
    }
    let positive;
    if (config.artist_chain?.trim()) {
        // Anima Artist Mixer: the artists' style is mixed into the model and the prompt conditioning.
        const mixer = add('AnimaArtistAdapterMixer', { model, artist_pack: add('AnimaArtistPack', { clip, artist_chain: config.artist_chain.trim(), base_prompt: text }),
            strength: Number(config.artist_strength ?? 1), normalize_weights: true, alignment_mode: 'base_anchored', enabled: true, apply_to_uncond: false, uncond_strength: 0 });
        model = mixer; positive = [mixer[0], 1];
    } else positive = add('CLIPTextEncode', { clip, text });
    const negative = add('CLIPTextEncode', { clip, text: config.negative });
    let sampled;
    if (engine === 'anima_ref') {
        // The adapter reads one reference image, so several references are placed side by side.
        const reference = images.slice(1).reduce((image1, image2) => add('ImageStitch', { image1, image2, direction: 'right', match_image_size: true, spacing_width: 0, spacing_color: 'white' }), images[0]);
        const encoded = add('AnimaRefLatent', { image: reference, vae, ...imageDimensions(config, 16), fill: 255 });
        const guider = add('AnimaRefGuider', { model, positive, negative, ref_latent: encoded, cfg: Number(config.cfg), ref_guidance: Number(config.ref_guidance ?? 1), correction: 'apg', rescale_phi: 0.5 });
        // Sketch to Art also starts from the drawing, letterboxed to the reference latent size.
        const sketching = operation === 'sketch';
        const latent = sketching ? add('VAEEncode', { pixels: [encoded[0], 2], vae }) : [encoded[0], 1];
        const sigmas = add('BasicScheduler', { model, scheduler: config.scheduler, steps: Number(config.steps), denoise: sketching ? Number(config.denoise ?? 0.6) : 1 });
        sampled = add('SamplerCustomAdvanced', { noise: add('RandomNoise', { noise_seed: Number(config.seed) }), guider, sampler: add('KSamplerSelect', { sampler_name: config.sampler }), sigmas, latent_image: latent });
    } else {
        sampled = add('KSampler', { model, positive, negative, latent_image: inpaint || add('EmptyLatentImage', { ...size, batch_size: 1 }), seed: Number(config.seed), steps: Number(config.steps),
            cfg: Number(config.cfg), sampler_name: config.sampler, scheduler: config.scheduler, denoise: inpaint ? Number(config.denoise) : 1 });
    }
    return { graph, outputNode: save(decode(sampled, vae))[0] };
}
