# Using Studio

[Documentation](README.md) · [Project README](../README.md)

Studio is organized around assets and projects: references describe the cast and setting, panels hold individual illustrations, and pages combine those assets into a reading layout. You can import existing art, generate new art, or draw locally. The same project can mix all three.

## Workspaces

| Workspace | Purpose | What to configure or select |
| --- | --- | --- |
| **Story** | Logline, characters, plot and script | See [Story Studio](story.md) |
| **Style** | The project's art style, shared by every operation | Danbooru tags, natural-language style and preview generations |
| **References** | Character, expression, pose, clothing, object and environment references | Engine, prompt, connected references, imported images or **Draw reference** |
| **Panels** | Illustrations intended for individual manga panels | Engine, prompt, connected references and output size; or imported/drawn art |
| **Page layout** | Arrange panels, framing and dialogue into a page | Layout geometry, panel images, reading order, borders and text |

The ComfyUI graph remains available outside Studio. Generation runs through the existing queue, while importing, drawing and layout editing do not need a diffusion model.

## Engines

Select the engine under **Engine** in References and Panels:

- **Anima** generates from text. Reuse a saved reference prompt through **Use image prompt** in its image menu.
- **Anima Ref** takes character and style from one to four connected references and the scene from the prompt. The references are placed side by side as one reference image, so describe the scene, pose and framing rather than the character. **Use with Anima Ref** in an image menu switches to this engine with that image connected.
- **Anima SnapRef** takes one to three pictures of the same character. In **Character** mode the style comes from the model and prompt, which keeps a manga style; **Character & style** also takes the art style from the pictures.

All three share prompts, presets, AR/MP, seed, sampling overrides, additional LoRAs, [LLLite controls](configuration.md#controls--lllite) and the [Artist Mixer](configuration.md#artist-mixer). See [Configuration](configuration.md) for models and defaults.

## Style

The **Style** workspace stores the project style as Danbooru tags and natural-language prose, with Animadex and Stylebook pickers. References, panels and Sketch to Art use it in the Style section unless an operation turns off **Use project style**. **Generate preview** renders test images with Anima; previews stay in ComfyUI's temp folder and are discarded when you close Studio.

## Working with references and panels

A project keeps references and panels in separate galleries. References can be connected to generation without placing them on a page. Panels can be reused in different layouts; positioning or cropping them in the editor does not alter the source file.

Open image actions with a right-click or the **⋯** button. **Download image** downloads the original bytes with the correct file extension. The menu supports arrow keys, Enter and Escape.

The generate button, seed and **Random seed for each generation** stay pinned at the bottom of the controls; when the button is disabled, the reason appears below it. Drag the edge of the controls to resize them, or use the sidebar button to hide them. Model, encoder, LoRA, sampler and scheduler fields are searchable lists grouped by folder; clear a model field to inherit the global configuration.

Hover an image to show its checkbox; selecting images shows a bar with **Clear selection**, remove, restore, ordering and tag actions. Queued and running generations appear as placeholders with progress in their gallery and in the status bar.

## Connected references

**Connected visual references** marks deleted images as **Trash** and missing files as **Missing file**. **Restore reference** recovers a connected image from Trash without changing its position; **Remove** disconnects it. Generation errors identify the unavailable image instead of silently skipping it.

## Reusing prompts

**Use image prompt**, in an image thumbnail's context menu, copies the sections and free field saved when generating the image, replacing the current prompt without changing models or other settings. An unstructured saved prompt is copied into Free prompt. The action is disabled when the image has no recoverable prompt data.

## Choosing a practical workflow

For existing finished illustrations, import them into Panels and work directly in [Page layout](page-layout.md). For drawn drafts, open [Klecks](drawing.md), render them with Sketch to Art, and add screentones with Art to Manga Panel. For consistent characters, keep reference images in References and connect them with Anima Ref when generating panels.

Projects preserve originals and versions. [Projects and storage](projects.md) explains saving, recovery and cancellation.
