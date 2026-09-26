import { useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { t, type Locale } from "../i18n";
import { isStoreClosing } from "../persistence/saveStore";
import { deriveBehaviorFromCodex } from "../game/simulation";
import { renderDesktopScene } from "../game/renderScene";
import type { AivatarContent, AivatarMemory, AvatarAppearanceId, CodexStatusMessage, PetStats } from "../types";
import {
  createDesktopRuntime, DESKTOP_PIXEL_SCALE, desktopLayoutFromRuntime,
  desktopObjectAtPoint, desktopObjectBounds, moveDesktopObject,
  normalizeDesktopLayout, tickDesktopRuntime, applyDesktopActivityArea, canApplyDesktopActivityArea,
  resizeDesktopActivityArea, DESKTOP_MIN_ACTIVITY_SIZE,
  beginDesktopVendingInteraction, cancelDesktopVendingInteraction,
  takeDesktopVendingPurchaseRequest, settleDesktopVendingPurchase,
  placeDesktopVendingMachine, removeDesktopVendingMachine, isDesktopFurniturePlacementValid,
  setDesktopVendingSkin,
} from "./desktopRuntime";
import type { DesktopActivityArea, DesktopAreaHandle, DesktopDragTarget, DesktopHitRegion, DesktopLayout, DesktopPoint, DesktopViewport, DesktopVendingProductId, DesktopVendingSkinId } from "./desktopTypes";
import { DESKTOP_VENDING_SKIN_IDS } from "./desktopVendingMachine";
import type { DesktopVendingPurchaseRequest, DesktopVendingPurchaseReceipt, VendingProductOffer, VendingSoundCue } from "./desktopVendingTransactions";
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
  vendingProducts?: VendingProductOffer[];
  walletBits?: number;
  petStats?: PetStats;
  onPurchaseAndConsume?: (request: DesktopVendingPurchaseRequest) => DesktopVendingPurchaseReceipt;
  onVendingSound?: (cue: VendingSoundCue) => void;
  locale: Locale;
}

