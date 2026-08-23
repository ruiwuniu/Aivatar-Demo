import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AivatarRoomPresence,
  AivatarRoomsSnapshot,
  AivatarSaveState,
  AivatarVisitSession,
  AvatarAppearanceId,
} from "../types";
import {
  createVisitId,
  normalizeRoomPresence,
  normalizeVisitSession,
  roomVisitExpiresAt,
  roomVisitNowIso,
} from "../game/roomVisits";
import {
  renderParkScene,
  type ParkRenderProfile,
} from "./parkRenderer";
import {
  advanceParkSimulation,
  forceParkBenchPreview,
  forceParkFishingPreview,
  initialParkSimulation,
  type ParkSimulationState,
} from "./parkRuntime";
import {
  PARK_LAYOUT_EVENT,
  PARK_LAYOUT_STORAGE_KEY,
  hasFishingRod,
  persistParkRuntime,
  readParkLayout,
  readParkSaveSlot,
  recordParkCatch,
  recordParkMoodRecovery,
} from "./parkStorage";
import {
  isParkGrassPoint,
  parkFishingSpotById,
  type ParkObjectPlacement,
} from "./parkContent";
import {
  createParkFishingAudioBank,
  disposeParkFishingAudioBank,
  playParkFishingSound,
  resumeParkFishingAudioBank,
  type ParkFishingAudioBank,
} from "./parkFishingAudio";
import {
  createParkAmbientAudio,
  disposeParkAmbientAudio,
  PARK_AMBIENT_AUDIO_VOLUME_KEY,
  pauseParkAmbientAudio,
  startParkAmbientAudio,
  updateParkAmbientAudioWeather,
  type ParkAmbientAudioController,
} from "./parkAmbientAudio";
import {
  createParkWeatherAudio,
  disposeParkWeatherAudio,
  pauseParkWeatherAudio,
  startParkWeatherAudio,
  updateParkWeatherAudio,
  type ParkWeatherAudioController,
} from "./parkWeatherAudio";
import {
  createParkFootstepAudio,
  disposeParkFootstepAudio,
  resumeParkFootstepAudio,
  stopParkFootstepAudio,
  updateParkFootstepAudio,
  type ParkFootstepAudioController,
} from "./parkFootstepAudio";
import { measureParkRender } from "./parkPerformance";
import {
  createParkWeatherRuntime,
  resolveParkWeather,
  setParkWeatherDebugMode,
  type ParkWeatherDebugMode,
  type ParkWeatherFrame,
  type ParkWeatherRuntime,
} from "./parkWeather";

const ROOMS_URL = "http://127.0.0.1:38988/rooms";
const VISIT_INVITE_URL = "http://127.0.0.1:38988/visits/invite";
const VISIT_STATE_URL = "http://127.0.0.1:38988/visits/state";
const VISIT_END_URL = "http://127.0.0.1:38988/visits/end";
const PARK_VISIT_TTL_MS = 8000;
const PARK_SYNC_MS = 650;
const PARK_TARGET_FPS = 30;
const PARK_RENDER_INTERVAL_MS = 1000 / PARK_TARGET_FPS;
const PARK_RENDER_DEADLINE_TOLERANCE_MS = 1;
const SHOW_PARK_DEBUG = false;
let mainWindowVisibilityQueue: Promise<void> = Promise.resolve();

const queueMainWindowVisibility = (visible: boolean) => {
  const next = mainWindowVisibilityQueue
    .catch(() => undefined)
    .then(() => invoke<void>("set_main_window_visibility_for_park_profile", {
      visible,
    }));
  mainWindowVisibilityQueue = next.catch(() => undefined);
  return next;
};

const PARK_PREVIEW_TIMES = [
  { label: "实时", hour: null },
  { label: "朝霞 06:30", hour: 6.5 },
  { label: "中午 12:00", hour: 12 },
  { label: "晚霞 18:18", hour: 18.3 },
  { label: "夜晚 22:30", hour: 22.5 },
] as const;
const PARK_RENDER_PROFILES: ReadonlyArray<{
  id: ParkRenderProfile;
  label: string;
}> = [
  { id: "full", label: "完整" },
  { id: "base-only", label: "纯底图" },
  { id: "no-ambient", label: "关闭全部氛围" },
  { id: "no-clouds", label: "无云" },
  { id: "no-fog", label: "无雾" },
  { id: "no-grass", label: "无草纹" },
  { id: "no-pond", label: "无池塘动画" },
  { id: "no-foam", label: "无浪花" },
  { id: "no-sea-light", label: "无海面光" },
];
const PARK_WEATHER_PREVIEWS: ReadonlyArray<{
  id: ParkWeatherDebugMode;
  label: string;
}> = [
  { id: "automatic", label: "自动天气" },
  { id: "clear", label: "晴天" },
  { id: "gathering", label: "乌云聚集" },
  { id: "sprinkle", label: "零星雨滴" },
  { id: "light", label: "小雨" },
  { id: "moderate", label: "中雨" },
  { id: "heavy", label: "大雨" },
  { id: "storm", label: "暴雨" },
  { id: "tapering", label: "雨势减弱" },
  { id: "clearing", label: "雨后放晴" },
  { id: "accelerated-cycle", label: "60 秒完整雨程" },
];

