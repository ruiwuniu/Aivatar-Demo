import { useEffect, useRef, type CSSProperties } from "react";
import { t, type Locale } from "../i18n";
import { PARK_SCENE_HEIGHT, PARK_SCENE_WIDTH } from "./parkContent";
import {
  PARK_FISHING_HITS_TO_WIN,
  PARK_FISHING_MISSES_TO_LOSE,
  parkFishingCursor,
  type ParkFishingGame,
  type ParkFishingInput,
} from "./parkFishingGame";

export interface ParkFishingOverlayProps {
  game: ParkFishingGame | undefined;
  avatar?: { x: number; y: number };
  now: number;
  locale: Locale;
  onInput: (input: ParkFishingInput) => void;
}

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (
    target.isContentEditable
    || Boolean(target.closest("input, textarea, select, [role='textbox']"))
  );

const readyToReel = (game: ParkFishingGame, now: number) =>
  game.phase === "qte" && now >= game.nextInputAt && now < game.roundEndsAt;

export const ParkFishingOverlay = (props: ParkFishingOverlayProps) => {
  const { game, avatar, now, locale, onInput } = props;
  const latestRef = useRef(props);
  latestRef.current = props;
  const participating = game?.phase === "waiting" || game?.phase === "qte";

  useEffect(() => {
    if (!participating) return;
    const handleKey = (event: KeyboardEvent) => {
      const current = latestRef.current;
      const active = current.game;
      if (!active || (active.phase !== "waiting" && active.phase !== "qte")) return;
      if (isEditableTarget(event.target) || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!event.repeat) current.onInput({ type: "cancel", id: active.id });
        return;
      }
      if (active.phase !== "qte" || (event.code !== "Space" && event.key !== " ")) return;
      // Preserve native keyboard activation for other buttons and links.
      if (event.target instanceof Element
        && event.target.closest("button, a[href], [role='button']")
        && !event.target.closest("[data-park-fishing-reel]")) return;
      // The reel button's native Space click must not also consume the next round.
      event.preventDefault();
      if (event.repeat || !readyToReel(active, current.now)) return;
      current.onInput({ type: "reel", id: active.id, round: active.round });
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [participating]);

  if (!game) return null;
  const copy = (key: string, params?: Record<string, string | number>) =>
    t(locale, `park.fishing.${key}`, params);
  const input = (type: ParkFishingInput["type"]) =>
    onInput({ type, id: game.id, ...(type === "reel" ? { round: game.round } : {}) });

  if (game.phase === "invite") {
    if (!avatar || now >= game.expiresAt) return null;
    const anchorStyle: CSSProperties = {
      left: `clamp(min(134px, 50%), ${avatar.x / PARK_SCENE_WIDTH * 100}%, max(50%, calc(100% - 134px)))`,
      top: `clamp(150px, ${(avatar.y - 64) / PARK_SCENE_HEIGHT * 100}%, calc(100% - 24px))`,
    };
    return (
      <div className="park-fishing-overlay" data-park-fishing-phase="invite">
        <aside className="park-fishing-invite" style={anchorStyle} aria-label={copy("invitationLabel")}>
          <span className="park-fishing-cloth" aria-hidden="true" />
          <span className="park-fishing-stitch" aria-hidden="true" />
          <p className="park-fishing-invite-copy" aria-live="polite">{copy("invitation")}</p>
          <div className="park-fishing-actions">
            <button type="button" className="park-fishing-button park-fishing-button-primary" onClick={() => input("accept")}>
              {copy("accept")}
            </button>
            <button type="button" className="park-fishing-button" onClick={() => input("decline")}>
              {copy("decline")}
            </button>
          </div>
        </aside>
      </div>
    );
  }

  const isQte = game.phase === "qte";
  const feedback = isQte && now < game.nextInputAt ? game.lastOutcome : undefined;
  const headingKey = feedback === "hit" ? "hit" : feedback === "miss" ? "miss" : game.phase;
  const title = copy(headingKey);
  const countdown = Math.max(0, (game.roundEndsAt - now) / 1000).toFixed(1);
  const cursor = Math.max(0, Math.min(1, parkFishingCursor(game, now)));

  return (
    <div className="park-fishing-overlay" data-park-fishing-phase={game.phase}>
      <section className={`park-fishing-panel park-fishing-panel-${game.phase}`} aria-label={copy("title")}>
        <span className="park-fishing-cloth" aria-hidden="true" />
        <span className="park-fishing-stitch" aria-hidden="true" />
        <header className="park-fishing-heading">
          <span className="park-fishing-pixel-fish" aria-hidden="true" />
          <strong aria-live="polite">{title}</strong>
          {isQte && <span className="park-fishing-direction" aria-hidden="true">{game.direction === "reverse" ? "←" : "→"}</span>}
          {isQte && <span className="park-fishing-countdown" aria-hidden="true">{countdown}s</span>}
        </header>
        {isQte ? (
          <>
            <p className="park-fishing-hint" id="park-fishing-qte-hint">{copy("qteHint")}</p>
            <div className="park-fishing-rod" aria-hidden="true">
              <span className="park-fishing-rod-handle" />
              <span className="park-fishing-rod-reel" />
              <div className="park-fishing-meter" data-outcome={feedback}>
                <span className="park-fishing-rod-shaft" />
                <span className="park-fishing-rod-guides"><i /><i /><i /><i /><i /></span>
                <div
                  className="park-fishing-target"
                  style={{ left: `${game.targetStart * 100}%`, width: `${(game.targetEnd - game.targetStart) * 100}%` }}
                />
                <div className="park-fishing-cursor" style={{ left: `${cursor * 100}%` }} />
              </div>
            </div>
            <div className="park-fishing-footer">
              <div className="park-fishing-scores">
                <span className="park-fishing-score" aria-label={copy("hitCount", { count: game.hits, total: PARK_FISHING_HITS_TO_WIN })}>
                  <span>{copy("progress")}</span>
                  {Array.from({ length: PARK_FISHING_HITS_TO_WIN }, (_, index) => (
                    <i key={index} className={index < game.hits ? "filled" : undefined} aria-hidden="true" />
                  ))}
                </span>
                <span className="park-fishing-score park-fishing-misses" aria-label={copy("missCount", { count: game.misses, total: PARK_FISHING_MISSES_TO_LOSE })}>
                  <span>{copy("misses")}</span>
                  {Array.from({ length: PARK_FISHING_MISSES_TO_LOSE }, (_, index) => (
                    <i key={index} className={index < game.misses ? "filled" : undefined} aria-hidden="true" />
                  ))}
                </span>
              </div>
              <div className="park-fishing-actions">
                <button
                  type="button"
                  data-park-fishing-reel
                  className="park-fishing-button park-fishing-button-primary"
                  aria-describedby="park-fishing-qte-hint"
                  disabled={!readyToReel(game, now)}
                  onClick={() => input("reel")}
                  onKeyDown={(event) => {
                    if ((event.code === "Space" || event.key === " ") || (event.key === "Enter" && event.repeat)) event.preventDefault();
                  }}
                  onKeyUp={(event) => {
                    if (event.code === "Space" || event.key === " ") event.preventDefault();
                  }}
                >
                  {copy("reel")} <kbd>{copy("space")}</kbd>
                </button>
                <button type="button" className="park-fishing-button" onClick={() => input("cancel")}>{copy("cancel")}</button>
              </div>
            </div>
          </>
        ) : game.phase === "waiting" ? (
          <>
            <div className="park-fishing-wait" aria-hidden="true"><i /><i /><i /></div>
            <p className="park-fishing-hint">{copy("waitingHint")}</p>
            <button type="button" className="park-fishing-button" onClick={() => input("cancel")}>{copy("cancel")}</button>
          </>
        ) : (
          <p className="park-fishing-hint">{copy(game.phase === "success" ? "successHint" : "escapedHint")}</p>
        )}
      </section>
    </div>
  );
};
