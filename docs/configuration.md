# Configuration, models and presets

[Documentation](README.md) · [Project README](../README.md)

Configure each engine globally, then override individual fields only when an operation needs a different model or sampling setup. Project content, operation settings and global model settings have different lifetimes.

An agent can also apply and verify these settings using the included [anima-manga-maker-setup skill](agent-setup.md), with access to your ComfyUI environment.

## Where settings apply

| Scope | What belongs here | When to use it |
| --- | --- | --- |
| **Settings → Models** | Model, text encoder, encoder type, VAE and default sampling for **Anima** or **Anima Ref** | A shared starting configuration across workspaces and projects |
| **Models and advanced settings** in an operation | Explicit model and sampling overrides and adapter options | A particular reference, panel, style preview or drawing workflow |
| **Prompt and settings preset** | Reusable prompt sections and operation settings, including explicit overrides | Returning to a known creative setup without replacing global defaults |
| **Settings → Text generator** | Encoder, loading type, device and output length for text/vision tasks | Prompt enhancement, image descriptions and dialogue |

## Engines

| Engine | Workflow | Defaults |
| --- | --- | --- |
| **Anima** | Text to image: `CLIPTextEncode` positive and negative, `EmptyLatentImage`, `KSampler` | Anima Turbo, 8 steps, CFG 1, ER SDE, Simple |
| **Anima Ref** | Follows the CharRef workflows: references stitched side by side into one image, `AnimaRefAdapterLoader` (v2 r64), `AnimaRefLatent`, `AnimaRefGuider` and optional Safe PAG | Anima Turbo, 8 steps, CFG 1, Euler, Simple, reference guidance 1, PAG 1.3 |
| **Anima SnapRef** | One to three pictures of one character on the `SnapRef` node, then `KSampler`. **Character** keeps the style from the model and prompt; **Character & style** also takes the art style | Anima Turbo, 8 steps, CFG 1, Euler, Simple, `snapref_v2a_pre2`, Character, attention 0, fidelity 1 |

All three use `qwen_3_06b_base.safetensors` with loading type `stable_diffusion` and `qwen_image_vae.safetensors`. These defaults are written in `web/models.js`; every field stays editable. **Use default models and sampling**, under **Models and advanced settings** or in global settings, restores them for that engine. A different Anima checkpoint, such as Anima Base or a manga finetune, usually needs more steps and a higher CFG; set them together with the model.

Fields changed in an operation override only that value. **Use global model configuration** clears these individual overrides. Presets store explicit overrides: missing, empty or null model fields inherit the current global value. A preset with explicit values keeps them even when the global configuration changes.

The model chain is: LoRAs, LLLite controls, the reference adapter (Anima Ref or SnapRef), then attention, Safe PAG and the Artist Mixer. LoRAs are applied to the model only (`LoraLoaderModelOnly`), in list order. **LoRA presets** save and load a LoRA list per operation.

## Controls · LLLite

In References and Panels, **Controls · LLLite** adds Anima ControlNet-LLLite models, each with a control image from the project, ComfyUI's input folder or the computer (outside images are imported into References in the same step): for example a 3D pose render for `anima_3dpose_outline_7000` or a flat color map for `anima_regional_4335`. Each control has its model from `models/model_patches`, strength and the start and end of its effect as fractions of the denoising (a regional map typically ends around 0.3). The control image is center-cropped to the output size, so keep its aspect ratio close to the output's. **From scene…** instead takes a camera from one of the project's 3D scenes ([Drawing](drawing.md#control-layers)): every generation renders it at the output size, as edges for most types or as depth for a Depth control, so later edits to the scene reach the next panel and every panel in that location shares the room. Controls are stored with the operation and its presets; a control without an image or scene is skipped. With Anima Ref, controls use the ComfyUI-Anima-CharRef-LLLite nodes so the reference frame does not receive the control.

**Add control** offers types that fill the model, strength and range found in a November 2026 benchmark on Anima Turbo and mangaVision (fixed seed, strengths 0.7, 1.0 and 1.3):

