# LLLite benchmark — November 2, 2026

Real inference on the running ComfyUI (RTX 5060 Ti), Anima Turbo int8 (8 steps, CFG 1, ER SDE) and mangaVision (30 steps, CFG 4.5, ER SDE), 832×1216, seed 42, core `AnimaLLLiteApply`. Controls were extracted from a Turbo source illustration with comfyui_controlnet_aux (AnimeLineArt inverted, PiDiNet, Depth Anything V2 vitb, DWPose) using local weights only; the 3D pose is toyxyz's example mannequin. 62 images: structure (lineart, any-test with lineart and grayscale, scribble, depth), pose (DWPose skeleton vs 3D mesh), regions, and inpainting v2 against a latent noise mask alone. Findings and the resulting defaults are in `docs/configuration.md` (`controlTypes` in `web/prompts.js`). Downloaded with the user's consent: kohya-ss/Anima-LLLite inpainting-v2, any-test-like-v2, lineart-1, pose-1, scribble-1 and depth-1 (all v2 named-key files, loaded by the core node).

After adding the control types: 31 graphs match the installed schemas; `browser_generation_engines.mjs` adds a 3D pose control from the type selector; `browser.mjs` passes.

# Validation — November 2, 2026 · graph builder

- **24 Anima graphs** match the running ComfyUI's input contracts and linked output types, adding Anima SnapRef with one and three pictures, LLLite controls on Anima, SnapRef and Anima Ref (CharRef-LLLite nodes, after the LoRAs and before the adapter, disabled and unstaged controls skipped), and the Artist Mixer feeding `KSampler` and `AnimaRefGuider`, including a BBox layout prompt as its base prompt.
- **Chromium:** a panel with a gallery control image and an artist chain queues `AnimaLLLiteApply` and `AnimaArtistPack`; SnapRef asks for one to three references; the global engine list has three engines. `browser.mjs`, `browser_sketch.mjs` and `browser_story.mjs` still pass.
- Python, story, manga and MCP tests pass. No weights were loaded and no actual inference was run.

# Validation — November 2, 2026

First Anima-only release, derived from Manga Maker Studio at 613aa8d plus its Style workspace work in progress.

- **16 Anima graphs and 2 Manga-Lite graphs** match the running ComfyUI's input contracts and linked output types (`check_schemas.py`): Anima text to image with negative prompt and model-only LoRA order; Anima Ref with one to four stitched references, Ref Adapter, attention backend and Safe PAG; Sketch to Art starting from the VAE-encoded drawing with its denoise; BBox to Image layout prompts with and without chroma key; style previews; enhance and describe text tasks.
- **Model inheritance:** Anima Turbo defaults for both engines, stored global models, live field inheritance, partial and empty presets and saved snapshots.
- **20 Python tests passed:** storage, routes, project ownership, containment, drawings, fonts, story and assistant.
- **Story and MCP tests passed.**
- **Chromium (real frontend, isolated storage, simulated queue):** `browser.mjs` (references and panels with Anima and Anima Ref, presets, LoRA presets, page layout and pixel-identical export, text tasks, cancellation, global models and **Use default models and sampling**, Klecks drawing and reopening, no Refinement or Finishing workspaces, unchanged ComfyUI graph), `browser_generation_engines.mjs`, `browser_sketch.mjs` with Manga-Lite and BBox to Image, and `browser_story.mjs`. No JavaScript errors.
- Rename check: routes `/anima-manga-maker/`, settings `anima-manga-maker-settings.json`, projects `anima-manga-maker-projects`, extension `AnimaMangaMaker.Studio`, CSS prefix `amm-`; the pack can load next to Manga Maker Studio.

No weights were downloaded or loaded and no actual inference was run. The running ComfyUI was not restarted; the browser tests load the extension from disk and the Python routes from an isolated fixture.
