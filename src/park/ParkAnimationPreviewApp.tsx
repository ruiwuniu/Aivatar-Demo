import { useEffect, useRef, useState } from "react";
import { drawAvatar } from "../game/renderScene";
import type {
  AvatarAppearanceId,
  AvatarRuntime,
  BehaviorName,
  PetStats,
} from "../types";
import {
  PARK_FISHING_SPOTS,
  type ParkFishingSpot,
} from "./parkContent";
import {
  createParkFishingAudioBank,
  disposeParkFishingAudioBank,
  playParkFishingSound,
  type ParkFishingAudioBank,
} from "./parkFishingAudio";
import {
  drawParkFishingAnimation,
  resolveParkFishingGrip,
  resolveParkFishingVisualAvatar,
} from "./parkFishingAnimation";
import type { ParkRawFishId } from "./parkProbability";
import type { ParkFishingPose } from "./parkRuntime";
import { readParkSaveSlot } from "./parkStorage";

const PREVIEW_WIDTH = 560;
const PREVIEW_HEIGHT = 320;
const PREVIEW_STATS: PetStats = { energy: 100, mood: 100, hunger: 100 };
const PREVIEW_SPOT: ParkFishingSpot = {
  ...PARK_FISHING_SPOTS[1]!,
  x: 236,
  y: 224,
  bobberX: 438,
  bobberY: 235,
};

const APPEARANCES: Array<{ id: AvatarAppearanceId; label: string }> = [
  { id: "octopus", label: "章鱼" },
  { id: "demo-spark", label: "星火" },
  { id: "mood-slime", label: "史莱姆" },
  { id: "cute-crayfish", label: "小龙虾" },
  { id: "cute-ghost", label: "幽灵" },
  { id: "cute-penguin", label: "企鹅" },
  { id: "wave-lizard", label: "波纹蜥蜴" },
];

const BEHAVIOR_ACTIONS: Array<{ id: BehaviorName; label: string }> = [
  { id: "idle", label: "待机" },
  { id: "explore", label: "探索" },
  { id: "wander", label: "走路" },
  { id: "sleep", label: "睡觉" },
  { id: "relax", label: "放松" },
  { id: "admire", label: "欣赏" },
  { id: "interact", label: "互动" },
  { id: "thinking", label: "思考" },
  { id: "coding", label: "编码" },
  { id: "waiting", label: "等待" },
  { id: "success", label: "成功" },
  { id: "error", label: "出错" },
  { id: "phone", label: "手机" },
  { id: "coffee", label: "喝咖啡" },
  { id: "cola", label: "喝可乐" },
  { id: "bento", label: "吃便当" },
  { id: "cookie", label: "吃饼干" },
  { id: "snack", label: "零食" },
  { id: "brew", label: "冲泡" },
  { id: "paint", label: "绘画" },
  { id: "play", label: "玩耍" },
  { id: "music", label: "音乐" },
  { id: "workout", label: "锻炼" },
  { id: "fetch_task_file", label: "取任务" },
  { id: "carry_task_file", label: "搬任务" },
  { id: "read_task_file", label: "读任务" },
  { id: "read_book", label: "长椅读书" },
];

const FISHING_ACTIONS: Array<{ id: ParkFishingPose; label: string }> = [
  { id: "cast", label: "甩杆" },
  { id: "focus", label: "专注垂钓" },
  { id: "yawn", label: "打哈欠" },
  { id: "whistle", label: "吹口哨" },
  { id: "bite", label: "鱼上钩" },
  { id: "reel", label: "收杆" },
  { id: "display", label: "展示鱼" },
];

const DISPLAY_FISH_OPTIONS: Array<{ id: ParkRawFishId; label: string }> = [
  { id: "raw-crucian-carp", label: "鲫鱼" },
  { id: "raw-bluegill", label: "蓝鳃太阳鱼" },
  { id: "raw-black-bass", label: "黑鲈" },
  { id: "raw-yellow-perch", label: "黄鲈" },
  { id: "raw-weather-loach", label: "泥鳅" },
  { id: "raw-rainbow-trout", label: "虹鳟" },
];

const FISHING_LOOP_DURATION: Partial<Record<ParkFishingPose, number>> = {
  cast: 1900,
  bite: 3200,
  reel: 2200,
  display: 2800,
};

const appearanceFromSave = (): AvatarAppearanceId => {
  const hostSlotId = new URLSearchParams(window.location.search).get("hostSlotId")?.trim();
  const value = hostSlotId ? readParkSaveSlot(hostSlotId)?.avatarAppearanceId : undefined;
  return APPEARANCES.some((appearance) => appearance.id === value)
    ? value as AvatarAppearanceId
    : "octopus";
};