const formatWeatherDuration = (durationMs: number) => {
  if (durationMs <= 0) return "";
  if (durationMs < 120_000) return `${Math.ceil(durationMs / 1000)} 秒`;
  const totalMinutes = Math.ceil(durationMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
};

const formatWeatherReadout = (weather: ParkWeatherFrame) => {
  const remaining = formatWeatherDuration(weather.remainingMs);
  const remainingLabel = remaining
    ? weather.phase === "clear"
      ? ` · 距下次天气 ${remaining}`
      : ` · 本阶段剩余 ${remaining}`
    : "";
  const rainDay = weather.debugMode === "automatic"
    ? ` · 今日${weather.isScheduledRainDay ? "为雨日" : "无自然降雨"}`
    : " · 手动预览";
  return [
    weather.label,
    `雨量 ${Math.round(weather.rainAmount * 100)}%`,
    `云量 ${Math.round(weather.cloudCover * 100)}%`,
    `海面能见度 ${Math.round(weather.seaVisibility * 100)}%`,
  ].join(" · ") + rainDay + remainingLabel;
};

const initialHostSlotId = () =>
  new URLSearchParams(window.location.search).get("hostSlotId")?.trim() || null;

const initialParkPreviewHour = () => {
  const value = Number.parseFloat(
    new URLSearchParams(window.location.search).get("parkHour") ?? "",
  );
  return Number.isFinite(value) && value >= 0 && value < 24 ? value : null;
};

const parkInstanceId = () =>
  `park-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const parkAvatarAppearance = (value: string | undefined): AvatarAppearanceId =>
  [
    "octopus",
    "demo-spark",
    "mood-slime",
    "cute-crayfish",
    "cute-ghost",
    "cute-penguin",
    "wave-lizard",
  ].includes(value ?? "")
    ? (value as AvatarAppearanceId)
    : "octopus";

const parkPresence = (
  instanceId: string,
  hostSlotId: string | null,
  visitId?: string | null,
): AivatarRoomPresence => ({
  type: "aivatar.room.presence",
  roomInstanceId: instanceId,
  slotId: `park-${hostSlotId ?? "preview"}`,
  slotIndex: 0,
  avatarId: `park-${hostSlotId ?? "preview"}`,
  avatarName: "Hilltop Park",
  avatarAppearanceId: "octopus",
  roomId: "park",
  status: "hosting",
  currentVisitId: visitId ?? null,
  updatedAt: roomVisitNowIso(),
  expiresAt: roomVisitExpiresAt(PARK_VISIT_TTL_MS),
  growthLevel: 1,
  traits: { focus: 0, resilience: 0, curiosity: 0, efficiency: 0, creativity: 0, warmth: 0 },
  idleBubblePhrases: [],
  petStats: { energy: 100, mood: 100, hunger: 100 },
});

const postJson = async (url: string, payload: unknown, keepalive = false) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive,
  });
  if (!response.ok) throw new Error(`Park bridge request failed: ${response.status}`);
  return response.json() as Promise<unknown>;
};

const normalizeSnapshot = (value: unknown): AivatarRoomsSnapshot => {
  const raw = value && typeof value === "object" ? value as { rooms?: unknown; visits?: unknown; timestamp?: unknown } : {};
  const rooms = Array.isArray(raw.rooms)
    ? raw.rooms
        .map((room) => normalizeRoomPresence(room as Partial<AivatarRoomPresence>))
        .filter((room): room is AivatarRoomPresence => Boolean(room))
    : [];
  const visits = Array.isArray(raw.visits)
    ? raw.visits
        .map((visit) => normalizeVisitSession(visit as Partial<AivatarVisitSession>))
        .filter((visit): visit is AivatarVisitSession => Boolean(visit))
    : [];
  return {
    type: "aivatar.rooms.snapshot",
    rooms,
    visits,
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : roomVisitNowIso(),
  };
};

export const ParkApp = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hostSlotId] = useState(initialHostSlotId);
  const [debugOpen, setDebugOpen] = useState(true);
  const [debugMessage, setDebugMessage] = useState("");
  const [activeRenderProfile, setActiveRenderProfile] =
    useState<ParkRenderProfile>("full");
  const renderProfileRef = useRef<ParkRenderProfile>("full");
  const [activeWeatherDebugMode, setActiveWeatherDebugMode] =
    useState<ParkWeatherDebugMode>("automatic");
  const [weatherReadout, setWeatherReadout] = useState("天气状态计算中…");
  const weatherRuntimeRef = useRef<ParkWeatherRuntime | null>(null);
  if (!weatherRuntimeRef.current) {
    weatherRuntimeRef.current = createParkWeatherRuntime(
      hostSlotId ?? "park-preview",
      Date.now(),
    );
  }
  const [mainWindowHiddenForProfile, setMainWindowHiddenForProfile] =
    useState(false);
  const mainWindowHiddenForProfileRef = useRef(false);
  const handoffMainWindowHideRequestedRef = useRef(false);
  const [mainWindowProfilePending, setMainWindowProfilePending] =
    useState(false);
  const mainWindowProfilePendingRef = useRef(false);
  const [activePreviewHour, setActivePreviewHour] = useState<number | null>(
    initialParkPreviewHour,
  );
  const instanceIdRef = useRef(parkInstanceId());
  const [objects, setObjects] = useState<ParkObjectPlacement[]>(readParkLayout);
  const objectsRef = useRef(objects);
  const [save, setSave] = useState<AivatarSaveState | null>(() =>
    hostSlotId ? readParkSaveSlot(hostSlotId) : null,
  );
  const saveRef = useRef(save);
  const visitRef = useRef<AivatarVisitSession | null>(null);
  const invitationStartedRef = useRef(false);
  const simulationRef = useRef<ParkSimulationState | null>(null);
  const fishingAudioBankRef = useRef<ParkFishingAudioBank | null>(null);
  const footstepAudioRef = useRef<ParkFootstepAudioController | null>(null);
  const ambientAudioRef = useRef<ParkAmbientAudioController | null>(null);
  const weatherAudioRef = useRef<ParkWeatherAudioController | null>(null);
  const debugPreviewRef = useRef(false);
  const debugRodRef = useRef(false);
  const lastVisitPostAtRef = useRef(0);
  const lastPersistAtRef = useRef(0);
  const lastMoodAtRef = useRef(0);
  const lastWeatherUiAtRef = useRef(Number.NEGATIVE_INFINITY);

  const restoreMainWindowAfterPark = async (updateUi = true) => {
    if (!mainWindowHiddenForProfileRef.current) {
      handoffMainWindowHideRequestedRef.current = false;
      return true;
    }
    if (!("__TAURI_INTERNALS__" in window)) {
      handoffMainWindowHideRequestedRef.current = false;
      mainWindowHiddenForProfileRef.current = false;
      if (updateUi) setMainWindowHiddenForProfile(false);
      return true;
    }
    try {
      await queueMainWindowVisibility(true);
      handoffMainWindowHideRequestedRef.current = false;
      mainWindowHiddenForProfileRef.current = false;
      if (updateUi) setMainWindowHiddenForProfile(false);
      return true;
    } catch {
      if (updateUi) setDebugMessage("无法恢复主窗口；关闭公园时将再次尝试。");
      return false;
    }
  };

  useEffect(() => {
    const audioBank = createParkFishingAudioBank();
    const resumeFishing = () => {
      void resumeParkFishingAudioBank(audioBank);
    };
    fishingAudioBankRef.current = audioBank;
    window.addEventListener("pointerdown", resumeFishing, true);
    window.addEventListener("keydown", resumeFishing, true);
    window.addEventListener("touchstart", resumeFishing, true);
    return () => {
      window.removeEventListener("pointerdown", resumeFishing, true);
      window.removeEventListener("keydown", resumeFishing, true);
      window.removeEventListener("touchstart", resumeFishing, true);
      fishingAudioBankRef.current = null;
      disposeParkFishingAudioBank(audioBank);
    };
  }, []);

  useEffect(() => {
    const footstepAudio = createParkFootstepAudio();
    const resumeFootsteps = () => resumeParkFootstepAudio(footstepAudio);
    footstepAudioRef.current = footstepAudio;
    window.addEventListener("pointerdown", resumeFootsteps, true);
    window.addEventListener("keydown", resumeFootsteps, true);
    window.addEventListener("touchstart", resumeFootsteps, true);
    return () => {
      window.removeEventListener("pointerdown", resumeFootsteps, true);
      window.removeEventListener("keydown", resumeFootsteps, true);
      window.removeEventListener("touchstart", resumeFootsteps, true);
      footstepAudioRef.current = null;
      disposeParkFootstepAudio(footstepAudio);
    };
  }, []);

  useEffect(() => {
    const ambientAudio = createParkAmbientAudio();
    const weatherAudio = createParkWeatherAudio();
    ambientAudioRef.current = ambientAudio;
    weatherAudioRef.current = weatherAudio;
    const requestPlayback = () => {
      startParkAmbientAudio(ambientAudio);
      startParkWeatherAudio(weatherAudio);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pauseParkAmbientAudio(ambientAudio);
        pauseParkWeatherAudio(weatherAudio);
      } else if (ambientAudio.wantsPlayback) {
        requestPlayback();
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PARK_AMBIENT_AUDIO_VOLUME_KEY) requestPlayback();
    };

    requestPlayback();
    window.addEventListener("pointerdown", requestPlayback, true);
    window.addEventListener("keydown", requestPlayback, true);
    window.addEventListener("touchstart", requestPlayback, true);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointerdown", requestPlayback, true);
      window.removeEventListener("keydown", requestPlayback, true);
      window.removeEventListener("touchstart", requestPlayback, true);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      ambientAudioRef.current = null;
      weatherAudioRef.current = null;
      disposeParkAmbientAudio(ambientAudio);
      disposeParkWeatherAudio(weatherAudio);
    };
  }, []);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    const refreshLayout = () => setObjects(readParkLayout());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PARK_LAYOUT_STORAGE_KEY) refreshLayout();
      if (hostSlotId && event.key === `aivatar.saveSlot.v1.${hostSlotId}`) {
        setSave(readParkSaveSlot(hostSlotId));
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(PARK_LAYOUT_EVENT, refreshLayout);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(PARK_LAYOUT_EVENT, refreshLayout);
    };
  }, [hostSlotId]);

  useEffect(() => {
    const openDeveloper = (event: KeyboardEvent) => {
      if (event.key !== "F12") return;
      event.preventDefault();
      void import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke("open_park_developer_window", {
            request: { host_slot_id: hostSlotId },
          }),
        )
        .catch(() => undefined);
    };
    window.addEventListener("keydown", openDeveloper);
    return () => window.removeEventListener("keydown", openDeveloper);
  }, [hostSlotId]);

  useEffect(() => {
    if (!hostSlotId) return;
    let stopped = false;

    const sync = async () => {
      try {
        const activeVisit = visitRef.current;
        await postJson(
          ROOMS_URL,
          parkPresence(instanceIdRef.current, hostSlotId, activeVisit?.visitId),
        );
        const response = await fetch(ROOMS_URL);
        if (!response.ok) throw new Error(`Park rooms snapshot failed: ${response.status}`);
        const snapshot = normalizeSnapshot(await response.json());
        if (stopped) return;

        if (activeVisit) {
          const latest = snapshot.visits.find((visit) => visit.visitId === activeVisit.visitId);
          if (!latest || latest.phase === "cancelled" || latest.phase === "ended") {
            visitRef.current = null;
            if (!debugPreviewRef.current) simulationRef.current = null;
            const restored = await restoreMainWindowAfterPark();
            if (restored) invitationStartedRef.current = false;
            return;
          }
          visitRef.current = latest;
          const handoffComplete =
            latest.phase !== "invited" &&
            latest.guestRuntimeRoomInstanceId === instanceIdRef.current;
          if (handoffComplete && !simulationRef.current) {
            const currentSave = readParkSaveSlot(hostSlotId);
            setSave(currentSave);
            simulationRef.current = initialParkSimulation(
              currentSave?.parkRuntime,
              currentSave?.parkNavMemory,
            );
          }
          if (
            handoffComplete
            && !handoffMainWindowHideRequestedRef.current
            && "__TAURI_INTERNALS__" in window
          ) {
            handoffMainWindowHideRequestedRef.current = true;
            mainWindowHiddenForProfileRef.current = true;
            setMainWindowHiddenForProfile(true);
            void queueMainWindowVisibility(false).catch(() => {
              if (stopped) return;
              handoffMainWindowHideRequestedRef.current = false;
              mainWindowHiddenForProfileRef.current = false;
              setMainWindowHiddenForProfile(false);
              setDebugMessage("角色已到达公园，但无法隐藏主窗口。");
            });
          }
          await postJson(VISIT_STATE_URL, {
            ...latest,
            host: parkPresence(instanceIdRef.current, hostSlotId, latest.visitId),
            updatedAt: roomVisitNowIso(),
            expiresAt: roomVisitExpiresAt(PARK_VISIT_TTL_MS),
          });
          return;
        }

        if (invitationStartedRef.current) return;
        const guestRoom = snapshot.rooms.find(
          (room) =>
            room.slotId === hostSlotId &&
            room.roomId !== "park" &&
            room.roomInstanceId !== instanceIdRef.current &&
            room.status === "home",
        );
        if (!guestRoom) return;
        const visit = normalizeVisitSession({
          type: "aivatar.room.visit",
          visitKind: "park",
          visitId: createVisitId(),
          phase: "invited",
          host: parkPresence(instanceIdRef.current, hostSlotId),
          guest: guestRoom,
          hostLayoutFingerprint: "park-v1",
          hostRoomId: "park",
          createdAt: roomVisitNowIso(),
          updatedAt: roomVisitNowIso(),
          expiresAt: roomVisitExpiresAt(PARK_VISIT_TTL_MS),
        });
        if (!visit) return;
        invitationStartedRef.current = true;
        visitRef.current = visit;
        await postJson(VISIT_INVITE_URL, visit);
      } catch {
        // The park remains an empty animated landscape until the main room bridge is available.
      }
    };

    void sync();
    const timer = window.setInterval(sync, PARK_SYNC_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [hostSlotId]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    let nextRenderAt = previous;
    let stopped = false;
    let animation = 0;
    const loop = (now: number) => {
      if (stopped) return;
      const elapsed = Math.min(0.08, Math.max(0, (now - previous) / 1000));
      previous = now;
      frame += elapsed * 60;
      const simulation = simulationRef.current;
      const currentSave = saveRef.current;
      const visit = visitRef.current;
      const debugPreviewActive = debugPreviewRef.current;
      if (simulation && currentSave && hostSlotId && (visit || debugPreviewActive)) {
        const previousFishingPose = simulation.fishingPose;
        const previousAvatarPosition = {
          x: simulation.avatar.x,
          y: simulation.avatar.y,
        };
        const result = advanceParkSimulation(simulation, elapsed, now, {
          objects: objectsRef.current,
          traits: currentSave.memory?.growth.traits ?? {},
          hasRod: debugRodRef.current || hasFishingRod(currentSave),
        });
        simulationRef.current = result.state;
        const distanceMoved = Math.hypot(
          result.state.avatar.x - previousAvatarPosition.x,
          result.state.avatar.y - previousAvatarPosition.y,
        );
        updateParkFootstepAudio(footstepAudioRef.current, {
          appearanceId: parkAvatarAppearance(currentSave.avatarAppearanceId),
          distancePx: distanceMoved,
          onGrass: isParkGrassPoint(
            result.state.avatar.x,
            result.state.avatar.y,
          ),
        });
        if (result.state.fishingPose !== previousFishingPose) {
          playParkFishingSound(
            fishingAudioBankRef.current,
            result.state.fishingPose,
          );
        }
        if (!debugPreviewActive && visit) {
          result.events.forEach((event) => {
            const nextSave = recordParkCatch(hostSlotId, event.fishId);
            if (nextSave) {
              saveRef.current = nextSave;
              setSave(nextSave);
            }
          });

          if (now - lastMoodAtRef.current >= 18_000) {
            lastMoodAtRef.current = now;
            const nextSave = recordParkMoodRecovery(hostSlotId, 1);
            if (nextSave) {
              saveRef.current = nextSave;
              setSave(nextSave);
            }
          }
          if (now - lastPersistAtRef.current >= 2000) {
            lastPersistAtRef.current = now;
            persistParkRuntime(hostSlotId, result.state.avatar, result.state.navMemory);
          }
          if (now - lastVisitPostAtRef.current >= PARK_SYNC_MS) {
            lastVisitPostAtRef.current = now;
            const nextVisit = normalizeVisitSession({
              ...visit,
              phase: "active",
              host: parkPresence(instanceIdRef.current, hostSlotId, visit.visitId),
              guestRuntime: result.state.avatar,
              guestRuntimeRoomInstanceId: instanceIdRef.current,
              activity: result.state.avatar.behavior,
              bubbleText: result.state.avatar.activityLabel,
              updatedAt: roomVisitNowIso(),
              expiresAt: roomVisitExpiresAt(PARK_VISIT_TTL_MS),
            });
            if (nextVisit) {
              visitRef.current = nextVisit;
              void postJson(VISIT_STATE_URL, nextVisit).catch(() => undefined);
            }
          }
        }
      } else {
        stopParkFootstepAudio(footstepAudioRef.current);
      }

      if (
        canvasRef.current
        && document.visibilityState !== "hidden"
        && now + PARK_RENDER_DEADLINE_TOLERANCE_MS >= nextRenderAt
      ) {
        nextRenderAt = now + PARK_RENDER_INTERVAL_MS;
        const canvas = canvasRef.current;
        if (canvas.dataset.parkTargetFps !== String(PARK_TARGET_FPS)) {
          canvas.dataset.parkTargetFps = String(PARK_TARGET_FPS);
        }
        const activeSimulation = simulationRef.current;
        const activeSave = saveRef.current;
        const calendarNowMs = Date.now();
        const weather = resolveParkWeather(
          weatherRuntimeRef.current!,
          calendarNowMs,
        );
        const seaAmbientGain = updateParkAmbientAudioWeather(
          ambientAudioRef.current,
          weather.rainAmount,
        );
        const weatherAudio = updateParkWeatherAudio(
          weatherAudioRef.current,
          weather,
          now,
        );
        canvas.dataset.parkWeatherAudioRain = weatherAudio.rainAmount.toFixed(3);
        canvas.dataset.parkWeatherAudioFine = weatherAudio.fineVolume.toFixed(3);
        canvas.dataset.parkWeatherAudioSurface = weatherAudio.surfaceVolume.toFixed(3);
        canvas.dataset.parkWeatherAudioDownpour = weatherAudio.downpourVolume.toFixed(3);
        canvas.dataset.parkWeatherAudioSeaGain = seaAmbientGain.toFixed(3);
        canvas.dataset.parkWeatherAudioThunderInMs = weatherAudio.nextThunderInMs === null
          ? ""
          : Math.round(weatherAudio.nextThunderInMs).toString();
        if (now - lastWeatherUiAtRef.current >= 500) {
          lastWeatherUiAtRef.current = now;
          setWeatherReadout(formatWeatherReadout(weather));
        }
        measureParkRender(canvas, now, () => {
          renderParkScene(canvas, {
            nowMs: calendarNowMs,
            fishingNowMs: now,
            frame: Math.floor(frame),
            objects: objectsRef.current,
            avatar: activeSimulation?.avatar,
            avatarAppearanceId: parkAvatarAppearance(activeSave?.avatarAppearanceId),
            petStats: activeSave?.petStats,
            memory: activeSave?.memory,
            fishingPose: activeSimulation?.fishingPose,
            fishingPoseStartedAt: activeSimulation?.activityStartedAt,
            benchPose: activeSimulation?.benchPose,
            benchPoseStartedAt: activeSimulation?.activityStartedAt,
            fishingSpot: parkFishingSpotById(activeSimulation?.fishingSpotId),
            displayedFish: activeSimulation?.pendingFish,
            renderProfile: renderProfileRef.current,
            weather,
          });
        });
      }
      animation = window.requestAnimationFrame(loop);
    };
    animation = window.requestAnimationFrame(loop);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animation);
    };
  }, [hostSlotId]);

  useEffect(() => {
    const finishVisit = () => {
      void restoreMainWindowAfterPark(false);
      const visit = visitRef.current;
      if (!visit) return;
      const ended = normalizeVisitSession({
        ...visit,
        phase: "ended",
        updatedAt: roomVisitNowIso(),
        expiresAt: roomVisitExpiresAt(30_000),
      });
      if (ended) void postJson(VISIT_END_URL, ended, true).catch(() => undefined);
    };
    window.addEventListener("pagehide", finishVisit);
    window.addEventListener("beforeunload", finishVisit);
    return () => {
      void restoreMainWindowAfterPark(false);
      window.removeEventListener("pagehide", finishVisit);
      window.removeEventListener("beforeunload", finishVisit);
    };
  }, []);

  const selectPreviewHour = (hour: number | null) => {
    const url = new URL(window.location.href);
    if (hour === null) {
      url.searchParams.delete("parkHour");
    } else {
      url.searchParams.set("parkHour", String(hour));
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setActivePreviewHour(hour);
  };

  const selectRenderProfile = (profile: ParkRenderProfile) => {
    renderProfileRef.current = profile;
    setActiveRenderProfile(profile);
    const label = PARK_RENDER_PROFILES.find((option) => option.id === profile)?.label;
    setDebugMessage(`渲染剖析：${label ?? profile}；此选择不会写入存档。`);
  };

  const selectWeatherPreview = (mode: ParkWeatherDebugMode) => {
    const nowMs = Date.now();
    setParkWeatherDebugMode(weatherRuntimeRef.current!, mode, nowMs);
    setActiveWeatherDebugMode(mode);
    const weather = resolveParkWeather(weatherRuntimeRef.current!, nowMs);
    setWeatherReadout(formatWeatherReadout(weather));
    const label = PARK_WEATHER_PREVIEWS.find((option) => option.id === mode)?.label;
    setDebugMessage(`天气预览：${label ?? mode}；此选择不会写入存档。`);
  };

  const toggleMainWindowForProfile = async () => {
    if (mainWindowProfilePendingRef.current) return;
    if (!("__TAURI_INTERNALS__" in window)) {
      setDebugMessage("隐藏主窗口对照仅在桌面版可用。");
      return;
    }
    mainWindowProfilePendingRef.current = true;
    setMainWindowProfilePending(true);
    const shouldHide = !mainWindowHiddenForProfileRef.current;
    if (shouldHide) {
      mainWindowHiddenForProfileRef.current = true;
      setMainWindowHiddenForProfile(true);
    }
    try {
      await queueMainWindowVisibility(!shouldHide);
      if (!shouldHide) {
        mainWindowHiddenForProfileRef.current = false;
        setMainWindowHiddenForProfile(false);
      }
      setDebugMessage(
        shouldHide
          ? "主窗口已真正隐藏；现在观察公园是否仍然掉帧。关闭公园前会自动恢复。"
          : "主窗口已恢复显示。",
      );
    } catch {
      if (shouldHide) {
        mainWindowHiddenForProfileRef.current = false;
        setMainWindowHiddenForProfile(false);
      }
      setDebugMessage("无法切换主窗口显示状态。");
    } finally {
      mainWindowProfilePendingRef.current = false;
      setMainWindowProfilePending(false);
    }
  };

  const summonDebugAvatar = () => {
    if (!hostSlotId) {
      setDebugMessage("当前公园窗口没有关联角色存档。");
      return;
    }
    const currentSave = readParkSaveSlot(hostSlotId) ?? saveRef.current;
    if (!currentSave) {
      setDebugMessage("未找到当前角色存档，无法召唤。");
      return;
    }
    saveRef.current = currentSave;
    setSave(currentSave);
    simulationRef.current = initialParkSimulation(
      currentSave.parkRuntime,
      currentSave.parkNavMemory,
    );
    debugPreviewRef.current = true;
    debugRodRef.current = false;
    setDebugMessage("角色已强制召唤；Debug 行为不会写入存档。");
  };

  const forceDebugFishing = () => {
    if (!hostSlotId) {
      setDebugMessage("当前公园窗口没有关联角色存档。");
      return;
    }
    const currentSave = readParkSaveSlot(hostSlotId) ?? saveRef.current;
    if (!currentSave) {
      setDebugMessage("未找到当前角色存档，无法开始钓鱼。");
      return;
    }
    saveRef.current = currentSave;
    setSave(currentSave);
    const simulation = simulationRef.current ?? initialParkSimulation(
      currentSave.parkRuntime,
      currentSave.parkNavMemory,
    );
    debugPreviewRef.current = true;
    debugRodRef.current = true;
    simulationRef.current = forceParkFishingPreview(
      simulation,
      objectsRef.current,
      performance.now(),
    );
    setDebugMessage("已临时配发钓竿，角色正在前往池边；不会修改背包。");
  };

  const forceDebugBench = (intent: "relax" | "read") => {
    if (!hostSlotId) {
      setDebugMessage("当前公园窗口没有关联角色存档。");
      return;
    }
    const currentSave = readParkSaveSlot(hostSlotId) ?? saveRef.current;
    if (!currentSave) {
      setDebugMessage("未找到当前角色存档，无法前往长椅。");
      return;
    }
    saveRef.current = currentSave;
    setSave(currentSave);
    const simulation = simulationRef.current ?? initialParkSimulation(
      currentSave.parkRuntime,
      currentSave.parkNavMemory,
    );
    debugPreviewRef.current = true;
    debugRodRef.current = false;
    simulationRef.current = forceParkBenchPreview(
      simulation,
      objectsRef.current,
      performance.now(),
      intent,
    );
    setDebugMessage(
      intent === "read"
        ? "角色正在前往山顶长椅读书；不会写入存档。"
        : "角色正在前往山顶长椅放松；不会写入存档。",
    );
  };

  const openAnimationPreview = () => {
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke("open_park_animation_preview_window", {
            request: { host_slot_id: hostSlotId },
          }),
        )
        .catch(() => {
          setDebugMessage("无法打开角色动作预览窗口。");
        });
      return;
    }

    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("view", "park-animation-preview");
    if (hostSlotId) url.searchParams.set("hostSlotId", hostSlotId);
    const preview = window.open(
      url.toString(),
      `park-animation-preview-${hostSlotId ?? "local"}`,
      "popup,width=760,height=600",
    );
    if (!preview) setDebugMessage("浏览器阻止了角色动作预览弹窗，请允许此站点打开弹窗。");
  };

  return (
    <main className="park-app" aria-label="Aivatar Hilltop Park">
      <canvas ref={canvasRef} className="park-canvas" />
      {SHOW_PARK_DEBUG ? (
        <div className="park-debug">
          {debugOpen && (
            <aside id="park-debug-panel" className="park-debug-panel" aria-label="公园 Debug">
              <div className="park-debug-title">公园 Debug</div>
              <section className="park-debug-section" aria-label="公园时间预览">
                <span className="park-debug-label">时间预览</span>
                <div className="park-debug-buttons">
                  {PARK_PREVIEW_TIMES.map((option) => {
                    const isActive = option.hour === activePreviewHour;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        className={isActive ? "active" : undefined}
                        aria-pressed={isActive}
                        onClick={() => selectPreviewHour(option.hour)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="park-debug-section" aria-label="公园天气预览">
                <span className="park-debug-label">天气预览</span>
                <div className="park-debug-buttons">
                  {PARK_WEATHER_PREVIEWS.map((option) => {
                    const isActive = option.id === activeWeatherDebugMode;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={isActive ? "active" : undefined}
                        aria-pressed={isActive}
                        onClick={() => selectWeatherPreview(option.id)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="park-debug-message" aria-live="polite">
                  {weatherReadout}
                </p>
              </section>
              <section className="park-debug-section" aria-label="公园渲染剖析">
                <span className="park-debug-label">渲染剖析</span>
                <div className="park-debug-buttons">
                  {PARK_RENDER_PROFILES.map((option) => {
                    const isActive = option.id === activeRenderProfile;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={isActive ? "active" : undefined}
                        aria-pressed={isActive}
                        onClick={() => selectRenderProfile(option.id)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className={mainWindowHiddenForProfile ? "active" : undefined}
                    aria-pressed={mainWindowHiddenForProfile}
                    aria-busy={mainWindowProfilePending}
                    disabled={mainWindowProfilePending}
                    onClick={() => void toggleMainWindowForProfile()}
                  >
                    {mainWindowHiddenForProfile ? "恢复主窗口" : "隐藏主窗口（A/B）"}
                  </button>
                </div>
              </section>
              <section className="park-debug-section" aria-label="公园角色预览">
                <span className="park-debug-label">角色预览</span>
                <div className="park-debug-buttons">
                  <button type="button" onClick={summonDebugAvatar}>
                    强制召唤角色
                  </button>
                  <button type="button" onClick={forceDebugFishing}>
                    强制钓鱼（临时钓竿）
                  </button>
                  <button type="button" onClick={() => forceDebugBench("relax")}>
                    强制长椅放松
                  </button>
                  <button type="button" onClick={() => forceDebugBench("read")}>
                    强制长椅读书
                  </button>
                  <button type="button" onClick={openAnimationPreview}>
                    打开角色动作预览
                  </button>
                </div>
              </section>
              {debugMessage && <p className="park-debug-message" role="status">{debugMessage}</p>}
            </aside>
          )}
          <button
            type="button"
            className="park-debug-toggle"
            aria-expanded={debugOpen}
            aria-controls="park-debug-panel"
            onClick={() => setDebugOpen((open) => !open)}
          >
            DEBUG
          </button>
        </div>
      ) : null}
    </main>
  );
};
