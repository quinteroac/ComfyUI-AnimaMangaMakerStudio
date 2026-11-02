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
| **Anima Ref** | Follows `anima_ref_adapter_pag_multi`: references stitched side by side into one image, `AnimaRefAdapterLoader`, `AnimaRefLatent`, `AnimaRefGuider` and optional Safe PAG | Anima Turbo, 8 steps, CFG 1, Euler, Simple, reference guidance 1, PAG 1.3 |

Both use `qwen_3_06b_base.safetensors` with loading type `stable_diffusion` and `qwen_image_vae.safetensors`. These defaults are written in `web/models.js`; every field stays editable. **Use default models and sampling**, under **Models and advanced settings** or in global settings, restores them for that engine. A different Anima checkpoint, such as Anima Base or a manga finetune, usually needs more steps and a higher CFG; set them together with the model.

Fields changed in an operation override only that value. **Use global model configuration** clears these individual overrides. Presets store explicit overrides: missing, empty or null model fields inherit the current global value. A preset with explicit values keeps them even when the global configuration changes.

LoRAs are applied to the model only (`LoraLoaderModelOnly`), in list order, after the Ref Adapter for Anima Ref. **LoRA presets** save and load a LoRA list per operation. The extension cannot infer every incompatibility between checkpoints, encoders, VAEs and LoRAs; errors and metadata preserve the operation context, prompt, models, seeds and LoRAs.

## Prompts and presets

**Structured prompt** provides TASK, Subject, Appearance, Pose, Expression, Composition, Environment, Lighting and Style. Only nonempty fields are included, followed by **Free prompt**, which also accepts a complete prompt. Anima reads Danbooru tags and natural language alike. **Show combined prompt** displays the resulting text, and Anima's negative prompt is under **Sampling**.

The Style section inherits the project style from the **Style** workspace unless **Use project style** is turned off for the operation. **Browse Animadex styles and characters** and **Browse Stylebook styles** add entries to the matching section.

Editing prompt fields or settings keeps the selected preset visible with **Modified**. **Save settings as preset** saves them under the selected name or a new name. The **Clone preset** icon copies a preset under a new name. The six bundled **References** presets (Character, Expressions, Poses, Clothing, Objects and Environments) fill TASK and the relevant prompt sections; they do not specify models, sampling or LoRAs.

## Text and vision configuration

In **Settings → Text generator**, select the CLIP, loading type, device and output length. The encoder must support text generation and, for image analysis, vision. The **Enhance** button inside each section proposes an improvement to that field. **Create prompt from image**, in a reference menu, produces TASK and the eight sections from the image. Results are reviewed before they are applied; they do not generate images.

## Output size

Size is selected through **Aspect ratio** and **Resolution · MP** (1 MP = 1,000,000 pixels). With Anima Ref, **Output size** offers **Inherit from original** (the first reference) or **Manual · AR and MP**. Anima generates at multiples of 8 and Anima Ref at multiples of 16. Pages are exported in whole pixels.

See [Drawing](drawing.md) for the settings that affect the Klecks workflows, and [Projects and storage](projects.md) for migration and persistence.
