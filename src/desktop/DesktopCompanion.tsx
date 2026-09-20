import { useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { t, type Locale } from "../i18n";
import { isStoreClosing } from "../persistence/saveStore";
import { deriveBehaviorFromCodex } from "../game/simulation";
import { renderDesktopScene } from "../game/renderScene";
import type { AivatarContent, AivatarMemory, AvatarAppearanceId, CodexStatusMessage } from "../types";
import {
  createDesktopRuntime, DESKTOP_PIXEL_SCALE, desktopLayoutFromRuntime,
  desktopObjectAtPoint, desktopObjectBounds, moveDesktopObject,
  normalizeDesktopLayout, tickDesktopRuntime,
} from "./desktopRuntime";
import type { DesktopDragTarget, DesktopHitRegion, DesktopLayout, DesktopPoint, DesktopViewport } from "./desktopTypes";
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

interface DragState { target: DesktopDragTarget; pointerId: number; offset: DesktopPoint }

export function DesktopCompanion(props: DesktopCompanionProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewportRef = useRef(props.viewport);
  const runtimeRef = useRef(createDesktopRuntime(normalizeDesktopLayout(props.initialLayout, props.viewport)));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const aliveRef = useRef(false);
  const returningRef = useRef(false);
  const typingRef = useRef(false);
  const renderFailedRef = useRef(false);
  const pendingHitRef = useRef<{ regions: DesktopHitRegion[]; dragging: boolean } | null>(null);
  const hitRunningRef = useRef(false);
  const hitPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const [menu, setMenu] = useState<DesktopPoint | null>(null);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState("");

  const captureLayout = () => desktopLayoutFromRuntime(runtimeRef.current, viewportRef.current);
  const checkpoint = () => {
    if (!isStoreClosing()) propsRef.current.onLayoutChange(captureLayout());
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
    pendingHitRef.current = { regions, dragging: dragRef.current !== null };
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

  const returnToRoom = async () => {
    if (returningRef.current || isStoreClosing()) return;
    returningRef.current = true;
    dragRef.current = null;
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
    if (previous.width !== next.width || previous.height !== next.height || previous.monitorId !== next.monitorId) {
      const layout = normalizeDesktopLayout(desktopLayoutFromRuntime(runtimeRef.current, previous), next);
      runtimeRef.current = createDesktopRuntime(layout);
      dragRef.current = null;
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
        if (!dragRef.current && !menuRef.current) {
          runtimeRef.current = tickDesktopRuntime(runtimeRef.current,
            deriveBehaviorFromCodex(current.status), viewportRef.current, elapsed, now);
        }
        const avatar = runtimeRef.current.avatar;
        setTyping(!dragRef.current && (avatar.behavior === "coding" || avatar.behavior === "thinking") && !avatar.actionIntent);
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
      if (event.key === "Escape") { event.preventDefault(); void returnRef.current(); }
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

  useLayoutEffect(updateHitRegions, [menu, returning, error]);

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || returningRef.current || isStoreClosing()) return;
    setMenu(null);
    const point = { x: event.clientX, y: event.clientY };
    const target = desktopObjectAtPoint(runtimeRef.current, point);
    if (!target) return;
    event.preventDefault();
    const object = target === "avatar" ? runtimeRef.current.avatar : runtimeRef.current.computer;
    dragRef.current = { target, pointerId: event.pointerId, offset: { x: point.x - object.x, y: point.y - object.y } };
    event.currentTarget.setPointerCapture(event.pointerId);
    runtimeRef.current = moveDesktopObject(runtimeRef.current, target, object, viewportRef.current, performance.now());
    setTyping(false);
    updateHitRegions();
  };
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
          if (returningRef.current || isStoreClosing() || desktopObjectAtPoint(runtimeRef.current,
            { x: event.clientX, y: event.clientY }) !== "avatar") return;
          dragRef.current = null;
          setMenu({
            x: Math.max(8, Math.min(viewportRef.current.width - 228, event.clientX)),
            y: Math.max(8, Math.min(viewportRef.current.height - 156, event.clientY)),
          });
        }} />
      {menu && <div ref={menuRef} className="desktop-companion-menu" role="menu"
        style={{ left: menu.x, top: menu.y }}>
        <button type="button" role="menuitem" disabled={returning} onClick={() => void returnToRoom()}>
          {t(props.locale, returning ? "desktop.returning" : "desktop.return")}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>}
    </div>
  );
}

export default DesktopCompanion;
