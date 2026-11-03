# Anima Manga Maker Studio

**Version:** 0.1.0-alpha.

Anima Manga Maker Studio is a manga workspace for ComfyUI built on a single base model, [Anima](https://huggingface.co/circlestone-labs/Anima). Organize references and panels in projects, generate with Anima, Anima Ref or SnapRef, draw with Klecks, and compose pages with custom panel shapes and dialogue. Open **Anima Manga Maker Studio** from the sidebar or the **Anima Manga Maker** menu while keeping your ComfyUI graph intact.

It is a separate project derived from [Manga Maker Studio](https://github.com/quinteroac/ComfyUI-MangaMakerStudio), which also supports Krea2, Qwen and MOSS. Both can be installed side by side; projects and settings are stored separately.

## What you can do

- Organize references, panels and pages with preserved originals and versions.
- Generate with **Anima** (text to image), **Anima Ref** (one to four reference images for character and style) or **Anima SnapRef** (one to three pictures of one character), using Anima Turbo by default. Add ControlNet-LLLite controls such as 3D pose or regional maps, and mix artist styles with the Anima Artist Mixer. Models, encoders, VAEs, LoRAs and control models stay configurable globally and per operation.
- Set a project style with Animadex tags and Stylebook prose, and preview it.
- Draw in Klecks with editable layers and PSD saving, render drafts with **Sketch to Art**, lay out a scene with **BBox to Image**, and add screentones with **Art to Manga Panel**.
- Block out a location in 3D with **Build scene…**: rooms, pieces and saved cameras become edge and depth control layers, so every panel set there shares the same room.
- Compose pages with rectangular or polygonal panels, speech/thought bubbles, local fonts and PNG export.
- Write the story in Story Studio with an optional local assistant.

## Installation

```sh
# Run from your ComfyUI directory:
git clone https://github.com/quinteroac/ComfyUI-AnimaMangaMakerStudio.git custom_nodes/ComfyUI-AnimaMangaMakerStudio
```

Restart ComfyUI when no jobs are active and reload the browser. Projects, drawing and page layout use the bundled editor and ComfyUI's existing Python dependencies. Generation needs Anima weights and, for Anima Ref, its custom nodes. See [Installation and dependencies](docs/installation.md) for exact nodes and weights.

## Set up with an agent

Ask a compatible agent to read the included [anima-manga-maker-setup skill](skills/anima-manga-maker-setup/SKILL.md), or invoke `$anima-manga-maker-setup` after registering it. See [Agent-assisted setup](docs/agent-setup.md).

## Documentation

| Guide | Contents |
| --- | --- |
| [Agent-assisted setup](docs/agent-setup.md) | Use the included skill to install, configure or diagnose the plugin |
| [Configuration](docs/configuration.md) | Models, LoRAs, presets and text/vision configuration |
| [Story Studio](docs/story.md) | Logline, characters, plot, script and the local writing assistant |
| [MCP server](docs/mcp.md) | Read projects and write the story from an MCP client |
| [Using Studio](docs/usage.md) | Style, references and panels |
| [Drawing and manga conversion](docs/drawing.md) | Klecks, Sketch to Art, BBox to Image, Art to Manga Panel and masks |
| [Page layout](docs/page-layout.md) | Panels, framing, dialogue, fonts and export |
| [Projects and storage](docs/projects.md) | Saving, versions, migration and troubleshooting |
| [Development and validation](docs/development.md) | Build details and tests |

## Credits

The drawing editor is [Klecks by bitbof](https://github.com/bitbof/klecks). Art to Manga Panel adapts [MangaScreen by ashukae](https://github.com/ashukae/ComfyUI-MangaScreen). Anima Ref uses [ElectronGirl's Anima Ref Adapter](https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter). See [Credits and attribution](docs/credits.md) for all project links and license notices. Anima and its derivatives are under the CircleStone Labs Non-Commercial License; this plugin does not include or relicense any weights.
