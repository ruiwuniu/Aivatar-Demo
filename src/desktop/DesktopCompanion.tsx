import { useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { t, type Locale } from "../i18n";
import { isStoreClosing } from "../persistence/saveStore";
import { deriveBehaviorFromCodex } from "../game/simulation";
import { renderDesktopScene } from "../game/renderScene";
import type { AivatarContent, AivatarMemory, AvatarAppearanceId, CodexStatusMessage } from "../types";
import {
  createDesktopRuntime, DESKTOP_PIXEL_SCALE, desktopLayoutFromRuntime,
  desktopObjectAtPoint, desktopObjectBounds, moveDesktopObject,
  normalizeDesktopLayout, tickDesktopRuntime, applyDesktopActivityArea,
  resizeDesktopActivityArea, DESKTOP_MIN_ACTIVITY_SIZE,
} from "./desktopRuntime";
import type { DesktopActivityArea, DesktopAreaHandle, DesktopDragTarget, DesktopHitRegion, DesktopLayout, DesktopPoint, DesktopViewport } from "./desktopTypes";
import { startDesktopAnimation } from "./desktopAnimation";
import "./desktop.css";

export interface DesktopCompanionProps {
  content: AivatarContent;
  status: CodexStatusMessage;
  memory?: AivatarMemory;
  appearanceId: AvatarAppearanceId;
  viewport: DesktopViewport;
  initialLayout: DesktopLayout | null;
  onLayoutChange: (layout: DesktopLayout) => void;
  onReturn: () => Promise<void>;
  onTypingChange?: (active: boolean) => void;
  captureLayoutRef?: MutableRefObject<(() => DesktopLayout) | null>;
  locale: Locale;
}

interface DragState { target: DesktopDragTarget; pointerId: number; offset: DesktopPoint; element: HTMLElement }
interface AreaEdit { committed: DesktopLayout; draft: DesktopActivityArea }
interface AreaDrag { handle: DesktopAreaHandle; pointerId: number; origin: DesktopPoint; area: DesktopActivityArea; element: HTMLElement }
const AREA_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export function DesktopCompanion(props: DesktopCompanionProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewportRef = useRef(props.viewport);
  const runtimeRef = useRef(createDesktopRuntime(normalizeDesktopLayout(props.initialLayout, props.viewport)));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const areaEditorRef = useRef<HTMLDivElement>(null);
  const areaEditRef = useRef<AreaEdit | null>(null);
  const areaDragRef = useRef<AreaDrag | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const aliveRef = useRef(false);
  const returningRef = useRef(false);
  const typingRef = useRef(false);
  const renderFailedRef = useRef(false);
  const pendingHitRef = useRef<{ regions: DesktopHitRegion[]; dragging: boolean } | null>(null);
  const hitRunningRef = useRef(false);
  const hitPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const [menu, setMenu] = useState<(DesktopPoint & { target?: DesktopDragTarget }) | null>(null);
  const [areaDraft, setAreaDraft] = useState<DesktopActivityArea | null>(null);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState("");

  // Unconfirmed edits must never escape through close-save or native recovery.
  const captureLayout = () => areaEditRef.current?.committed
    ?? desktopLayoutFromRuntime(runtimeRef.current, viewportRef.current);
  const checkpoint = () => {
    if (!areaEditRef.current && !isStoreClosing()) propsRef.current.onLayoutChange(captureLayout());
  };
  const setTyping = (active: boolean) => {
    if (typingRef.current === active) return;
    typingRef.current = active;
    propsRef.current.onTypingChange?.(active);
  };

  // Coalesce requests while one native invocation is in flight. Return waits
  // for this chain before restoring the window, so no old hit regions can
  // re-enable desktop click-through after the room has reappeared.
  const updateHitRegions = () => {
    if (!aliveRef.current || returningRef.current || !isTauri()) return;
    const regions = [desktopObjectBounds(runtimeRef.current, "computer"), desktopObjectBounds(runtimeRef.current, "avatar")];
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      regions.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    areaEditorRef.current?.querySelectorAll<HTMLElement>("[data-desktop-area-hit]").forEach((element) => {
      const rect = element.getBoundingClientRect();
      regions.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    });
    pendingHitRef.current = { regions, dragging: dragRef.current !== null || areaDragRef.current !== null };
    if (hitRunningRef.current) return;
    hitRunningRef.current = true;
    hitPromiseRef.current = (async () => {
      try {
        while (pendingHitRef.current && aliveRef.current && !returningRef.current) {
          const payload = pendingHitRef.current;
          pendingHitRef.current = null;
          try { await invoke("update_desktop_hit_regions", payload); }
          catch { /* The native watchdog restores the room if its heartbeat is lost. */ }
        }
      } finally { hitRunningRef.current = false; }
    })();
  };

  const releaseGesture = () => {
    const gestures = [dragRef.current, areaDragRef.current];
    dragRef.current = null;
    areaDragRef.current = null;
    for (const gesture of gestures) {
      if (gesture?.element.hasPointerCapture(gesture.pointerId)) {
        gesture.element.releasePointerCapture(gesture.pointerId);
      }
    }
  };
  const cancelAreaEdit = () => {
    releaseGesture();
    areaEditRef.current = null;
    setAreaDraft(null);
    canvasRef.current?.focus({ preventScroll: true });
  };
  const beginAreaEdit = () => {
    if (returningRef.current || isStoreClosing() || renderFailedRef.current) return;
    releaseGesture();
    const committed = captureLayout();
    const draft = { ...runtimeRef.current.activityArea };
    areaEditRef.current = { committed, draft };
    setAreaDraft(draft);
    setMenu(null);
    setTyping(false);
  };
  const finishAreaEdit = () => {
    const edit = areaEditRef.current;
    if (!edit || returningRef.current || isStoreClosing()) return;
    releaseGesture();
    runtimeRef.current = applyDesktopActivityArea(runtimeRef.current, edit.draft, viewportRef.current, performance.now());
    areaEditRef.current = null;
    setAreaDraft(null);
    checkpoint();
    canvasRef.current?.focus({ preventScroll: true });
  };

  const returnToRoom = async () => {
    if (returningRef.current || isStoreClosing()) return;
    returningRef.current = true;
    cancelAreaEdit();
    pendingHitRef.current = null;
    setReturning(true);
    setTyping(false);
    setError("");
    try {
      checkpoint();
      await hitPromiseRef.current;
      await propsRef.current.onReturn();
    }
    catch (reason) {
      if (!aliveRef.current) return;
      returningRef.current = false;
      setReturning(false);
      setError(`${t(propsRef.current.locale, "desktop.failure")} ${String(reason)}`);
      setMenu((current) => current ?? {
        x: Math.max(8, Math.min(viewportRef.current.width - 228, runtimeRef.current.avatar.x)),
        y: Math.max(8, Math.min(viewportRef.current.height - 156, runtimeRef.current.avatar.y)),
      });
      updateHitRegions();
    }
  };
  const returnRef = useRef(returnToRoom);
  returnRef.current = returnToRoom;

  useLayoutEffect(() => {
    document.documentElement.classList.add("aivatar-desktop-mode");
    document.body.classList.add("aivatar-desktop-mode");
    aliveRef.current = true;
    returningRef.current = false;
    if (props.captureLayoutRef) props.captureLayoutRef.current = captureLayout;
    return () => {
      aliveRef.current = false;
      releaseGesture();
      pendingHitRef.current = null;
      if (props.captureLayoutRef) props.captureLayoutRef.current = null;
      document.documentElement.classList.remove("aivatar-desktop-mode");
      document.body.classList.remove("aivatar-desktop-mode");
      propsRef.current.onTypingChange?.(false);
    };
  }, []);

  useLayoutEffect(() => {
    const previous = viewportRef.current;
    const next = props.viewport;
    if (previous.width !== next.width || previous.height !== next.height
      || previous.monitorId !== next.monitorId || previous.scaleFactor !== next.scaleFactor) {
      const layout = normalizeDesktopLayout(desktopLayoutFromRuntime(runtimeRef.current, previous), next);
      runtimeRef.current = createDesktopRuntime(layout);
      cancelAreaEdit();
      setMenu(null);
    }
    viewportRef.current = next;
  }, [props.viewport]);

  useLayoutEffect(() => {
    let frame = 0;
    let renderedAt = performance.now();
    renderFailedRef.current = false;
    const pump = (now: number, elapsed: number, initial: boolean) => {
      if (!aliveRef.current || renderFailedRef.current) return;
      const current = propsRef.current;
      if (isStoreClosing()) {
        setTyping(false);
      } else if (!returningRef.current) {
        if (!dragRef.current && !menuRef.current && !areaEditRef.current) {
          runtimeRef.current = tickDesktopRuntime(runtimeRef.current,
            deriveBehaviorFromCodex(current.status), viewportRef.current, elapsed, now);
        }
        const avatar = runtimeRef.current.avatar;
        setTyping(!dragRef.current && !areaEditRef.current && (avatar.behavior === "coding" || avatar.behavior === "thinking") && !avatar.actionIntent);
        if (canvasRef.current && (initial || now - renderedAt >= 1000 / 30 - 0.5)) {
          frame += (now - renderedAt) / (1000 / 60);
          renderedAt = now;
          renderDesktopScene(canvasRef.current, {
            ...viewportRef.current, pixelScale: DESKTOP_PIXEL_SCALE,
            avatar, computer: runtimeRef.current.computer, content: current.content,
            status: current.status, frame: Math.floor(frame), memory: current.memory,
            appearanceId: current.appearanceId,
          });
        }
      }
    };
    const stopAnimation = startDesktopAnimation({
      now: () => performance.now(),
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
      setTimer: (callback, intervalMs) => window.setInterval(callback, intervalMs),
      clearTimer: (id) => window.clearInterval(id),
    }, pump, (reason) => {
      if (!aliveRef.current || renderFailedRef.current) return;
      renderFailedRef.current = true;
      setTyping(false);
      const message = `Desktop renderer: ${String(reason)}`;
      if (canvasRef.current) canvasRef.current.dataset.desktopRenderError = message;
      window.dispatchEvent(new ErrorEvent("error", { message, error: reason }));
      setError(`${t(propsRef.current.locale, "desktop.failure")} ${String(reason)}`);
      setMenu({ x: 16, y: 16 });
    });
    // Native heartbeats run independently of rAF, including when the window
    // is unfocused. The watchdog requires an update at least once a second.
    const hitTimer = window.setInterval(updateHitRegions, 100);
    const saveTimer = window.setInterval(() => {
      if (aliveRef.current && !returningRef.current && !dragRef.current) checkpoint();
    }, 15000);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (areaEditRef.current) cancelAreaEdit();
        else void returnRef.current();
      }
    };
    document.addEventListener("keydown", keyDown);
    updateHitRegions();
    return () => {
      stopAnimation();
      window.clearInterval(hitTimer);
      window.clearInterval(saveTimer);
      document.removeEventListener("keydown", keyDown);
    };
  }, []);

  useLayoutEffect(updateHitRegions, [menu, returning, error, areaDraft]);
  useLayoutEffect(() => {
    if (menu) menuRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [menu]);
  useLayoutEffect(() => {
    if (areaDraft) areaEditorRef.current?.querySelector<HTMLElement>("[data-area-move]")?.focus({ preventScroll: true });
  }, [areaDraft !== null]);

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || returningRef.current || areaEditRef.current || isStoreClosing()) return;
    setMenu(null);
    const point = { x: event.clientX, y: event.clientY };
    const target = desktopObjectAtPoint(runtimeRef.current, point);
    if (!target) return;
    event.preventDefault();
    const object = target === "avatar" ? runtimeRef.current.avatar : runtimeRef.current.computer;
    dragRef.current = { target, pointerId: event.pointerId, offset: { x: point.x - object.x, y: point.y - object.y }, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    runtimeRef.current = moveDesktopObject(runtimeRef.current, target, object, viewportRef.current, performance.now());
    setTyping(false);
    updateHitRegions();
  };

  const areaPointerDown = (event: ReactPointerEvent<HTMLElement>, handle: DesktopAreaHandle) => {
    const edit = areaEditRef.current;
    if (!edit || event.button !== 0 || returningRef.current || isStoreClosing()) return;
    event.preventDefault();
    areaDragRef.current = { handle, pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY }, area: { ...edit.draft }, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHitRegions();
  };
  const areaPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = areaDragRef.current;
    const edit = areaEditRef.current;
    if (!edit || !drag || event.pointerId !== drag.pointerId || isStoreClosing()) return;
    edit.draft = resizeDesktopActivityArea(drag.area, drag.handle,
      { x: event.clientX - drag.origin.x, y: event.clientY - drag.origin.y }, viewportRef.current);
    setAreaDraft(edit.draft);
  };
  const endAreaDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = areaDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.type === "pointercancel" && areaEditRef.current) {
      areaEditRef.current.draft = drag.area;
      setAreaDraft(drag.area);
    }
    releaseGesture();
    updateHitRegions();
  };
  const areaKeyDown = (event: ReactKeyboardEvent<HTMLElement>, handle: DesktopAreaHandle) => {
    const edit = areaEditRef.current;
    if (!edit || isStoreClosing()) return;
    const step = event.shiftKey ? 20 : 4;
    const delta = { x: event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
      y: event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0 };
    if (!delta.x && !delta.y) return;
    event.preventDefault();
    edit.draft = resizeDesktopActivityArea(edit.draft, handle, delta, viewportRef.current);
    setAreaDraft(edit.draft);
  };
  const areaEvents = (handle: DesktopAreaHandle) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => areaPointerDown(event, handle),
    onPointerMove: areaPointerMove, onPointerUp: endAreaDrag,
    onPointerCancel: endAreaDrag, onLostPointerCapture: endAreaDrag,
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => areaKeyDown(event, handle),
  });
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || returningRef.current || isStoreClosing()) return;
    runtimeRef.current = moveDesktopObject(runtimeRef.current, drag.target,
      { x: event.clientX - drag.offset.x, y: event.clientY - drag.offset.y },
      viewportRef.current, performance.now());
    event.currentTarget.style.cursor = "grabbing";
    updateHitRegions();
  };
  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (!isStoreClosing()) {
      const position = drag.target === "avatar" ? runtimeRef.current.avatar : runtimeRef.current.computer;
      runtimeRef.current = moveDesktopObject(runtimeRef.current, drag.target, position,
        viewportRef.current, performance.now());
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grab";
    checkpoint();
    updateHitRegions();
  };

  return (
    <div className="desktop-companion" aria-label={t(props.locale, "desktop.title")}>
      <canvas ref={canvasRef} className="desktop-companion-canvas" tabIndex={0}
        aria-label={t(props.locale, "desktop.hint")}
        onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onContextMenu={(event) => {
          event.preventDefault();
          const target = desktopObjectAtPoint(runtimeRef.current, { x: event.clientX, y: event.clientY });
          if (returningRef.current || areaEditRef.current || isStoreClosing() || !target) return;
          releaseGesture();
          setMenu({
            target,
            x: Math.max(8, Math.min(viewportRef.current.width - 228, event.clientX)),
            y: Math.max(8, Math.min(viewportRef.current.height - 156, event.clientY)),
          });
        }} />
      {menu && <div ref={menuRef} className="desktop-companion-menu" role="menu"
        style={{ left: menu.x, top: menu.y }}>
        {menu.target === "computer" && <button type="button" role="menuitem" disabled={returning || renderFailedRef.current} onClick={beginAreaEdit}>
          {t(props.locale, "desktop.area.adjust")}
        </button>}
        <button type="button" role="menuitem" disabled={returning} onClick={() => void returnToRoom()}>
          {t(props.locale, returning ? "desktop.returning" : "desktop.return")}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>}
      {areaDraft && <div ref={areaEditorRef} className="desktop-area-editor" aria-label={t(props.locale, "desktop.area.adjust")}>
        <div className="desktop-activity-area" style={{ left: areaDraft.x, top: areaDraft.y, width: areaDraft.width, height: areaDraft.height }}>
          {(["n", "e", "s", "w"] as const).map((edge) => <div key={edge} data-desktop-area-hit
            className={`desktop-area-edge desktop-area-edge-${edge}`} {...areaEvents(edge)} />)}
          {AREA_HANDLES.map((handle) => <button key={handle} type="button" data-desktop-area-hit
            className={`desktop-area-handle desktop-area-handle-${handle}`}
            aria-label={t(props.locale, `desktop.area.${handle}`)} {...areaEvents(handle)} />)}
        </div>
        <div className="desktop-area-toolbar" data-desktop-area-hit style={{
          left: Math.max(8, Math.min(areaDraft.x + 24, props.viewport.width - Math.min(440, props.viewport.width - 16) - 8)),
          top: Math.max(8, Math.min(areaDraft.y + 24, props.viewport.height - 160)),
          width: Math.min(440, props.viewport.width - 16),
        }}>
          <button type="button" data-area-move className="desktop-area-move" {...areaEvents("move")}>
            <span aria-hidden="true">⠿</span> {t(props.locale, "desktop.area.move")}
            <strong>{Math.round(areaDraft.width)} × {Math.round(areaDraft.height)}</strong>
          </button>
          <p>{t(props.locale, "desktop.area.hint", { width: Math.min(DESKTOP_MIN_ACTIVITY_SIZE.width, props.viewport.width), height: Math.min(DESKTOP_MIN_ACTIVITY_SIZE.height, props.viewport.height) })}</p>
          <div className="desktop-area-actions">
            <button type="button" onClick={cancelAreaEdit}>{t(props.locale, "desktop.area.cancel")}</button>
            <button type="button" className="desktop-area-done" onClick={finishAreaEdit}>{t(props.locale, "desktop.area.done")}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

export default DesktopCompanion;
