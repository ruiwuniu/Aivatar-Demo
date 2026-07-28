import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const readBinary = (path) => readFile(new URL(path, root));
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const normalizedTrait = (points) =>
  clamp01(Math.log10(Math.max(0, points) + 1) / Math.log10(1_000_001));
const catchProbability = (focus) => 0.2 + normalizedTrait(focus) * 0.6;
const cookingProbability = (warmth) => 0.1 + normalizedTrait(warmth) * 0.65;
const sunPosition = (hour) => {
  const progress = clamp01((hour - 5.6) / 13.7);
  return {
    x: -45 + progress * 1270,
    elevation: Math.max(0, Math.sin(progress * Math.PI)),
  };
};
const smootherstep = (value) => {
  const clamped = clamp01(value);
  return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
};
const foamMotionSample = (nowMs, periodMs, phase, inhaleRatio, amplitudePx) => {
  const cycle = (nowMs / periodMs + phase / (Math.PI * 2)) % 1;
  const riseAndFall = cycle < inhaleRatio
    ? cycle / inhaleRatio
    : (1 - cycle) / (1 - inhaleRatio);
  const breath = smootherstep(riseAndFall);
  const distance = amplitudePx * breath;
  const lower = Math.floor(distance);
  const mix = distance - lower;
  return { breath, lower, upper: lower + 1, mix, centroid: lower + mix };
};
const foamFringeSample = (breath, distanceSteps) => {
  const fringeBreath = smootherstep((breath - 0.28) / 0.72);
  const alpha = fringeBreath * 0.3;
  const distance = distanceSteps + fringeBreath * 0.75;
  const lower = Math.floor(distance);
  const mix = distance - lower;
  return { fringeBreath, alpha, distance, lower, upper: lower + 1, mix };
};
const isGrass = (x, y) => {
  const left = 110 + Math.max(0, y - 235) * 0.055;
  const right = 1080 - Math.max(0, y - 235) * 0.025;
  if (y < 235 || y > 842 || x < left || x > right) return false;
  const pondDx = (x - 1110) / 285;
  const pondDy = (y - 650) / 235;
  return pondDx * pondDx + pondDy * pondDy > 1.08;
};

assert.equal(catchProbability(0), 0.2);
assert.equal(catchProbability(1_000_000), 0.8);
assert.equal(cookingProbability(0), 0.1);
assert.equal(cookingProbability(1_000_000), 0.75);
assert.equal(isGrass(420, 650), true);
assert.equal(isGrass(1080, 650), false, "pond must remain non-walkable");
assert.equal(isGrass(80, 700), false, "cliff must remain non-walkable");
for (const [x, y] of [[937, 574], [916, 660], [943, 756]]) {
  assert.equal(isGrass(x, y), false, `fishing bobber target ${x},${y} must be off grass`);
}
const morningSun = sunPosition(6.5);
const noonSun = sunPosition(12.2);
const duskSun = sunPosition(18.3);
assert(morningSun.x < noonSun.x && noonSun.x < duskSun.x, "sun must travel left to right");
assert(noonSun.elevation > morningSun.elevation, "noon sun must be higher than morning sun");
assert(noonSun.elevation > duskSun.elevation, "noon sun must be higher than dusk sun");
assert.equal(smootherstep(0), 0);
assert.equal(smootherstep(1), 1);
assert.deepEqual(foamFringeSample(0, 0), {
  fringeBreath: 0,
  alpha: 0,
  distance: 0,
  lower: 0,
  upper: 1,
  mix: 0,
});
const foamFringePeak = foamFringeSample(1, 2.25);
assert.equal(foamFringePeak.alpha, 0.3);
assert.equal(foamFringePeak.distance, 3);
for (const nowMs of [0, 340, 850, 1700, 2550, 3399]) {
  const sample = foamMotionSample(nowMs, 3400, 0, 0.57, 2.25);
  assert.equal(Number.isInteger(sample.lower), true);
  assert.equal(Number.isInteger(sample.upper), true);
  assert(Math.abs((1 - sample.mix) + sample.mix - 1) < 1e-12);
}
let previousFoamCentroid = foamMotionSample(0, 3400, 0, 0.57, 2.25).centroid;
for (let nowMs = 1000 / 60; nowMs <= 3400; nowMs += 1000 / 60) {
  const sample = foamMotionSample(nowMs, 3400, 0, 0.57, 2.25);
  assert(
    Math.abs(sample.centroid - previousFoamCentroid) < 0.05,
    "foam centroid must not jump between integer pixel positions",
  );
  previousFoamCentroid = sample.centroid;
}
const cloudDrawWidth = 630;
const cloudTravelWidth = 760;
const cloudTrackLength = 1180 + cloudTravelWidth + 520;
const cloudBeforeWrapX = cloudTrackLength - 0.001 - cloudTravelWidth - 520 / 2
  + (cloudTravelWidth - cloudDrawWidth) / 2;
const cloudAfterWrapX = -cloudTravelWidth - 520 / 2
  + (cloudTravelWidth - cloudDrawWidth) / 2;
assert(cloudBeforeWrapX > 1180, "cloud must be fully beyond the right edge before wrapping");
assert(cloudAfterWrapX + cloudDrawWidth < 0, "cloud must restart fully beyond the left edge");

