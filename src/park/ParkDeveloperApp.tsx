import { useEffect, useRef, useState } from "react";
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

export const ParkDeveloperApp = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [objects, setObjects] = useState<ParkObjectPlacement[]>(readParkLayout);
  const objectsRef = useRef(objects);
  const [selectedKind, setSelectedKind] = useState<ParkObjectKind>("tree");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [message, setMessage] = useState("Click a valid grass position to place the selected object.");

  useEffect(() => {
    objectsRef.current = objects;
    writeParkLayout(objects);
  }, [objects]);

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
    if (objects.length === 0) return;
    setObjects((current) => current.slice(0, -1));
    setSelectedObjectId(null);
    setMessage("Removed the most recently placed object.");
  };

  const clearPlacedObjects = () => {
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
        <small>Coordinates are saved immediately and shared with every open park window.</small>
      </aside>
      <section className="park-developer-stage">
        <canvas ref={canvasRef} className="park-canvas" onPointerDown={placeObject} />
      </section>
    </main>
  );
};