const behaviorForFishingPose = (pose: ParkFishingPose): BehaviorName => {
  if (pose === "yawn") return "sleep";
  if (pose === "display") return "success";
  if (pose === "focus" || pose === "whistle") return "admire";
  return "interact";
};

const expressionForAction = (
  behavior: BehaviorName,
  fishingPose: ParkFishingPose,
): AvatarRuntime["expression"] => {
  if (fishingPose === "yawn" || behavior === "sleep") return "sleepy";
  if (behavior === "error") return "worried";
  if (
    fishingPose === "cast" ||
    fishingPose === "focus" ||
    fishingPose === "bite" ||
    fishingPose === "reel" ||
    behavior === "thinking" ||
    behavior === "coding"
  ) {
    return "focused";
  }
  return "happy";
};

const drawPreviewStage = (
  ctx: CanvasRenderingContext2D,
  nowMs: number,
) => {
  ctx.fillStyle = "#142438";
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  ctx.fillStyle = "#86a84c";
  ctx.fillRect(0, 112, 338, 208);
  ctx.fillStyle = "#71943f";
  ctx.fillRect(0, 112, 338, 8);
  ctx.fillRect(0, 304, 338, 16);
  ctx.fillStyle = "#375531";
  for (let x = 8; x < 330; x += 18) {
    const height = 2 + ((x * 7) % 4);
    ctx.fillRect(x, 126 + ((x * 11) % 164), 2, height);
  }

  ctx.fillStyle = "#65492f";
  ctx.fillRect(330, 118, 12, 202);
  ctx.fillStyle = "#9a784a";
  ctx.fillRect(330, 118, 6, 202);
  ctx.fillStyle = "#17638a";
  ctx.fillRect(342, 112, PREVIEW_WIDTH - 342, PREVIEW_HEIGHT - 112);
  ctx.fillStyle = "#287ea1";
  ctx.fillRect(342, 112, PREVIEW_WIDTH - 342, 8);
  for (let index = 0; index < 26; index += 1) {
    const x = 352 + ((index * 43 + Math.floor(nowMs / 90)) % 196);
    const y = 128 + ((index * 29) % 176);
    ctx.fillStyle = index % 3 === 0 ? "#9dd7d5" : "#4598b1";
    ctx.fillRect(x, y, 6 + (index % 4) * 3, 1);
  }
};