const [
  configText,
  appText,
  mainText,
  parkText,
  parkCssText,
  parkContentText,
  runtimeText,
  rendererText,
  fishingAnimationText,
  animationPreviewText,
  layersText,
  cloudAtlasText,
  typesText,
  tauriText,
  groundImage,
  referenceImage,
  cloudAtlasImage,
  blackBassImage,
  crucianCarpImage,
] = await Promise.all([
  read("public/config/aivatar.config.json"),
  read("src/App.tsx"),
  read("src/main.tsx"),
  read("src/park/ParkApp.tsx"),
  read("src/park/park.css"),
  read("src/park/parkContent.ts"),
  read("src/park/parkRuntime.ts"),
  read("src/park/parkRenderer.ts"),
  read("src/park/parkFishingAnimation.ts"),
  read("src/park/ParkAnimationPreviewApp.tsx"),
  read("src/park/parkReferenceLayers.ts"),
  read("src/park/parkCloudAtlas.ts"),
  read("src/types.ts"),
  read("src-tauri/src/lib.rs"),
  readBinary("public/park/hilltop-park-midday-ground.png"),
  readBinary("public/park/hilltop-park-reference.png"),
  readBinary("public/park/cumulonimbus-cloud-time-atlas.png"),
  readBinary("public/park/fish/raw-black-bass-v1.png"),
  readBinary("public/park/fish/raw-crucian-carp-v1.png"),
]);
const seaLightingText = rendererText.slice(
  rendererText.indexOf("const drawSeaLighting"),
  rendererText.indexOf("const drawShoreFoamBreath"),
);
const pondSurfaceText = rendererText.slice(
  rendererText.indexOf("const drawPondSurface"),
  rendererText.indexOf("const PARK_SEA_FINE_GLINT_COUNT"),
);
const pondTextureText = rendererText.slice(
  rendererText.indexOf("const PARK_POND_MORPH_FRAME_COUNT"),
  rendererText.indexOf("const drawPixelPondRing"),
);
const shoreFoamMotionText = rendererText.slice(
  rendererText.indexOf("const drawShoreFoamBreath"),
  rendererText.indexOf("const drawReferenceMotion"),
);
const nightSkyText = rendererText.slice(
  rendererText.indexOf("type ParkNightStar"),
  rendererText.indexOf("type ParkCloudVariantBlend"),
);
const config = JSON.parse(configText);
const itemIds = new Set(config.itemDefinitions.map((item) => item.id));
for (const itemId of [
  "fishing-rod",
  "raw-black-bass",
  "raw-crucian-carp",
  "cooked-black-bass",
  "cooked-crucian-carp",
  "gas-oven-range",
]) {
  assert(itemIds.has(itemId), `missing ${itemId} definition`);
}

assert.match(parkContentText, /export interface ParkFishingSpot/);
for (const fishingSpotId of ["upper-bank", "middle-bank", "lower-bank"]) {
  assert.match(parkContentText, new RegExp(`id: "${fishingSpotId}"`));
}
assert.match(runtimeText, /\| "bite"/);
assert.match(runtimeText, /activity: "bite"/);
assert.match(runtimeText, /activityStartedAt: pose === state\.fishingPose/);
assert.match(runtimeText, /fishingSpotId: spot\.id/);
assert.match(rendererText, /drawParkFishingAnimation/);
assert.match(rendererText, /fishingPoseStartedAt/);
assert.match(rendererText, /fishingSpot\?: ParkFishingSpot/);
assert.match(fishingAnimationText, /const FISHING_HAND_ANCHORS/);
assert.match(fishingAnimationText, /handAnchorCount: Object\.keys\(FISHING_HAND_ANCHORS\)\.length/);
assert.match(fishingAnimationText, /quadraticCurveTo\(control\.x, control\.y, tip\.x, tip\.y\)/);
assert.match(fishingAnimationText, /const drawPixelRipple/);
assert.match(fishingAnimationText, /const drawSplash/);
assert.match(fishingAnimationText, /const drawBobber/);
assert.match(fishingAnimationText, /PARK_FISH_SPRITE_ASSETS/);
assert.match(fishingAnimationText, /drawProceduralFishFallback/);
assert.match(fishingAnimationText, /Math\.round\(Math\.sin\(frame \/ 6\)\)/);
assert.match(fishingAnimationText, /showBobber = flight > 0\.84/);
assert.match(fishingAnimationText, /showBobber = retrieve < 0\.24/);
assert.match(animationPreviewText, /全部基础动作/);
assert.match(animationPreviewText, /钓鱼动作/);
assert.match(animationPreviewText, /drawParkFishingAnimation/);
assert.match(animationPreviewText, /重新播放/);
assert.match(animationPreviewText, /DISPLAY_FISH_OPTIONS/);
assert.match(animationPreviewText, /previewFishId/);
assert.match(animationPreviewText, /展示鱼种/);
assert.match(mainText, /view === "park-animation-preview"/);
assert.match(parkText, /open_park_animation_preview_window/);
assert.match(parkText, /打开角色动作预览/);
assert.match(tauriText, /open_park_animation_preview_window/);
assert.match(tauriText, /\.inner_size\(760\.0, 600\.0\)/);