| Type | Model | Defaults | Control image | What the benchmark showed |
| --- | --- | --- | --- | --- |
| 3D pose | toyxyz `anima_3dpose_6200` | 1.0, 0 → 1 | Shaded mannequin on black | Locks the pose on both models from 0.7. Above 1.0 mangaVision added a frame border. |
| Depth | kohya `anima-lllite-depth-1` | 1.0, 0 → 1 | White near, black far | Keeps silhouette and layout while clothes and setting follow the prompt: the best choice to change content in the same composition. |
| Scribble | kohya `anima-lllite-scribble-1` | 0.7, 0 → 1 | White lines on black | Keeps shapes; at 1.0 and more it copies source details. |
| Lineart | kohya `anima-lllite-lineart-1` | 1.0, 0 → 1 | Black lines on white | Keeps every line, including clothes and props: a faithful redraw. With mangaVision it inks the source as clean manga. |
| Any | kohya `anima-lllite-any-test-like-v2` | 0.7, 0 → 1 | Lineart, scribble or grayscale | With lineart it behaves like Lineart; a grayscale image at 1.0 or more reproduces the source almost exactly, including hair color. |
| Regions | toyxyz `anima_regional_4335` | 1.0, 0 → 0.3 | One flat color per figure on black | Separates figures, but follows the shapes literally: crude ellipses and boxes became round heads and box bodies on Turbo and drawn circles and panels on mangaVision. Use figure-shaped silhouettes and an early end. |
| Pose skeleton | kohya `anima-lllite-pose-1` | 1.3, 0 → 1 | DWPose skeleton | Barely moves the pose below 1.3; 3D pose is much stronger. |

The LLLite adds no measurable time on Turbo (about 4 s per 832×1216 image on an RTX 5060 Ti) or mangaVision at 30 steps (about 27 s). Inpainting v2 (`anima-lllite-inpainting-v2`) blended a masked repaint seamlessly with the rest of the image at denoise 1.0, where a latent noise mask alone left visible seams; at 0.75 it kept the original content. It needs a mask and an image-to-image start, so it arrives with the drawing editor's inpaint tool.

## Artist Mixer

**Artist Mixer**, below the prompt, takes a comma-separated chain of Animadex artists, such as `@kubo tite, @mineru::0.6`, and mixes their styles into the model and the prompt conditioning with the Anima Artist Mixer. **Browse Animadex artists** adds artists to the chain. An empty chain uses plain text encoding. The extension cannot infer every incompatibility between checkpoints, encoders, VAEs and LoRAs; errors and metadata preserve the operation context, prompt, models, seeds and LoRAs.

## Prompts and presets

**Structured prompt** provides TASK, Subject, Appearance, Pose, Expression, Composition, Environment, Lighting and Style. Only nonempty fields are included, followed by **Free prompt**, which also accepts a complete prompt. Anima reads Danbooru tags and natural language alike. **Show combined prompt** displays the resulting text, and Anima's negative prompt is under **Sampling**.

The Style section inherits the project style from the **Style** workspace unless **Use project style** is turned off for the operation. **Browse Animadex styles and characters** and **Browse Stylebook styles** add entries to the matching section.

Editing prompt fields or settings keeps the selected preset visible with **Modified**. **Save settings as preset** saves them under the selected name or a new name. The **Clone preset** icon copies a preset under a new name. The six bundled **References** presets (Character, Expressions, Poses, Clothing, Objects and Environments) fill TASK and the relevant prompt sections; they do not specify models, sampling or LoRAs.

## Text and vision configuration

In **Settings → Text generator**, select the CLIP, loading type, device and output length. The encoder must support text generation and, for image analysis, vision. The **Enhance** button inside each section proposes an improvement to that field. **Create prompt from image**, in a reference menu, produces TASK and the eight sections from the image. Results are reviewed before they are applied; they do not generate images.

## Output size

Size is selected through **Aspect ratio** and **Resolution · MP** (1 MP = 1,000,000 pixels). With Anima Ref and SnapRef, **Output size** offers **Inherit from original** (the first reference) or **Manual · AR and MP**. Anima and SnapRef generate at multiples of 8 and Anima Ref at multiples of 16. Pages are exported in whole pixels.

See [Drawing](drawing.md) for the settings that affect the Klecks workflows, and [Projects and storage](projects.md) for migration and persistence.
