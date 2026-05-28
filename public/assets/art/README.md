# Aivatar Pixel Art Assets

Generated for the Codex desktop companion project.

## Files

- `aivatar-avatar-sheet.png` - selectable avatar sheet with three columns: cute lobster, original purple shapeshifter, and small octopus. Rows are idle, happy, and thinking/coding poses. Size: 1536 x 1024.
- `aivatar-room-assets.png` - room asset atlas with floors, wall panels, windows, and furniture. Size: 1254 x 1254.
- `aivatar-pixel-atlas.png` - combined concept atlas with avatars, floors, walls, windows, and furniture in one sheet. Size: 1254 x 1254.

## Suggested Next Step

The current renderer draws the room directly on Canvas with colored rectangles. To use these assets in-game, crop the sheet into sprites or add atlas coordinates, then load them from `/assets/art/...` with `HTMLImageElement` in `src/game/renderScene.ts`.

Keep the original generated sheets as source art and export cropped derivatives into a separate folder such as `public/assets/sprites/`.