export const ParkAnimationPreviewApp = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fishingAudioBankRef = useRef<ParkFishingAudioBank | null>(null);
  const [appearanceId, setAppearanceId] = useState<AvatarAppearanceId>(appearanceFromSave);
  const [behavior, setBehavior] = useState<BehaviorName>("idle");
  const [fishingPose, setFishingPose] = useState<ParkFishingPose>("none");
  const [displayFishId, setDisplayFishId] = useState<ParkRawFishId>("raw-black-bass");
  const [facing, setFacing] = useState<AvatarRuntime["facing"]>("right");
  const [replayKey, setReplayKey] = useState(0);

  useEffect(() => {
    const audioBank = createParkFishingAudioBank();
    fishingAudioBankRef.current = audioBank;
    return () => {
      fishingAudioBankRef.current = null;
      disposeParkFishingAudioBank(audioBank);
    };
  }, []);

  useEffect(() => {
    let animation = 0;
    let frame = 0;
    const actionStartedAt = performance.now();
    const draw = (now: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== PREVIEW_WIDTH) canvas.width = PREVIEW_WIDTH;
      if (canvas.height !== PREVIEW_HEIGHT) canvas.height = PREVIEW_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      drawPreviewStage(ctx, now);

      const walking = fishingPose === "none" && (behavior === "wander" || behavior === "explore");
      const avatarX = PREVIEW_SPOT.x + (walking ? Math.sin(now / 520) * 26 : 0);
      const activeBehavior = fishingPose === "none" ? behavior : behaviorForFishingPose(fishingPose);
      const avatarFrame = activeBehavior === "read_book"
        ? Math.max(0, Math.floor((now - actionStartedAt) / 1000 * 60))
        : frame;
      const activeFacing =
        fishingPose === "none"
          ? facing
          : fishingPose === "display"
            ? "front"
            : fishingPose === "cast"
              ? facing
              : "right";
      const baseAvatar: AvatarRuntime = {
        x: avatarX,
        y: PREVIEW_SPOT.y,
        targetX: walking ? avatarX + Math.cos(now / 520) * 24 : avatarX,
        targetY: PREVIEW_SPOT.y,
        facing: activeFacing,
        behavior: activeBehavior,
        behaviorTimer: 1,
        expression: expressionForAction(activeBehavior, fishingPose),
        activityLabel: fishingPose === "none" ? behavior : fishingPose,
      };
      const loopDuration = FISHING_LOOP_DURATION[fishingPose];
      const poseStartedAt = loopDuration
        ? now - ((now - actionStartedAt) % loopDuration)
        : actionStartedAt;
      const avatar = resolveParkFishingVisualAvatar(
        baseAvatar,
        fishingPose,
        now,
        poseStartedAt,
      );
      const crayfishGrip = appearanceId === "cute-crayfish"
        ? resolveParkFishingGrip(
            avatar,
            appearanceId,
            fishingPose,
            frame,
            now,
            poseStartedAt,
          )
        : undefined;
      const drawFishing = () => drawParkFishingAnimation({
        ctx,
        avatar,
        appearanceId,
        pose: fishingPose,
        fishId:
          fishingPose === "display" || fishingPose === "reel"
            ? displayFishId
            : undefined,
        frame,
        nowMs: now,
        poseStartedAt,
        spot: PREVIEW_SPOT,
      });
      if (crayfishGrip) drawFishing();
      drawAvatar(
        ctx,
        avatar,
        avatarFrame,
        PREVIEW_STATS,
        { status: "idle", timestamp: new Date().toISOString() },
        undefined,
        appearanceId,
        { heldPropGrip: crayfishGrip },
      );
      if (!crayfishGrip) drawFishing();

      canvas.dataset.previewBehavior = behavior;
      canvas.dataset.previewFishingPose = fishingPose;
      canvas.dataset.previewAppearance = appearanceId;
      canvas.dataset.previewFishingSpot = PREVIEW_SPOT.id;
      canvas.dataset.previewFishId = displayFishId;
      canvas.dataset.previewFishingFacing = activeFacing;
      canvas.dataset.previewFishingRecoilX = String(Math.round(avatar.x - baseAvatar.x));
      canvas.dataset.previewBookFrame = String(avatarFrame);
      frame += 1;
      animation = window.requestAnimationFrame(draw);
    };
    animation = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(animation);
  }, [appearanceId, behavior, displayFishId, fishingPose, facing, replayKey]);

  const selectBehavior = (nextBehavior: BehaviorName) => {
    if (nextBehavior === "read_book") setFacing("front");
    setBehavior(nextBehavior);
    setFishingPose("none");
    setReplayKey((value) => value + 1);
  };

  const selectFishingPose = (pose: ParkFishingPose) => {
    playParkFishingSound(fishingAudioBankRef.current, pose);
    if (pose === "cast") setFacing("front");
    setFishingPose(pose);
    setBehavior(behaviorForFishingPose(pose));
    setReplayKey((value) => value + 1);
  };

  const replayAction = () => {
    playParkFishingSound(fishingAudioBankRef.current, fishingPose);
    setReplayKey((value) => value + 1);
  };

  return (
    <main className="park-animation-preview-app" aria-label="角色动作预览">
      <section className="park-animation-preview-stage" aria-label="动作预览画布">
        <canvas ref={canvasRef} />
        <div className="park-animation-preview-caption">
          {fishingPose === "none" ? `基础动作 · ${behavior}` : `钓鱼动作 · ${fishingPose}`}
        </div>
      </section>

      <section className="park-animation-preview-controls" aria-label="角色动作按钮">
        <div className="park-animation-preview-toolbar">
          <label>
            角色
            <select
              value={appearanceId}
              onChange={(event) => setAppearanceId(event.target.value as AvatarAppearanceId)}
            >
              {APPEARANCES.map((appearance) => (
                <option key={appearance.id} value={appearance.id}>{appearance.label}</option>
              ))}
            </select>
          </label>
          <span className="park-animation-preview-facing" aria-label="预览方向">
            {(["front", "back", "left", "right"] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                className={facing === direction ? "active" : undefined}
                onClick={() => {
                  setFacing(direction);
                  if (fishingPose !== "cast") setFishingPose("none");
                }}
              >
                {direction}
              </button>
            ))}
          </span>
          <button type="button" onClick={replayAction}>
            重新播放
          </button>
          <span className="park-animation-preview-facing" aria-label="展示鱼种">
            {DISPLAY_FISH_OPTIONS.map((fish) => (
              <button
                key={fish.id}
                type="button"
                className={displayFishId === fish.id ? "active" : undefined}
                onClick={() => {
                  setDisplayFishId(fish.id);
                  selectFishingPose("display");
                }}
              >
                {fish.label}
              </button>
            ))}
          </span>
        </div>

        <div className="park-animation-preview-group">
          <h2>钓鱼动作</h2>
          <div className="park-animation-preview-buttons">
            {FISHING_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className={fishingPose === action.id ? "active" : undefined}
                onClick={() => selectFishingPose(action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <div className="park-animation-preview-group">
          <h2>全部基础动作</h2>
          <div className="park-animation-preview-buttons">
            {BEHAVIOR_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className={fishingPose === "none" && behavior === action.id ? "active" : undefined}
                onClick={() => selectBehavior(action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
