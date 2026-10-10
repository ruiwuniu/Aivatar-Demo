# Forest green Macintosh terminal

- Asset: `public/assets/furniture/terminal-macintosh-forest-orange.png`
- Source: `public/assets/furniture/terminal-macintosh.png`
- Method: built-in imagegen, transparent image edit, 2026-10-10.
- Generated source: `exec-fb32a878-3087-4ccb-9883-2ac1a3ad349e.png`.
- Dimensions: 1161 × 1354 RGBA; the original is 1161 × 1355. The missing
  bottom padding row is outside the unchanged runtime crop `(117,103,927,1188)`.
- Both skins share geometry, animation timing, interaction positions and scale.
  Only the PNG and runtime colors differ, including screen, key press and light.
- Visual QA: `node scripts/aivatar-macintosh-visual-smoke.mjs` renders both
  actual assets with the production renderer across all six task phases.

## Imagegen prompt

Use case: precise-object-edit. Asset type: transparent pixel-art game sprite, an alternate color skin for the SAME Macintosh-style terminal and keyboard. The attached image is the EDIT TARGET, not just inspiration. Make a strictly palette-only edit: recolor the beige computer casing and keyboard housing to a rich dark forest / ink green (#123e32 base, #205b49 highlights, #08271f shadows), with coordinating muted green key caps retaining clear pixel bevels. Recolor the pale gray-green CRT DISPLAY SURFACE to saturated luminous fluorescent orange (#ff831c / #ffae43), with the same dark prompt glyph and cursor and same small reflection placement. Keep dark charcoal screen bezel, disk slot, small rainbow apple emblem exactly as in source. Preserve the exact original silhouette, camera perspective, top plane, monitor shape, screen size and position, keyboard position/shape/key layout, every contour and major shading boundary, original pixel-art style, object proportions and spacing. No redesigned details, no extra glowing trim, no new labels, no cables, no extra objects. Keep full object visible in the same original framing and alignment. Match the source canvas dimensions 1161 x 1355 and maintain identical object coordinates as closely as possible; this sprite must accept existing screen/key animations at their original positions. True transparent alpha background, no backdrop, no checkerboard painted into image, no ground plane or cast shadow outside the source object.
