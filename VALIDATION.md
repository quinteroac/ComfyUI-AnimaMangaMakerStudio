# Validation — November 2, 2026

First Anima-only release, derived from Manga Maker Studio at 613aa8d plus its Style workspace work in progress.

- **16 Anima graphs and 2 Manga-Lite graphs** match the running ComfyUI's input contracts and linked output types (`check_schemas.py`): Anima text to image with negative prompt and model-only LoRA order; Anima Ref with one to four stitched references, Ref Adapter, attention backend and Safe PAG; Sketch to Art starting from the VAE-encoded drawing with its denoise; BBox to Image layout prompts with and without chroma key; style previews; enhance and describe text tasks.
- **Model inheritance:** Anima Turbo defaults for both engines, stored global models, live field inheritance, partial and empty presets and saved snapshots.
- **20 Python tests passed:** storage, routes, project ownership, containment, drawings, fonts, story and assistant.
- **Story and MCP tests passed.**
- **Chromium (real frontend, isolated storage, simulated queue):** `browser.mjs` (references and panels with Anima and Anima Ref, presets, LoRA presets, page layout and pixel-identical export, text tasks, cancellation, global models and **Use default models and sampling**, Klecks drawing and reopening, no Refinement or Finishing workspaces, unchanged ComfyUI graph), `browser_generation_engines.mjs`, `browser_sketch.mjs` with Manga-Lite and BBox to Image, and `browser_story.mjs`. No JavaScript errors.
- Rename check: routes `/anima-manga-maker/`, settings `anima-manga-maker-settings.json`, projects `anima-manga-maker-projects`, extension `AnimaMangaMaker.Studio`, CSS prefix `amm-`; the pack can load next to Manga Maker Studio.

No weights were downloaded or loaded and no actual inference was run. The running ComfyUI was not restarted; the browser tests load the extension from disk and the Python routes from an isolated fixture.
