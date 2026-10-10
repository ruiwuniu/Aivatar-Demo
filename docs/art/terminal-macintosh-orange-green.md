# Orange Macintosh terminal

- Asset: `public/assets/furniture/terminal-macintosh-orange-green.png`
- Original source: `public/assets/furniture/terminal-macintosh.png`
- Method: built-in imagegen, transparent image edit, 2026-10-10.
- Initial generated source: `exec-aab07cac-c405-4666-b84c-47f4f8989f19.png`.
- Latest generated source: `exec-049a2c90-317a-44ed-b772-f69f02c8783b.png`,
  editing the initial orange variant to keep its original orange shell while
  deepening only the CRT green, as requested by the user.
- Dimensions: 1160 × 1355 RGBA. The single missing right padding column compared
  with the classic canvas lies outside the unchanged source crop
  `(117,103,927,1188)`. Opaque bounds at alpha ≥ 128 are
  `(122,103,1039,1285)`, within 1–4 source pixels of the classic skin.
- Current palette: original orange shell (`#e87521`, highlights `#ff9b40`,
  shadows `#914013`) and deeper green CRT (`#46c844` to `#2eac3b`).
- The original orange shell and deeper fluorescent-green CRT use the same geometry, animation
  timing, interaction positions and scale as the classic and forest-green skins.
  The runtime screen, drive indicator, pressed keys and loading silhouette use
  this skin's colors, with no changes to the animation state machine.
- Visual QA: `node scripts/aivatar-macintosh-visual-smoke.mjs` renders all three
  real assets with the production renderer across all six task phases.

## Latest imagegen prompt

Use case: precise-object-edit. Edit target: the supplied ORIGINAL ORANGE Macintosh pixel-art terminal sprite. User wants EXACTLY this original orange shell and keyboard again, while the CRT green should stay deeper. Make ONE localized color change ONLY: change the bright yellow-lime CRT glass area to deeper fluorescent green, base #46c844, darker edges #2eac3b, pale green reflection #c0f3b0. Keep the existing dark prompt glyph and cursor. Preserve ALL orange casing and keyboard pixels/colors from this target unchanged: warm tangerine orange #e87521, amber highlights #ff9b40, brown-orange shadows #914013, peach-orange keys. Do NOT make the casing red, coral, salmon, or sunset orange. Preserve the entire silhouette, crop, perspective, screen opening, rainbow emblem, disk slot, keyboard key arrangement, bevels, pixel boundaries, and object coordinates. Retain 1160 x 1355 canvas dimensions and exact alignment for calibrated game animation overlays. This is a transparent game asset: preserve genuine transparent alpha background, no checkerboard pattern or backdrop, no new shadow, no additions. The only permitted visual change to this source is the deeper green inside the existing CRT glass.

## Superseded sunset-orange refinement

Generated source: `exec-04e64b74-b7cc-4b47-9da6-8c9b49f0fe27.png`.
The user subsequently chose the original orange casing instead.

Use case: precise-object-edit. EDIT this exact transparent pixel-art game sprite with a SMALL PALETTE REFINEMENT ONLY. The user wants the green CRT a little deeper, and the orange casing closer to sunset orange. Recolor the shell and keyboard housing from yellow/tangerine orange to a warm red-leaning sunset orange: base #ee7046, lit bevels #ff9c68, darker faces #aa432c. Keep it orange, not pink, with restrained warm peach-orange key caps. Change only the existing CRT glass green from very bright yellow-lime to a richer deeper fluorescent phosphor green: base #46c844, shaded edges #2eac3b, light reflection #c0f3b0. Reduce the yellow cast and brightness visibly, but keep the screen clearly luminous and readable with the same dark glyph and cursor. Preserve EVERY shape, crop, object coordinate, camera perspective, top face, key cap layout, silhouette, CRT bezel, screen size, disk slot, rainbow apple emblem, shading boundaries, and all pixel edges. No redesign and no extra objects or decorations. Preserve original 1160 x 1355 canvas alignment exactly; existing screen and key animations are calibrated to it. Keep true transparent alpha background. No backdrop, no painted checkerboard, no added shadow or halo outside the object.

## Initial imagegen prompt

Use case: precise-object-edit. Asset type: transparent pixel-art game sprite, a third color skin for the SAME Macintosh-style terminal and keyboard. The attached image is the EDIT TARGET, not merely inspiration. Strictly recolor this exact sprite: change the beige computer shell and keyboard housing to warm saturated orange plastic (#e87521 base, #ff9b40 highlights, #914013 shadows), and the key caps to coordinated lighter peach-orange tones with the same pixel bevels. Change the pale gray-green CRT DISPLAY SURFACE to bright luminous fluorescent green (#72ff39 / #a7ff68), keeping the existing dark prompt glyph and cursor and the same small pale reflection. Keep dark charcoal CRT bezel, dark disk slot, little rainbow apple emblem. Preserve the original silhouette, camera perspective, top plane, monitor shape, CRT size and position, keyboard position/shape/key arrangement, object proportions/spacing, all major contours and shading boundaries. Preserve the exact cozy pixel-art style and sprite alignment, no redesign, no new objects, no extra glowing trim, no labels, no cables. Full object visible with the source framing. Match source canvas dimensions 1161 x 1355 and original object coordinates as closely as possible so existing screen/key animations still align. Genuine transparent alpha background, no backdrop, no painted checkerboard, no ground or additional cast shadow.