assert.match(typesText, /"room-visit" \| "card-room" \| "park"/);
assert.match(parkText, /guestRuntimeRoomInstanceId === instanceIdRef\.current/);
assert.match(parkText, /simulationRef\.current = null/);
assert.match(parkText, /label: "实时", hour: null/);
assert.match(parkText, /label: "朝霞 06:30", hour: 6\.5/);
assert.match(parkText, /label: "中午 12:00", hour: 12/);
assert.match(parkText, /label: "晚霞 18:18", hour: 18\.3/);
assert.match(parkText, /label: "夜晚 22:30", hour: 22\.5/);
assert.match(parkText, /url\.searchParams\.delete\("parkHour"\)/);
assert.match(parkText, /url\.searchParams\.set\("parkHour", String\(hour\)\)/);
assert.match(parkText, /aria-label="公园时间预览"/);
assert.match(parkText, /aria-label="公园角色预览"/);
assert.match(parkText, /强制召唤角色/);
assert.match(parkText, /强制钓鱼（临时钓竿）/);
assert.match(parkText, /debugRodRef\.current \|\| hasFishingRod\(currentSave\)/);
assert.match(parkText, /if \(!debugPreviewActive && visit\)/);
assert.match(parkText, /Debug 行为不会写入存档/);
assert.match(parkCssText, /\.park-debug \{/);
assert.match(parkCssText, /left: 14px;/);
assert.match(parkCssText, /bottom: 14px;/);
assert.match(runtimeText, /export const forceParkFishingPreview/);
assert.match(runtimeText, /"to-fishing"/);
assert.match(runtimeText, /canLandFishingCatch/);
assert.match(runtimeText, /fishingSessionDurationSeconds/);
assert.match(runtimeText, /PARK_REFERENCE_COLLIDERS/);
assert.match(appText, /shouldChooseCooking\(warmth\)/);
assert.match(appText, /consumeFurnitureStorageItem\([\s\S]*"fridge"/);
assert.match(tauriText, /inner_size\(1180\.0, 900\.0\)/);
assert.match(rendererText, /ctx\.drawImage\(layers\.neutralBaseWithoutDistantShoreFoam, 0, 0\)/);
assert.match(rendererText, /PARK_HORIZON_Y = 122/);
assert.match(rendererText, /PARK_HORIZON_TINT_END_Y = 235/);
assert.match(rendererText, /const drawHorizonSeaTint/);
assert.match(rendererText, /const color = visual\.skyHorizon/);
assert.match(rendererText, /const dawnWindow = Math\.max\(0, 1 - Math\.abs\(visual\.hour - 6\.5\) \/ 2\)/);
assert.match(rendererText, /const dawnBoost = dawnWindow \* dawnWindow \* \(3 - 2 \* dawnWindow\)/);
assert.match(rendererText, /const topAlpha = 0\.62 \+ dawnBoost \* 0\.16/);
assert.match(rendererText, /const middleAlpha = 0\.4 \+ dawnBoost \* 0\.12/);
assert.match(rendererText, /const lowerAlpha = 0\.14 \+ dawnBoost \* 0\.05/);
assert.match(rendererText, /createLinearGradient/);
assert.match(rendererText, /gradient\.addColorStop\(1, `rgba\(\$\{color\.join\(","\)\},0\)`\)/);
assert.match(rendererText, /globalCompositeOperation = "destination-in"/);
assert.match(rendererText, /tint\.drawImage\(layers\.seaMask, 0, 0\)/);
assert.match(rendererText, /globalCompositeOperation = "soft-light"/);
assert.match(rendererText, /drawHorizonSeaTint\(ctx, layers, timeVisual\)/);
assert.match(rendererText, /parkHorizonTintEnd/);
assert.match(rendererText, /parkHorizonDawnBoost/);
assert.match(nightSkyText, /PARK_NIGHT_STAR_BACKGROUND_COUNT = 104/);
assert.match(nightSkyText, /PARK_NIGHT_STAR_BAND_COUNT = 42/);
assert.match(nightSkyText, /const PARK_NIGHT_STARS/);
assert.match(nightSkyText, /const isGalacticBand/);
assert.match(nightSkyText, /const bandCenter/);
assert.match(nightSkyText, /const horizonFade/);
assert.match(nightSkyText, /star\.size === 3/);
assert.doesNotMatch(nightSkyText, /Math\.random\(\)/);
assert.match(rendererText, /parkNightStarCount/);
assert.match(rendererText, /parkNightStarBandCount/);
assert.match(rendererText, /parkNightStarDistribution = "seeded-field-plus-band"/);
assert.match(rendererText, /ctx\.imageSmoothingEnabled = false/);
assert.doesNotMatch(rendererText, /drawSkyAndSea\(ctx, options/);
assert.doesNotMatch(rendererText, /drawPlateau\(ctx, options/);
assert.match(rendererText, /resolveParkCelestialPosition\(timeVisual\.hour\)/);
assert.match(rendererText, /const horizontal = caster\.x - celestial\.x/);
assert.doesNotMatch(rendererText, /drawMovingCelestialBody/);
assert.doesNotMatch(rendererText, /reflectionStrength/);
assert.match(rendererText, /drawSeaLighting\(ctx, layers, timeVisual, motionNowMs\)/);
assert.match(rendererText, /light\.drawImage\(layers\.seaMotionMask, 0, 0\)/);
assert.match(rendererText, /const PARK_SEA_FINE_GLINT_COUNT = 260/);
assert.match(rendererText, /const PARK_SEA_WAVE_GLINT_COUNT = 104/);
assert.match(rendererText, /const PARK_SEA_SPARKLE_COUNT = 34/);
assert.match(rendererText, /Math\.pow\(pulse, 5\)/);
assert.match(rendererText, /parkSeaSparkleCount/);
assert.match(rendererText, /parkSeaSparklePhase/);
assert.doesNotMatch(seaLightingText, /Math\.random\(\)/);
assert.match(rendererText, /const drawPondSurface/);
assert.match(rendererText, /const PARK_POND_RIPPLES/);
assert.match(rendererText, /PARK_POND_WAVE_PARTICLE_COUNT = 26/);
assert.match(rendererText, /PARK_POND_GLIMMER_COUNT = 13/);
assert.match(pondSurfaceText, /pondLargeHighlightTexture/);
assert.match(pondSurfaceText, /pondFineHighlightTexture/);
assert.match(pondSurfaceText, /pondLargeLowlightTexture/);
assert.match(pondSurfaceText, /pondFineLowlightTexture/);
assert.match(pondSurfaceText, /drawPixelPondRing/);
assert.match(pondSurfaceText, /globalCompositeOperation = "destination-in"/);
assert.match(pondSurfaceText, /layers\.pondInteriorMask/);
assert.match(pondSurfaceText, /layers\.pondEdgeMask/);
assert.match(pondSurfaceText, /layers\.pondRimMask/);
assert.doesNotMatch(pondSurfaceText, /Math\.random\(\)/);
assert.match(pondTextureText, /verticalScale: number/);
assert.match(pondTextureText, /PARK_POND_MORPH_FRAME_COUNT = 8/);
assert.match(pondTextureText, /PARK_POND_LARGE_MORPH_PERIOD_MS = 22_000/);
assert.match(pondTextureText, /PARK_POND_FINE_MORPH_PERIOD_MS = 17_000/);
assert.match(pondTextureText, /canvas\.height = Math\.round\(tileSize \* verticalScale\)/);
assert.equal((pondTextureText.match(/0\.5, \[/g) ?? []).length, 4);
assert.match(pondTextureText, /const morphX = Math\.sin/);
assert.match(pondTextureText, /\* cellSize \* 0\.055/);
assert.match(pondTextureText, /const morphY = Math\.cos/);
assert.match(pondTextureText, /\* cellHeight \* 0\.085/);
assert.match(pondTextureText, /const makePondTextureSequence/);
assert.match(pondTextureText, /length: PARK_POND_MORPH_FRAME_COUNT/);
assert.match(pondTextureText, /frameIndex \/ PARK_POND_MORPH_FRAME_COUNT \* Math\.PI \* 2/);
assert.match(pondTextureText, /const morphPosition = wrappedMorphProgress \* textures\.length/);
assert.match(pondTextureText, /const nextMorphFrame = \(morphFrame \+ 1\) % textures\.length/);
assert.match(pondTextureText, /const morphMix = rawMorphMix \* rawMorphMix \* \(3 - 2 \* rawMorphMix\)/);
assert.match(pondTextureText, /textureLayer\.drawImage\(textures\[morphFrame\]!/);
assert.match(pondTextureText, /textureLayer\.drawImage\(textures\[nextMorphFrame\]!/);
assert.match(pondTextureText, /730 \+ lowerOffset/);
assert.match(pondTextureText, /731 \+ lowerOffset/);
assert.equal((pondSurfaceText.match(/fillRect\(730, 405, 450, 495\)/g) ?? []).length, 3);
assert.doesNotMatch(pondSurfaceText, /fillRect\(800, 405, 380, 495\)/);
assert.match(pondTextureText, /const stripHeight = 2/);
assert.match(pondTextureText, /const primaryWave = Math\.sin/);
assert.match(pondTextureText, /const secondaryWave = Math\.sin/);
assert.match(pondTextureText, /type PondTravellingHighlight/);
assert.match(pondTextureText, /const crestWave = travellingHighlight/);
assert.match(pondTextureText, /Math\.pow\(crestWave, travellingHighlight\.sharpness\)/);
assert.match(pondTextureText, /const stripAlpha = Math\.min\(1, alpha \+ travellingCrest\)/);
assert.match(pondTextureText, /const lowerOffset = Math\.floor\(waveOffset\)/);
assert.match(pondTextureText, /const offsetMix = waveOffset - lowerOffset/);
assert.match(pondTextureText, /stripAlpha \* \(1 - offsetMix\)/);
assert.match(pondTextureText, /stripAlpha \* offsetMix/);
assert.doesNotMatch(pondTextureText, /Math\.round\(waveOffset\)/);
assert.doesNotMatch(pondTextureText, /Math\.random\(\)/);
assert.match(pondTextureText, /\[220, 246, 235, 136\]/);
assert.match(pondTextureText, /\[64, 111, 124, 104\]/);
const largeHighlightCallText = pondSurfaceText.slice(
  pondSurfaceText.indexOf("pondLargeHighlightTexture"),
  pondSurfaceText.indexOf("pondFineHighlightTexture"),
);
const fineHighlightCallText = pondSurfaceText.slice(
  pondSurfaceText.indexOf("pondFineHighlightTexture"),
  pondSurfaceText.indexOf("// Ring particles"),
);
assert.match(largeHighlightCallText, /phase: nowMs \/ 680/);
assert.match(largeHighlightCallText, /strength: 0\.42/);
assert.doesNotMatch(fineHighlightCallText, /strength:/);
assert.doesNotMatch(rendererText, /ctx\.ellipse\(1118, 682, 285, 255/);
assert.match(rendererText, /parkPondSurfaceLayerCount = "2"/);
assert.match(rendererText, /parkPondCellVerticalScale = "0\.5"/);
assert.match(rendererText, /parkPondWaveStripHeight = "2"/);
assert.match(rendererText, /parkPondWaveInterpolation = "adjacent-pixel-crossfade"/);
assert.match(rendererText, /parkPondTravellingHighlightLayer = "large-cell"/);
assert.match(rendererText, /parkPondTravellingHighlightDirection = "toward-foreground"/);
assert.match(rendererText, /parkPondFinePalette = "lightened"/);
assert.match(rendererText, /parkPondMorphFrameCount/);
assert.match(rendererText, /parkPondLargeMorphPeriodMs/);
assert.match(rendererText, /parkPondFineMorphPeriodMs/);
assert.match(rendererText, /parkPondMorphInterpolation = "cyclic-smoothstep-crossfade"/);
assert.match(rendererText, /parkPondCoverageMinX = "730"/);
assert.match(rendererText, /parkPondLeftBay = "audited-seeded-water"/);
assert.match(rendererText, /parkPondLargeMorphPhase/);
assert.match(rendererText, /parkPondFineMorphPhase/);
assert.match(rendererText, /parkPondParticleCount/);
assert.match(rendererText, /parkPondTimeGraded = "true"/);
const pondDrawCallIndex = rendererText.lastIndexOf("drawPondSurface(ctx, layers, motionNowMs)");
const avatarDrawCallIndex = rendererText.lastIndexOf("drawAvatar(");
assert(pondDrawCallIndex >= 0, "pond surface draw call must exist");
assert(avatarDrawCallIndex > pondDrawCallIndex, "pond surface must render below the avatar");
assert.match(rendererText, /const resolveShoreFoamBreath/);
assert.match(rendererText, /let shoreFoamMotionCanvas/);
assert.match(rendererText, /let shoreFoamHighlightCanvas/);
assert.match(rendererText, /let shoreFoamFringeCanvas/);
assert.match(rendererText, /const smootherstep/);
assert.match(rendererText, /const cycle = \(nowMs \/ segment\.periodMs \+ segment\.phase/);
assert.match(rendererText, /const localBreath = smootherstep\(riseAndFall\)/);
assert.match(rendererText, /const distanceSteps = segment\.amplitudePx \* localBreath/);
assert.match(rendererText, /const lowerStep = Math\.floor\(distanceSteps\)/);
assert.match(rendererText, /coreAlpha \* \(1 - mix\)/);
assert.match(rendererText, /coreAlpha \* mix/);
assert.match(rendererText, /const coreAlpha = 0\.62 \+ localBreath \* 0\.38/);
assert.match(rendererText, /const highlightAlpha = 0\.02 \+ localBreath \* 0\.26/);
assert.match(rendererText, /const fringeBreath = smootherstep\(\(localBreath - 0\.28\) \/ 0\.72\)/);
assert.match(rendererText, /const fringeAlpha = fringeBreath \* 0\.3/);
assert.match(rendererText, /const fringeDistanceSteps = distanceSteps \+ fringeBreath \* 0\.75/);
assert.match(rendererText, /segment\.directionX \* step/);
assert.match(rendererText, /segment\.directionY \* step/);
assert.match(rendererText, /motion\.drawImage\(layers\.shoreFoamMotionMask, 0, 0\)/);
assert.match(rendererText, /highlight\.drawImage\(layers\.shoreFoamMotionMask, 0, 0\)/);
assert.match(rendererText, /fringe\.drawImage\(layers\.shoreFoamMotionMask, 0, 0\)/);
assert.match(shoreFoamMotionText, /ctx\.globalCompositeOperation = "source-over"/);
assert.match(shoreFoamMotionText, /ctx\.globalAlpha = nightDimming/);
assert.match(shoreFoamMotionText, /ctx\.globalCompositeOperation = "screen"/);
assert.match(rendererText, /parkShoreFoamSegmentCount/);
assert.match(rendererText, /parkShoreFoamGroupCount/);
assert.match(rendererText, /parkShoreFoamMaxOffset = "2\.25"/);
assert.match(rendererText, /parkShoreFoamInterpolatingSegments/);
assert.match(rendererText, /parkShoreFoamBreathingFringeSegments/);
assert.match(rendererText, /parkShoreFoamFringeOffset = "0\.75"/);
assert.match(rendererText, /parkShoreFoamTimeGraded = "true"/);
assert.match(rendererText, /parkShoreFoamNightDimming = "0\.62"/);
assert.match(shoreFoamMotionText, /const nightDimming = 1 - visual\.nightStrength \* 0\.62/);
const foamDrawCallIndex = rendererText.lastIndexOf("const foamMotion = drawShoreFoamBreath");
const timeGradeCallIndex = rendererText.lastIndexOf("applyTimeGrade(ctx, timeVisual)");
assert(foamDrawCallIndex >= 0, "foam draw call must exist");
assert(timeGradeCallIndex > foamDrawCallIndex, "time grade must be applied after moving foam");
assert(timeGradeCallIndex > pondDrawCallIndex, "pond surface must be affected by the time grade");
assert.match(rendererText, /parkShoreFoamMotionPhase/);
assert.doesNotMatch(shoreFoamMotionText, /Math\.random\(\)/);
assert.doesNotMatch(shoreFoamMotionText, /Math\.round\(Math\.sin/);
assert.match(rendererText, /drawFoamBand\(layers\.shoreFoamOuterMask, 0\.1 \+ outerExpansion \* 0\.22\)/);
assert.match(rendererText, /drawFoamBand\(layers\.shoreFoamInnerMask, 0\.44 \+ breath \* 0\.28\)/);
assert.match(rendererText, /const outerExpansion = Math\.max/);
assert.doesNotMatch(rendererText, /shoreFoamCanvas/);
assert.match(rendererText, /parkSeaMotionMaskPixels/);
assert.match(rendererText, /parkShoreFoamInnerMaskPixels/);
assert.match(rendererText, /parkShoreFoamOuterMaskPixels/);
assert.match(rendererText, /parkDistantShoreFoamMaskPixels/);
assert.match(rendererText, /parkShoreFoamBreath/);
assert.doesNotMatch(rendererText, /Math\.floor\(nowMs \/ \(110 \+ \(index % 3\) \* 31\)\)/);
assert.match(rendererText, /const PARK_CLOUD_LANES/);
assert.match(rendererText, /const trackLength = PARK_SCENE_WIDTH \+ travelWidth \+ lane\.gap/);
assert.match(rendererText, /const cycleIndex = Math\.floor\(travel \/ trackLength\)/);
assert.match(rendererText, /phase - travelWidth - lane\.gap \/ 2 \+ \(travelWidth - drawWidth\) \/ 2/);
assert.match(rendererText, /ctx\.drawImage\(sprite, x, lane\.y, drawWidth, drawHeight\)/);
assert.match(rendererText, /ctx\.imageSmoothingEnabled = true/);
assert.doesNotMatch(rendererText, /ctx\.drawImage\(sprite, Math\.round\(x\)/);
assert.doesNotMatch(rendererText, /from "\.\/parkClouds"/);
assert.match(rendererText, /parkCloudSource = "imagegen-time-atlas"/);
assert.match(rendererText, /scale: 0\.684/);
assert.match(rendererText, /scale: 0\.216/);
assert.match(rendererText, /styleSequence: \[3, 4\]/);
assert.match(rendererText, /styleSequence: \[5, 6\]/);
assert.match(rendererText, /styleSequence: \[0\].*speed: 0\.0027/);
assert.match(rendererText, /styleSequence: \[1\].*speed: 0\.00205/);
assert.match(rendererText, /styleSequence: \[2\].*speed: 0\.00335/);
assert.equal((rendererText.match(/alpha: 1/g) ?? []).length, 6);
assert.match(rendererText, /styleSequence: \[0\], y: -41\.5/);
assert.match(rendererText, /styleSequence: \[1\], y: -25/);
assert.match(rendererText, /styleSequence: \[2\], y: -5/);
assert.match(rendererText, /styleSequence: \[3, 4\], y: -2\.5/);
assert.match(rendererText, /styleSequence: \[5, 6\], y: 1\.5/);
assert.match(rendererText, /styleSequence: \[7\], y: 8\.5/);
assert.match(rendererText, /ctx\.globalAlpha = lane\.alpha/);
assert.doesNotMatch(rendererText, /lane\.alpha \* \(1 - visual\.nightStrength/);
assert.match(rendererText, /const lightingNowMs = previewTime\(options\.nowMs\)/);
assert.match(rendererText, /const motionNowMs = options\.nowMs/);
assert.match(rendererText, /drawMovingCloudLayer\(ctx, timeVisual, motionNowMs\)/);
const blendedCloudStart = rendererText.indexOf("const blendedCloud =");
const blendedCloudEnd = rendererText.indexOf("const PARK_CLOUD_DRAW_REFERENCE_HEIGHT");
assert(blendedCloudStart >= 0 && blendedCloudEnd > blendedCloudStart, "blended cloud block must exist");
const blendedCloudBlock = rendererText.slice(blendedCloudStart, blendedCloudEnd);
assert.match(blendedCloudBlock, /style\.variants\[blend\.from\]/);
assert.match(blendedCloudBlock, /style\.variants\[blend\.to\]/);
assert.match(blendedCloudBlock, /quantizedMix/);
assert.match(blendedCloudBlock, /globalCompositeOperation = "source-atop"/);
assert.match(blendedCloudBlock, /getImageData/);
assert.match(rendererText, /PARK_CLOUD_DRAW_REFERENCE_HEIGHT = 227/);
assert.match(rendererText, /PARK_CLOUD_TRAVEL_REFERENCE_HEIGHT = 454/);
assert.match(rendererText, /const targetContentHeight = PARK_CLOUD_DRAW_REFERENCE_HEIGHT \* lane\.scale/);
assert.match(rendererText, /const travelContentHeight = PARK_CLOUD_TRAVEL_REFERENCE_HEIGHT \* lane\.scale/);
for (const hour of [4.5, 6.5, 11.5, 15.5, 18.3, 20.5]) {
  assert.match(rendererText, new RegExp(String(hour).replace(".", "\\.")));
}
assert.match(rendererText, /parkCloudCornerAlpha/);
assert.match(rendererText, /const travel = celestial\.progress \* 175/);
assert.match(rendererText, /globalCompositeOperation = "destination-in"/);
for (const hour of [0, 6.5, 12.2, 18.3, 21]) {
  assert.match(rendererText, new RegExp(`hour: ${String(hour).replace(".", "\\.")}`));
}
assert.match(layersText, /PARK_REFERENCE_ASSET = "\/park\/hilltop-park-midday-ground\.png"/);
assert.match(layersText, /PARK_REFERENCE_STAMP_ASSET = "\/park\/hilltop-park-reference\.png"/);
assert.match(layersText, /PARK_REFERENCE_SOURCE_WIDTH = 1435/);
assert.match(layersText, /PARK_REFERENCE_SOURCE_HEIGHT = 1095/);
assert.match(layersText, /buildLayers\(image, stampImage\)/);
assert.doesNotMatch(layersText, /\{ x: 234, y: 397, width: 52, length: 90/);
assert.doesNotMatch(layersText, /\{ x: 507, y: 298, width: 86, length: 168/);
assert.doesNotMatch(layersText, /\{ x: 871, y: 334, width: 64, length: 112/);
assert.match(layersText, /const makeNeutralBase/);
assert.match(layersText, /const smoothFeather/);
assert.match(layersText, /previousSeaNeutral/);
assert.match(layersText, /sampledNeutral\[index\].*0\.12/);
assert.match(layersText, /const topFeather = smoothFeather/);
assert.match(layersText, /const bottomFeather = 1 - smoothFeather/);
assert.match(layersText, /const rightFeather = 1 - smoothFeather/);
assert.match(layersText, /blendedSolarWeight/);
assert.match(layersText, /const brightnessCorrection = brightness - neutralTargetBrightness/);
assert.match(layersText, /targetRed/);
assert.match(layersText, /targetGreen/);
assert.match(layersText, /targetBlue/);
assert.doesNotMatch(layersText, /for \(let x = 0; x < 245; x \+= 1\)/);
assert.match(layersText, /const makeSeaMasks/);
assert.match(layersText, /const connectedSea = new Uint8Array/);
assert.match(layersText, /while \(queueHead < queueTail\)/);
assert.match(layersText, /const PARK_OCEAN_LAND_EXCLUSIONS/);
assert.match(layersText, /const makeLandExclusionMask/);
assert.match(layersText, /if \(landExclusion\[index\] !== 0\) connectedSea\[index\] = 0/);
assert.match(layersText, /if \(connectedSea\[index\] !== 0 && nearestLand <= 4\) seaMotion\[index\] = 0/);
assert.match(layersText, /seaMotionMask: makeMaskCanvas\(seaMotion\)/);
assert.match(layersText, /const staticFoamColor = brightness >= 126/);
assert.match(layersText, /let touchesConnectedSea = false/);
assert.match(layersText, /Expand only the authored foam pixels toward connected water/);
assert.match(layersText, /const makeMaskDistanceField/);
assert.match(layersText, /const landDistance = makeMaskDistanceField\(landExclusion, 7\)/);
assert.match(layersText, /const PARK_DISTANT_SHORE_FOAM_BANDS/);
for (const secondaryBand of [
  /id: "left-island-secondary"[\s\S]*?minX: 0, minY: 225, maxX: 100, maxY: 260[\s\S]*?splitIntoComponents: true/,
  /id: "left-upper-secondary"[\s\S]*?minX: 45, minY: 250, maxX: 235, maxY: 335[\s\S]*?splitIntoComponents: true/,
  /id: "left-lower-secondary"[\s\S]*?minX: 60, minY: 325, maxX: 270, maxY: 420[\s\S]*?splitIntoComponents: true/,
]) {
  assert.match(layersText, secondaryBand);
}
for (const group of [
  "left-island",
  "left-coast-upper",
  "left-coast-lower",
  "center-island",
  "right-island-upper",
  "right-island-lower",
]) {
  assert.match(layersText, new RegExp(`group: "${group}"`));
}
assert.match(layersText, /const whiteFoam = luma >= 190/);
assert.match(layersText, /const blueWhiteFoam = luma >= 150/);
assert.match(layersText, /if \(contrast < 18\) continue/);
assert.match(layersText, /distantShoreFoamCandidates/);
assert.doesNotMatch(layersText, /const distantLandDistance/);
assert.match(layersText, /const makeBaseWithoutDistantShoreFoam/);
assert.match(layersText, /if \(distantShoreFoam\[index\] !== 0\) shoreFoamInner\[index\] = 0/);
assert.match(layersText, /neutralBaseWithoutDistantShoreFoam: makeBaseWithoutDistantShoreFoam/);
assert.match(layersText, /const foamDistance = makeMaskDistanceField\(shoreFoamInner, 3\)/);
assert.match(layersText, /shoreFoamInnerMask: makeMaskCanvas\(shoreFoamInner\)/);
assert.match(layersText, /shoreFoamOuterMask: makeMaskCanvas\(shoreFoamOuter\)/);
assert.match(layersText, /distantShoreFoamMask: makeMaskCanvas\(distantShoreFoam\)/);
assert.match(layersText, /shoreFoamMotionMask: makeMaskCanvas\(shoreFoamMotion\)/);
assert.match(layersText, /const makePondMasks/);
assert.match(layersText, /const PARK_POND_MIN_X = 750/);
assert.match(layersText, /const PARK_POND_AUDITED_SEEDS/);
assert.match(layersText, /\[790, 620\]/);
assert.match(layersText, /\[800, 650\]/);
assert.match(layersText, /PARK_POND_AUDITED_SEEDS\.forEach/);
assert.match(layersText, /const connectedPond = new Uint8Array/);
assert.match(layersText, /Seeding only[\s\S]*those edges rejects isolated blue details/);
assert.match(layersText, /pondMask: makeMaskCanvas\(connectedPond\)/);
assert.match(layersText, /pondInteriorMask: makeMaskCanvas\(pondInterior\)/);
assert.match(layersText, /pondEdgeMask: makeMaskCanvas\(pondEdge\)/);
assert.match(layersText, /pondRimMask: makeMaskCanvas\(pondRim\)/);
assert.match(layersText, /const makeShoreFoamSegments/);
assert.match(layersText, /if \(!band\.splitIntoComponents\)/);
assert.match(layersText, /for \(let deltaY = -1; deltaY <= 1; deltaY \+= 1\)/);
assert.match(layersText, /for \(let deltaX = -3; deltaX <= 3; deltaX \+= 1\)/);
assert.match(layersText, /`\$\{band\.id\}-\$\{componentIndex \+ 1\}`/);
assert.match(layersText, /periodMs: 3400 \+ \(periodHash % 1601\)/);
assert.match(rendererText, /Math\.sin\(nowMs \/ 675\)/);
assert.match(rendererText, /Math\.sin\(nowMs \/ 1025 \+ 1\.35\)/);
assert.match(layersText, /inhaleRatio: 0\.54/);
assert.match(layersText, /amplitudePx: 1\.8/);
assert.match(layersText, /directionX: band\.directionX/);
assert.match(layersText, /directionY: band\.directionY/);
assert.match(layersText, /shoreFoamSegments: makeShoreFoamSegments\(distantShoreFoam, sourceImage\)/);
assert.doesNotMatch(layersText, /CLOUD_RECIPES/);
assert.match(layersText, /PARK_REFERENCE_SHADOW_CASTERS/);
assert.match(layersText, /const STATIC_OCCLUDER_RECIPES/);
for (const occluderId of [
  "upper-rock-flower-cluster",
  "left-double-rock-cluster",
  "middle-single-rock",
  "middle-white-flower-shrub",
  "lower-pink-flower-shrub",
]) {
  assert.match(layersText, new RegExp(`id: "${occluderId}"`));
}
assert.match(layersText, /const makeStaticOccluder/);
assert.match(layersText, /type OccluderContour/);
assert.match(layersText, /pointInsideContour/);
assert.match(layersText, /occluderContourAt/);
assert.match(layersText, /minComponentPixels/);
assert.match(layersText, /connectedPixels/);
assert.match(layersText, /component\.length >= recipe\.minComponentPixels/);
assert.match(layersText, /mode: "solid"/);
assert.doesNotMatch(layersText, /OccluderEllipse/);
assert.doesNotMatch(layersText, /occluderSilhouetteCoverage/);
assert.match(layersText, /staticOccluders: ParkReferenceOccluder\[\]/);
assert.match(layersText, /makeStaticOccluder\(neutralBase, recipe\)/);
assert.match(rendererText, /const staticOccludersInFront = options\.avatar/);
assert.match(rendererText, /occluder\.depthY > avatarY/);
assert.match(rendererText, /drawReferenceOccluder\(ctx, occluder\)/);
assert.match(rendererText, /parkStaticOccluderCount/);
assert.match(rendererText, /parkStaticOccludersInFront/);
assert.doesNotMatch(rendererText, /parkOccluderDebug/);
assert.doesNotMatch(rendererText, /black-background/);
assert.match(layersText, /seaMaskPixels/);
assert.match(layersText, /seaMotionMaskPixels/);
assert.match(layersText, /shoreFoamInnerMaskPixels/);
assert.match(layersText, /shoreFoamOuterMaskPixels/);
assert.match(layersText, /distantShoreFoamMaskPixels/);
assert.match(layersText, /shoreFoamMotionMaskPixels/);
assert.match(cloudAtlasText, /PARK_CLOUD_ATLAS_ASSET/);
assert.match(cloudAtlasText, /cumulonimbus-cloud-time-atlas\.png/);
assert.match(cloudAtlasText, /ATLAS_COLUMN_WIDTH = 418/);
assert.match(cloudAtlasText, /const ATLAS_ROWS/);
assert.equal((cloudAtlasText.match(/\{ y: \d+, height: \d+ \}/g) ?? []).length, 8);
assert.match(cloudAtlasText, /\["dawn", "noon", "sunset"\]/);
assert.match(cloudAtlasText, /BLACK_KEY_CUTOFF = 48/);
assert.match(cloudAtlasText, /SPRITE_SAFE_MARGIN = 4/);
assert.match(cloudAtlasText, /CUMULONIMBUS_STYLE_COUNT = 3/);
assert.match(cloudAtlasText, /CUMULONIMBUS_BOTTOM_EDGE_ALPHA = \[96, 184, 232\]/);
assert.match(cloudAtlasText, /getImageData/);
assert.match(cloudAtlasText, /const erodedMask = erodeMask/);
assert.match(cloudAtlasText, /erodedMask\[maskIndex\] === 0/);
assert.match(cloudAtlasText, /const featherCumulonimbusBottomEdge/);
assert.match(cloudAtlasText, /styleIndex < CUMULONIMBUS_STYLE_COUNT/);
assert.match(cloudAtlasText, /featherCumulonimbusBottomEdge\(pixels, erodedMask/);
assert.match(cloudAtlasText, /pixels\[pixelIndex \+ 3\] = 255/);
assert.match(cloudAtlasText, /ctx\.putImageData\(imageData, 0, 0\)/);
assert.match(cloudAtlasText, /ensureParkCloudAtlas/);
assert.match(cloudAtlasText, /getParkCloudAtlasStyles/);
assert.match(cloudAtlasText, /parkCloudAtlasOpaquePixelCount/);
assert.equal(groundImage.readUInt32BE(16), 1435);
assert.equal(groundImage.readUInt32BE(20), 1096);
assert.equal(
  createHash("sha256").update(groundImage).digest("hex"),
  "64b9c73327ee7d912ad66271402ba9f2d82034144285ca754737c43050355eba",
  "park ground asset must remain byte-identical to the approved ImageGen output",
);
assert.equal(referenceImage.readUInt32BE(16), 1436);
assert.equal(referenceImage.readUInt32BE(20), 1096);
assert.equal(
  createHash("sha256").update(referenceImage).digest("hex"),
  "9a2974b347735b1c20d91fd0b7574a7cd41cb3a813f0ee5801fb57692ccb25a7",
  "park reference asset must remain byte-identical to the approved ImageGen output",
);
assert.equal(cloudAtlasImage.readUInt32BE(16), 1254);
assert.equal(cloudAtlasImage.readUInt32BE(20), 1254);
assert.equal(cloudAtlasImage.readUInt8(25), 2, "black-key cloud atlas must remain RGB");
assert.equal(
  createHash("sha256").update(cloudAtlasImage).digest("hex"),
  "eb01111594f15522e71029b9f80f25597baba273533ec30a54fa2b59a4aba899",
  "three-state ImageGen cloud atlas must remain stable",
);
for (const [name, image, expectedHash] of [
  ["black bass", blackBassImage, "6cd6e5413a4d31e1ec4e702ad2c56a6cb4c1b0c532f34fc7d386f9809c3d171e"],
  ["crucian carp", crucianCarpImage, "6b8ecb86e2c718771fac0dab5720642ff0c389ce22beb4dbc93573e29a3a9084"],
]) {
  assert.equal(image.readUInt32BE(16), 64, `${name} sprite width must remain 64px`);
  assert.equal(image.readUInt32BE(20), 40, `${name} sprite height must remain 40px`);
  assert.equal(image.readUInt8(25), 6, `${name} sprite must remain RGBA`);
  assert.equal(
    createHash("sha256").update(image).digest("hex"),
    expectedHash,
    `${name} ImageGen sprite must remain stable`,
  );
}

console.log("Park smoke passed: static rock/shrub occluders, ambient water and foam motion, looping clouds, handoff, traits, fish, cooking, and window size markers are present.");
