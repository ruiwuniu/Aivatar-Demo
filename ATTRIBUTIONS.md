# Attributions

Aivatar includes code, generated artwork, and bundled audio assets. The project license for source code does not automatically change the license terms of third-party assets.

## Audio

Audio asset provenance is tracked in:

- `public/audio/README.md`

That file lists source names, authors, URLs, original filenames, and licenses for each bundled audio file. Some files are CC0 or public domain, while others use licenses such as CC-BY 4.0 or the Pixabay Content License. Review those terms before redistributing modified builds.

## Generated Pixel Art

Generated pixel-art source sheets are tracked in:

- `public/assets/art/README.md`

The current art README identifies generated source sheets and their intended use. Before a broad public release, document the generator/tooling and final redistribution terms for these images.

## Screenshots And Drafts

The repository currently tracks preview drafts and screenshots under:

- `drafts/`
- `screenshots/`

Treat these as release-candidate documentation assets until they are either documented, moved, or removed in a separate reviewed change.

## Dependency Licenses

JavaScript and Rust dependency licenses are managed by their respective package metadata:

- `package-lock.json`
- `src-tauri/Cargo.lock`

Before publishing installers, generate a dependency license report or review the dependency tree for redistribution compatibility.

## Bundled Connector

The Codex Desktop connector is bundled under:

- `plugins/aivatar-session-bridge`

Its plugin manifest declares an MIT license. Keep this connector's license and privacy behavior aligned with the main project before public release.
