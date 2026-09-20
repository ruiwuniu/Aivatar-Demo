import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DEFAULT_PARK_OBJECTS,
  PARK_OBJECT_DEFINITIONS,
  PARK_SCENE_HEIGHT,
  PARK_SCENE_WIDTH,
  isParkPlacementPoint,
  type ParkObjectKind,
  type ParkObjectPlacement,
} from "./parkContent";
import { renderParkScene } from "./parkRenderer";
import { readParkLayout, writeParkLayout } from "./parkStorage";
import { installCloseSaveHandler } from "../persistence/closeSave";
import { isStoreClosing } from "../persistence/saveStore";

export const ParkDeveloperApp = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [objects, setObjects] = useState<ParkObjectPlacement[]>(readParkLayout);
  const objectsRef = useRef(objects);
  const [selectedKind, setSelectedKind] = useState<ParkObjectKind>("tree");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("Click a valid grass position to place the selected object.");
  const [saveMessage, setSaveMessage] = useState("");
  const saveGeneration = useRef(0);

  useLayoutEffect(() => {
    objectsRef.current = objects;
    const generation = ++saveGeneration.current;
    setSaveMessage("Saving layout…");
    void writeParkLayout(objects).then((ok) => {
      if (generation !== saveGeneration.current) return;
      setSaveMessage(ok ? "Layout saved." : "Could not save layout. Your edits are retained; retry before closing.");
    });
  }, [objects]);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void installCloseSaveHandler(async () => {
      const ok = await writeParkLayout(objectsRef.current);
      return { ok, written: ok };
    }, {
      onFailure: (message) => setSaveMessage(message),
    }).then((stop) => { if (stopped) stop(); else unlisten = stop; }, () => {
      setSaveMessage("Could not enable save-before-close. Keep this window open until the layout is saved.");
    });
    return () => { stopped = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let frame = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      frame += 1;
      if (canvasRef.current) {
        renderParkScene(canvasRef.current, {
          nowMs: Date.now(),
          frame,
          objects: objectsRef.current,
          selectedObjectId: selectedObjectId ?? undefined,
        });
      }
      window.requestAnimationFrame(loop);
    };
    const animation = window.requestAnimationFrame(loop);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(animation);
    };
  }, [selectedObjectId]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * PARK_SCENE_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * PARK_SCENE_HEIGHT,
    };
  };

  const placeObject = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (isStoreClosing()) return;
    const point = canvasPoint(event);
    if (!point) return;
    const hit = [...objects]
      .reverse()
      .find((object) => Math.hypot(point.x - object.x, point.y - object.y) < 32);
    if (hit) {
      setSelectedObjectId(hit.id);
      setMessage(`Selected ${hit.kind}. Click empty grass to place another object.`);
      return;
    }
    if (!isParkPlacementPoint(point.x, point.y, objects)) {
      setMessage("That position is water, cliff edge, or too close to another object.");
      return;
    }
    const placement: ParkObjectPlacement = {
      id: `park-${selectedKind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      kind: selectedKind,
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
    setObjects((current) => [...current, placement]);
    setSelectedObjectId(placement.id);
    setMessage(`Placed ${selectedKind}.`);
  };

  const undoLastPlacement = () => {
    if (isStoreClosing()) return;
    if (objects.length === 0) return;
    setObjects((current) => current.slice(0, -1));
    setSelectedObjectId(null);
    setMessage("Removed the most recently placed object.");
  };

  const clearPlacedObjects = () => {
    if (isStoreClosing()) return;
    setObjects(DEFAULT_PARK_OBJECTS.map((object) => ({ ...object })));
    setSelectedObjectId(null);
    setMessage("Cleared developer-placed objects. The reference landscape remains intact.");
  };

  return (
    <main className="park-developer-app">
      <aside className="park-developer-panel">
        <p className="park-developer-kicker">Aivatar Park</p>
        <h1>Developer Placement</h1>
        <div className="park-developer-palette">
          {PARK_OBJECT_DEFINITIONS.map((definition) => (
            <button
              key={definition.kind}
              type="button"
              className={selectedKind === definition.kind ? "active" : ""}
              onClick={() => setSelectedKind(definition.kind)}
            >
              {definition.name}
            </button>
          ))}
        </div>
        <button type="button" onClick={undoLastPlacement}>Undo last placement</button>
        <button type="button" onClick={clearPlacedObjects}>Clear placed objects</button>
        <p className="park-developer-message">{message}</p>
        <p role="status">{saveMessage}</p>
        <button type="button" onClick={() => {
          if (isStoreClosing()) return;
          void writeParkLayout(objectsRef.current).then((ok) => setSaveMessage(ok ? "Layout saved." : "Could not save layout. Please retry."));
        }}>Retry save</button>
        <small>Coordinates are shared with open park windows after saving finishes.</small>
      </aside>
      <section className="park-developer-stage">
        <canvas ref={canvasRef} className="park-canvas" onPointerDown={placeObject} />
      </section>
    </main>
  );
};
