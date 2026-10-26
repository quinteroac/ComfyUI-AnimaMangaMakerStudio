// Overlapping boxes, also through a chain of boxes, form one group; boxes are canvas fractions and rects come back in pixels of `size`.
export function boxGroups(boxes, size) {
    const rects = boxes.map(box => ({ x: Math.round(box.x * size.width), y: Math.round(box.y * size.height), width: Math.round(box.width * size.width), height: Math.round(box.height * size.height) }));
    const group = rects.map((_, i) => i);
    const find = i => group[i] === i ? i : (group[i] = find(group[i]));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) group[find(j)] = find(i);
    }
    const groups = new Map();
    rects.forEach((rect, i) => { if (!groups.has(find(i))) groups.set(find(i), { boxes: [], rects: [] }); groups.get(find(i)).boxes.push(i + 1); groups.get(find(i)).rects.push(rect); });
    return [...groups.values()];
}

// Affine matrix in canvas pixels, as Klecks reports transforms: x' = a*x + c*y + e, y' = b*x + d*y + f.
export function rectMatrix(from, to) {
    const a = to.width / from.width, d = to.height / from.height;
    return { a, b: 0, c: 0, d, e: to.x - from.x * a, f: to.y - from.y * d };
}

// Bounds of a transformed rect, clipped to the canvas; a rotated box keeps its axis-aligned bounds.
export function transformRect(rect, m, size) {
    const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]];
    const xs = corners.map(([x, y]) => m.a * x + m.c * y + m.e), ys = corners.map(([x, y]) => m.b * x + m.d * y + m.f);
    const left = Math.max(0, Math.min(...xs)), top = Math.max(0, Math.min(...ys));
    return { x: left, y: top, width: Math.min(size.width, Math.max(...xs)) - left, height: Math.min(size.height, Math.max(...ys)) - top };
}

export const aspectRatios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '1:2', '2:1', '9:21', '21:9', '210:297', '297:210'];

export function sizeSettings(value) {
    if (value.aspect_ratio && value.megapixels != null) return { aspect_ratio: value.aspect_ratio, megapixels: Number(value.megapixels) };
    const width = Number(value.width || 1000), height = Number(value.height || 1000);
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = gcd(width, height);
    return { aspect_ratio: `${width / divisor}:${height / divisor}`, megapixels: width * height / 1e6 };
}

export function imageDimensions(value, alignment = 8) {
    const { aspect_ratio, megapixels } = sizeSettings(value);
    const [x, y] = aspect_ratio.split(':').map(Number);
    if (![x, y, megapixels].every(n => Number.isFinite(n) && n > 0)) throw new Error('Use a positive aspect ratio and resolution in MP.');
    const width = Math.sqrt(megapixels * 1e6 * x / y);
    const height = Math.sqrt(megapixels * 1e6 * y / x);
    return { width: Math.max(alignment, Math.round(width / alignment) * alignment), height: Math.max(alignment, Math.round(height / alignment) * alignment) };
}

export function sizeLabel(value) {
    const size = sizeSettings(value);
    return `${Number(size.megapixels.toFixed(3))} MP · ${size.aspect_ratio}`;
}