interface DragState { target: DesktopDragTarget; pointerId: number; offset: DesktopPoint; element: HTMLElement }
interface AreaEdit { committed: DesktopLayout; draft: DesktopActivityArea }
interface AreaDrag { handle: DesktopAreaHandle; pointerId: number; origin: DesktopPoint; area: DesktopActivityArea; element: HTMLElement }
const AREA_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const VENDING_COOLDOWN_MS = 3 * 60_000;

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
  const [vendingPhase, setVendingPhase] = useState("");
  const [, refreshVendingSkin] = useState(0);
  const [notice, setNotice] = useState("");
  const noticeUntilRef = useRef(0);
  const phaseKeyRef = useRef("");
  const invalidPlacementRef = useRef<DesktopHitRegion | undefined>();
  const autoVendingAfterRef = useRef(performance.now() + 30_000);

  const vendingSound = (cue: VendingSoundCue) => {
    try { propsRef.current.onVendingSound?.(cue); } catch { /* Audio never changes an order. */ }
  };
  const showNotice = (key: string) => {
    setNotice(t(propsRef.current.locale, key));
    noticeUntilRef.current = performance.now() + 4500;
  };
  const cancelVending = () => {
    if (!runtimeRef.current.vendingInteraction) return;
    runtimeRef.current = cancelDesktopVendingInteraction(runtimeRef.current, performance.now());
    phaseKeyRef.current = "";
    setVendingPhase("");
    vendingSound("stop");
  };
  const startVending = (productId: DesktopVendingProductId) => {
    if (returningRef.current || areaEditRef.current || isStoreClosing() || renderFailedRef.current) return;
    if (deriveBehaviorFromCodex(propsRef.current.status)) {
      showNotice("desktop.vending.busy");
      return;
    }
    const offer = propsRef.current.vendingProducts?.find((item) => item.id === productId);
    if (!offer?.available || !propsRef.current.onPurchaseAndConsume) {
      showNotice("desktop.vending.unavailable");
      return;
    }
    if ((propsRef.current.walletBits ?? 0) < offer.price) {
      autoVendingAfterRef.current = performance.now() + VENDING_COOLDOWN_MS;
      showNotice("desktop.vending.insufficient-funds");
      return;
    }
    const now = performance.now();
    autoVendingAfterRef.current = now + VENDING_COOLDOWN_MS;
    cancelVending();
    runtimeRef.current = beginDesktopVendingInteraction(runtimeRef.current, productId, crypto.randomUUID(), viewportRef.current, now);
    if (!runtimeRef.current.vendingInteraction) showNotice("desktop.vending.noSpace");
    setMenu(null);
  };
  const updateVendingPhase = () => {
    const interaction = runtimeRef.current.vendingInteraction;
    const key = interaction ? `${interaction.requestId}:${interaction.phase}` : "";
    if (key === phaseKeyRef.current) return;
    phaseKeyRef.current = key;
    setVendingPhase(interaction?.phase ?? "");
    if (interaction?.phase === "press") vendingSound("press");
    else if (interaction?.phase === "dispense") vendingSound("dispense");
    else if (interaction?.phase === "consume") {
      vendingSound("pickup");
      vendingSound(`consume_${interaction.productId}`);
    } else if (!interaction) vendingSound("stop");
  };

  // Unconfirmed edits must never escape through close-save or native recovery.
  const captureLayout = () => areaEditRef.current?.committed
    ?? desktopLayoutFromRuntime(runtimeRef.current, viewportRef.current);
  const checkpoint = () => {
    if (!areaEditRef.current && !isStoreClosing()) propsRef.current.onLayoutChange(captureLayout());
  };
  const selectVendingSkin = (skinId: DesktopVendingSkinId) => {
    if (returningRef.current || areaEditRef.current || isStoreClosing() || renderFailedRef.current
      || !runtimeRef.current.vendingMachine || runtimeRef.current.vendingMachineSkinId === skinId) return;
    runtimeRef.current = setDesktopVendingSkin(runtimeRef.current, skinId);
    // Keep the menu and focused option in place while updating its selection.
    refreshVendingSkin((version) => version + 1);
    checkpoint();
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
    if (runtimeRef.current.vendingMachine) regions.push(desktopObjectBounds(runtimeRef.current, "vendingMachine"));
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
    invalidPlacementRef.current = undefined;
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
    cancelVending();
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
    if (!canApplyDesktopActivityArea(runtimeRef.current, edit.draft, viewportRef.current)) {
      showNotice("desktop.vending.noSpace");
      return;
    }
    runtimeRef.current = applyDesktopActivityArea(runtimeRef.current, edit.draft, viewportRef.current, performance.now());
    areaEditRef.current = null;
    setAreaDraft(null);
    checkpoint();
    canvasRef.current?.focus({ preventScroll: true });
  };

  const returnToRoom = async () => {
    if (returningRef.current || isStoreClosing()) return;
    returningRef.current = true;
    cancelVending();
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
      vendingSound("stop");
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
      phaseKeyRef.current = "";
      setVendingPhase("");
      vendingSound("stop");
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
      const taskBehavior = deriveBehaviorFromCodex(current.status);
      if (noticeUntilRef.current && now >= noticeUntilRef.current) {
        noticeUntilRef.current = 0;
        setNotice("");
      }
      if (isStoreClosing()) {
        cancelVending();
        setTyping(false);
      } else if (!returningRef.current) {
        if (taskBehavior) cancelVending();
        if (!dragRef.current && !areaEditRef.current && (!menuRef.current || taskBehavior)) {
          if (!taskBehavior && runtimeRef.current.vendingMachine && !runtimeRef.current.vendingInteraction
            && now >= runtimeRef.current.dragPauseUntil && now >= autoVendingAfterRef.current
            && current.onPurchaseAndConsume) {
            const stats = current.petStats ?? current.content.petStats;
            const candidates: DesktopVendingProductId[] = [];
            if (stats.hunger < 35) candidates.push("cookie");
            if (stats.energy < 30) candidates.push("coffee");
            if (stats.mood < 30) candidates.push("cola");
            const product = candidates.find((id) => current.vendingProducts?.some((offer) =>
              offer.id === id && offer.available && offer.price <= (current.walletBits ?? 0)));
            if (product) startVending(product);
            else if (candidates.length) autoVendingAfterRef.current = now + VENDING_COOLDOWN_MS;
          }
          runtimeRef.current = tickDesktopRuntime(runtimeRef.current,
            taskBehavior, viewportRef.current, elapsed, now);
          updateVendingPhase();
          const purchase = takeDesktopVendingPurchaseRequest(runtimeRef.current);
          // Mark the request taken before invoking App. The synchronous receipt
          // is the only boundary after which dispensing may begin.
          runtimeRef.current = purchase.runtime;
          if (purchase.request) {
            let receipt: DesktopVendingPurchaseReceipt | undefined;
            try { receipt = current.onPurchaseAndConsume?.(purchase.request); } catch { /* Show failure below. */ }
            const accepted = receipt?.ok === true && receipt.requestId === purchase.request.requestId
              && receipt.productId === purchase.request.productId;
            runtimeRef.current = settleDesktopVendingPurchase(runtimeRef.current, purchase.request.requestId, accepted, now);
            if (!accepted) showNotice(receipt?.reason === "insufficient-funds"
              ? "desktop.vending.insufficient-funds" : receipt?.reason === "busy"
                ? "desktop.vending.busy" : "desktop.vending.failed");
            updateVendingPhase();
          }
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
            vendingMachine: runtimeRef.current.vendingMachine,
            vendingMachineSkinId: runtimeRef.current.vendingMachineSkinId,
            vendingInteraction: runtimeRef.current.vendingInteraction,
            invalidPlacement: invalidPlacementRef.current, nowMs: now,
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
      cancelVending();
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
        else if (menuRef.current) setMenu(null);
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
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, props.viewport.width - rect.width - 8));
    const y = Math.max(8, Math.min(menu.y, props.viewport.height - rect.height - 8));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
  }, [menu, props.viewport, props.vendingProducts]);
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
    cancelVending();
    const object = target === "avatar" ? runtimeRef.current.avatar
      : target === "vendingMachine" ? runtimeRef.current.vendingMachine : runtimeRef.current.computer;
    if (!object) return;
    dragRef.current = { target, pointerId: event.pointerId, offset: { x: point.x - object.x, y: point.y - object.y },
      element: event.currentTarget };
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
    const point = { x: event.clientX - drag.offset.x, y: event.clientY - drag.offset.y };
    const invalid = drag.target !== "avatar" && !isDesktopFurniturePlacementValid(
      runtimeRef.current, drag.target, point, viewportRef.current);
    invalidPlacementRef.current = invalid
      ? desktopObjectBounds({ ...runtimeRef.current, [drag.target]: point }, drag.target)
      : undefined;
    runtimeRef.current = moveDesktopObject(runtimeRef.current, drag.target, point,
      viewportRef.current, performance.now());
    event.currentTarget.style.cursor = invalid ? "not-allowed" : "grabbing";
    updateHitRegions();
  };
  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (!isStoreClosing()) {
      const position = drag.target === "avatar" ? runtimeRef.current.avatar
        : drag.target === "vendingMachine" ? runtimeRef.current.vendingMachine : runtimeRef.current.computer;
      if (position) runtimeRef.current = moveDesktopObject(runtimeRef.current, drag.target, position,
          viewportRef.current, performance.now());
    }
    if (invalidPlacementRef.current) showNotice("desktop.vending.overlap");
    invalidPlacementRef.current = undefined;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grab";
    checkpoint();
    updateHitRegions();
  };
  const toggleVending = () => {
    if (returningRef.current || isStoreClosing() || renderFailedRef.current) return;
    cancelVending();
    if (runtimeRef.current.vendingMachine || runtimeRef.current.vendingMachineParked) {
      runtimeRef.current = removeDesktopVendingMachine(runtimeRef.current, performance.now());
      showNotice("desktop.vending.packed");
    } else {
      const placed = placeDesktopVendingMachine(runtimeRef.current, viewportRef.current, performance.now());
      runtimeRef.current = placed.runtime;
      showNotice(placed.ok ? "desktop.vending.placed" : "desktop.vending.noSpace");
    }
    setMenu(null);
    checkpoint();
    updateHitRegions();
  };

  return (
    <div className="desktop-companion" aria-label={t(props.locale, "desktop.title")}
      data-vending-phase={vendingPhase}>
      <canvas ref={canvasRef} className="desktop-companion-canvas" tabIndex={0}
        aria-label={t(props.locale, "desktop.hint")}
        onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
        onContextMenu={(event) => {
          event.preventDefault();
          const target = desktopObjectAtPoint(runtimeRef.current, { x: event.clientX, y: event.clientY });
          if (returningRef.current || areaEditRef.current || isStoreClosing() || !target) return;
          releaseGesture();
          cancelVending();
          setMenu({
            target,
            x: Math.max(8, Math.min(viewportRef.current.width - 228, event.clientX)),
            y: Math.max(8, Math.min(viewportRef.current.height - 156, event.clientY)),
          });
        }} />
      {menu && <div ref={menuRef} className="desktop-companion-menu" role="menu"
        style={{ left: menu.x, top: menu.y }}>
        {menu.target === "vendingMachine" && <>
          <div className="desktop-vending-menu-heading">
            <strong>{t(props.locale, "desktop.vending.title")}</strong>
            <span>{t(props.locale, "desktop.vending.balance", { bits: props.walletBits ?? 0 })}</span>
          </div>
          {(props.vendingProducts ?? []).map((product) => <button type="button" role="menuitem" key={product.id}
            className="desktop-vending-product" data-vending-product={product.id}
            disabled={returning || !product.available || (props.walletBits ?? 0) < product.price || Boolean(deriveBehaviorFromCodex(props.status))}
            title={!product.available ? t(props.locale, "desktop.vending.unavailable")
              : (props.walletBits ?? 0) < product.price ? t(props.locale, "desktop.vending.insufficient-funds") : undefined}
            onClick={() => startVending(product.id)}>
            <span>{product.name}</span><strong>{product.price} bits</strong>
          </button>)}
          <p>{t(props.locale, deriveBehaviorFromCodex(props.status) ? "desktop.vending.busy" : "desktop.vending.hint")}</p>
          <div className="desktop-vending-colors" role="group" aria-label={t(props.locale, "desktop.vending.colors")}>
            <p className="desktop-vending-colors-label">{t(props.locale, "desktop.vending.colors")}</p>
            {DESKTOP_VENDING_SKIN_IDS.map((skinId) => <button type="button" role="menuitemradio" key={skinId}
              className="desktop-vending-color" data-vending-skin={skinId}
              aria-checked={runtimeRef.current.vendingMachineSkinId === skinId}
              disabled={returning || renderFailedRef.current} onClick={() => selectVendingSkin(skinId)}>
              <span className={`desktop-vending-swatch desktop-vending-swatch-${skinId}`} aria-hidden="true" />
              <span>{t(props.locale, `desktop.vending.color.${skinId}`)}</span>
              <span className="desktop-vending-color-check" aria-hidden="true">{runtimeRef.current.vendingMachineSkinId === skinId ? "✓" : ""}</span>
            </button>)}
          </div>
        </>}
        {(menu.target === "computer" || menu.target === "vendingMachine") && <button type="button" role="menuitem"
          disabled={returning || renderFailedRef.current} onClick={toggleVending}>
          {t(props.locale, runtimeRef.current.vendingMachine || runtimeRef.current.vendingMachineParked ? "desktop.vending.pack" : "desktop.vending.place")}
        </button>}
        {menu.target === "computer" && runtimeRef.current.vendingMachineParked && <p>{t(props.locale, "desktop.vending.parked")}</p>}
        {menu.target === "computer" && <button type="button" role="menuitem" disabled={returning || renderFailedRef.current} onClick={beginAreaEdit}>
          {t(props.locale, "desktop.area.adjust")}
        </button>}
        <button type="button" role="menuitem" disabled={returning} onClick={() => void returnToRoom()}>
          {t(props.locale, returning ? "desktop.returning" : "desktop.return")}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>}
      {(notice || vendingPhase) && !areaDraft && <div className="desktop-vending-notice" role="status" aria-live="polite">
        {notice || t(props.locale, `desktop.vending.phase.${vendingPhase}`)}
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
          {notice && <p role="alert" className="desktop-area-error">{notice}</p>}
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
