const mangaRanges = {
    megapixels: [0.25, 8], black: [0, 0.9], white: [0.1, 1], gamma: [0.3, 3], screen_lines: [40, 600],
    white_point: [0.3, 1], black_point: [0, 0.7], light_tone: [0.02, 0.9], dark_tone: [0.02, 0.95],
    gradation: [0, 1], white_lines: [0, 1], pen_threshold: [0.05, 0.95], resolution: [512, 2048],
    crop_x: [0, 1], crop_y: [0, 1], border: [0, 40], margin: [0, 400], ink: [0, 1],
};
const numericNodes = {
    ImageScaleToTotalPixels: ['megapixels'], MangaLevels: ['black', 'white', 'gamma'],
    MangaFinish: ['screen_lines', 'white_point', 'black_point', 'light_tone', 'dark_tone', 'gradation', 'pen_threshold', 'white_lines'],
    MangaPanel: ['crop_x', 'crop_y', 'border', 'margin', 'ink'], Manga2Anime_LineArt_Preprocessor: ['resolution'],
};

export function mangaControlRanges(defs) {
    const ranges = { ...mangaRanges };
    for (const [node, keys] of Object.entries(numericNodes)) for (const key of keys) {
        const spec = defs[node]?.input;
        const limits = (spec?.required?.[key] ?? spec?.optional?.[key])?.[1];
        ranges[key] = [limits?.min ?? ranges[key][0], limits?.max ?? ranges[key][1]];
    }
    return ranges;
}

export function normalizeMangaConfig(cfg, ranges) {
    for (const [key, [min, max]] of Object.entries(ranges)) {
        const value = Number(cfg[key]);
        cfg[key] = Math.max(min, Math.min(max, Number.isFinite(value) ? value : mangaDefaults[key]));
    }
    return cfg;
}

export const mangaDefaults = {
    pen_lines: false, resolution: 1280, megapixels: 2,
    black: 0.2, white: 0.7, gamma: 1.3, screen_lines: 250, white_point: 0.8, black_point: 0.3,
    light_tone: 0.18, dark_tone: 0.42, gradation: 1, pen_threshold: 0.3, white_lines: 0.4,
    frame: 'original', crop_x: 0.5, crop_y: 0.4, border: 5, margin: 60, paper: 'white', ink: 0.5,
};

export function buildMangaPrompt(defs, cfg, imagePath) {
    cfg = normalizeMangaConfig({ ...cfg }, mangaControlRanges(defs));
    const graph = {}; let count = 0;
    const add = (type, inputs) => {
        if (!defs[type]) throw new Error(`Missing node ${type}. Install or enable ${type.startsWith('Manga2') ? 'comfyui_controlnet_aux' : type.startsWith('Manga') ? 'ComfyUI-MangaScreen' : 'its dependency'} and refresh the lists.`);
        const id = String(++count); graph[id] = { class_type: type, inputs }; return [id, 0];
    };
    let image = add('LoadImage', { image: imagePath });
    image = add('ImageScaleToTotalPixels', { image, upscale_method: 'lanczos', megapixels: Number(cfg.megapixels), resolution_steps: 32 });
    image = add('MangaLevels', { image, ...Object.fromEntries(['black', 'white', 'gamma'].map(key => [key, Number(cfg[key])])) });
    const pen = cfg.pen_lines ? add('Manga2Anime_LineArt_Preprocessor', { image, resolution: Number(cfg.resolution) }) : null;
    image = add('MangaFinish', { image, ...Object.fromEntries(['screen_lines', 'white_point', 'black_point', 'light_tone', 'dark_tone', 'gradation', 'pen_threshold', 'white_lines'].map(key => [key, Number(cfg[key])])), ...(pen ? { pen_lines: pen } : {}) });
    image = add('MangaPanel', { image, frame: cfg.frame, paper: cfg.paper, ...Object.fromEntries(['crop_x', 'crop_y', 'border', 'margin', 'ink'].map(key => [key, Number(cfg[key])])) });
    const output = add('PreviewImage', { images: image });
    return { graph, outputNode: output[0] };
}

