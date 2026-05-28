import { useEffect, useMemo, useRef, useState } from "react";
import type { PixelAsset, PixelAssetFrame, PixelCell } from "../types";

const STORAGE_KEY = "aivatar.assetEditor.v1";
const SCENE_WIDTH = 480;
const SCENE_HEIGHT = 320;
const WALL_AREA = { x: 76, y: 20, width: 328, height: 106 };
const FLOOR_AREA = { x: 76, y: 126, width: 328, height: 180 };
const MIN_CANVAS_SIZE = 8;
const MAX_CANVAS_WIDTH = 480;
const MAX_CANVAS_HEIGHT = 320;

const sizePresets = [
  { label: "Avatar S", width: 48, height: 56 },
  { label: "Avatar Act", width: 64, height: 64 },
  { label: "Desktop", width: 32, height: 32 },
  { label: "Furniture", width: 64, height: 64 },
  { label: "Room Ref", width: SCENE_WIDTH, height: SCENE_HEIGHT },
];

const palette = [
  "#000000",
  "#241c35",
  "#7f8cff",
  "#9ee6ff",
  "#f4ead2",
  "#ffe66d",
  "#8df7c4",
  "#ff8fa3",
  "#c48650",
  "#8f4e38",
  "#6f9560",
  "#78a7ff",
];

const createFrame = (): PixelAssetFrame => ({
  id: `frame-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  pixels: [],
});

const createDefaultAsset = (): PixelAsset => ({
  id: "draft-asset",
  name: "Draft Asset",
  width: 48,
  height: 64,
  fps: 6,
  frames: [createFrame()],
});

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeAsset = (asset: PixelAsset): PixelAsset => {
  const width = clamp(Math.round(asset.width || 48), MIN_CANVAS_SIZE, MAX_CANVAS_WIDTH);
  const height = clamp(Math.round(asset.height || 64), MIN_CANVAS_SIZE, MAX_CANVAS_HEIGHT);
  const frames = asset.frames.length > 0 ? asset.frames : [createFrame()];

  return {
    ...asset,
    width,
    height,
    fps: clamp(Math.round(asset.fps || 6), 1, 24),
    frames: frames.map((frame) => ({
      ...frame,
      pixels: frame.pixels.filter(
        (pixel) => pixel.x >= 0 && pixel.x < width && pixel.y >= 0 && pixel.y < height,
      ),
    })),
  };
};

const loadAsset = (): PixelAsset => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultAsset();
    return normalizeAsset(JSON.parse(raw) as PixelAsset);
  } catch {
    return createDefaultAsset();
  }
};

const pixelKey = (x: number, y: number) => `${x}:${y}`;

const frameToMap = (frame: PixelAssetFrame) => {
  const pixels = new Map<string, PixelCell>();
  frame.pixels.forEach((pixel) => pixels.set(pixelKey(pixel.x, pixel.y), pixel));
  return pixels;
};

const drawAssetFrame = (
  canvas: HTMLCanvasElement | null,
  asset: PixelAsset,
  frame: PixelAssetFrame,
  options: { showGrid: boolean; fitToCanvas?: boolean },
) => {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const fitScale = Math.min(canvas.width / asset.width, canvas.height / asset.height);
  const scale =
    fitScale >= 1 ? Math.max(1, Math.floor(fitScale)) : Math.max(0.25, fitScale);
  const drawnWidth = asset.width * scale;
  const drawnHeight = asset.height * scale;
  const offsetX = Math.floor((canvas.width - drawnWidth) / 2);
  const offsetY = Math.floor((canvas.height - drawnHeight) / 2);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#101421";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#172033";
  ctx.fillRect(offsetX, offsetY, drawnWidth, drawnHeight);

  frame.pixels.forEach((pixel) => {
    ctx.fillStyle = pixel.color;
    ctx.fillRect(offsetX + pixel.x * scale, offsetY + pixel.y * scale, scale, scale);
  });

  if (options.showGrid && scale >= 4) {
    ctx.strokeStyle = "rgba(244, 234, 210, 0.16)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= asset.width; x += 1) {
      ctx.beginPath();
      ctx.moveTo(offsetX + x * scale + 0.5, offsetY);
      ctx.lineTo(offsetX + x * scale + 0.5, offsetY + drawnHeight);
      ctx.stroke();
    }
    for (let y = 0; y <= asset.height; y += 1) {
      ctx.beginPath();
      ctx.moveTo(offsetX, offsetY + y * scale + 0.5);
      ctx.lineTo(offsetX + drawnWidth, offsetY + y * scale + 0.5);
      ctx.stroke();
    }
  }
};

export const PixelAssetEditor = () => {
  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [asset, setAsset] = useState<PixelAsset>(() => loadAsset());
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [tool, setTool] = useState<"pencil" | "erase">("pencil");
  const [color, setColor] = useState("#7f8cff");
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [anchor, setAnchor] = useState({ x: 210, y: 185 });

  const activeFrame = asset.frames[activeFrameIndex] ?? asset.frames[0];
  const widthRatio = Math.round((asset.width / SCENE_WIDTH) * 100);
  const heightRatio = Math.round((asset.height / SCENE_HEIGHT) * 100);

  const roomAssetBox = useMemo(
    () => ({
      left: `${(anchor.x / SCENE_WIDTH) * 100}%`,
      top: `${(anchor.y / SCENE_HEIGHT) * 100}%`,
      width: `${(asset.width / SCENE_WIDTH) * 100}%`,
      height: `${(asset.height / SCENE_HEIGHT) * 100}%`,
    }),
    [anchor.x, anchor.y, asset.width, asset.height],
  );

  useEffect(() => {
    drawAssetFrame(editorCanvasRef.current, asset, activeFrame, { showGrid: true });
    drawAssetFrame(previewCanvasRef.current, asset, activeFrame, {
      showGrid: false,
      fitToCanvas: true,
    });
  }, [activeFrame, asset]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setActiveFrameIndex((index) => (index + 1) % asset.frames.length);
    }, 1000 / asset.fps);
    return () => window.clearInterval(timer);
  }, [asset.fps, asset.frames.length, isPlaying]);

  const updateActiveFrame = (pixels: PixelCell[]) => {
    setAsset((current) => ({
      ...current,
      frames: current.frames.map((frame, index) =>
        index === activeFrameIndex ? { ...frame, pixels } : frame,
      ),
    }));
  };

  const paintAt = (clientX: number, clientY: number) => {
    const canvas = editorCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const fitScale = Math.min(canvas.width / asset.width, canvas.height / asset.height);
    const scale =
      fitScale >= 1 ? Math.max(1, Math.floor(fitScale)) : Math.max(0.25, fitScale);
    const drawnWidth = asset.width * scale;
    const drawnHeight = asset.height * scale;
    const offsetX = Math.floor((canvas.width - drawnWidth) / 2);
    const offsetY = Math.floor((canvas.height - drawnHeight) / 2);
    const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width - offsetX) / scale;
    const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height - offsetY) / scale;
    const pixelX = Math.floor(x);
    const pixelY = Math.floor(y);
    if (pixelX < 0 || pixelX >= asset.width || pixelY < 0 || pixelY >= asset.height) return;

    const pixels = frameToMap(activeFrame);
    const key = pixelKey(pixelX, pixelY);
    if (tool === "erase") {
      pixels.delete(key);
    } else {
      pixels.set(key, { x: pixelX, y: pixelY, color });
    }
    updateActiveFrame([...pixels.values()]);
  };

  const resizeAsset = (width: number, height: number) => {
    setAsset((current) =>
      normalizeAsset({
        ...current,
        width,
        height,
      }),
    );
  };

  const saveAsset = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(asset));
  };

  const addFrame = () => {
    setAsset((current) => ({ ...current, frames: [...current.frames, createFrame()] }));
    setActiveFrameIndex(asset.frames.length);
  };

  const copyFrame = () => {
    const copied = {
      id: `frame-${Date.now()}`,
      pixels: activeFrame.pixels.map((pixel) => ({ ...pixel })),
    };
    setAsset((current) => ({
      ...current,
      frames: [
        ...current.frames.slice(0, activeFrameIndex + 1),
        copied,
        ...current.frames.slice(activeFrameIndex + 1),
      ],
    }));
    setActiveFrameIndex(activeFrameIndex + 1);
  };

  const deleteFrame = () => {
    if (asset.frames.length <= 1) return;
    setAsset((current) => ({
      ...current,
      frames: current.frames.filter((_, index) => index !== activeFrameIndex),
    }));
    setActiveFrameIndex((index) => Math.max(0, index - 1));
  };

  const clearFrame = () => updateActiveFrame([]);

  return (
    <section className="control-section asset-editor">
      <div className="section-heading">
        <h2>Asset Editor</h2>
        <span>
          {asset.width}x{asset.height}
        </span>
      </div>

      <label className="asset-field">
        <span>Name</span>
        <input
          type="text"
          value={asset.name}
          onChange={(event) =>
            setAsset((current) => ({ ...current, name: event.target.value }))
          }
        />
      </label>

      <div className="asset-size-row">
        <label>
          W
          <input
            type="number"
            min={MIN_CANVAS_SIZE}
            max={MAX_CANVAS_WIDTH}
            value={asset.width}
            onChange={(event) => resizeAsset(Number(event.target.value), asset.height)}
          />
        </label>
        <label>
          H
          <input
            type="number"
            min={MIN_CANVAS_SIZE}
            max={MAX_CANVAS_HEIGHT}
            value={asset.height}
            onChange={(event) => resizeAsset(asset.width, Number(event.target.value))}
          />
        </label>
        <label>
          FPS
          <input
            type="number"
            min={1}
            max={24}
            value={asset.fps}
            onChange={(event) =>
              setAsset((current) => ({
                ...current,
                fps: clamp(Number(event.target.value), 1, 24),
              }))
            }
          />
        </label>
      </div>

      <div className="asset-presets">
        {sizePresets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="asset-mini-button"
            onClick={() => resizeAsset(preset.width, preset.height)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="asset-toolbar">
        <button
          type="button"
          className={`asset-mini-button${tool === "pencil" ? " active" : ""}`}
          onClick={() => setTool("pencil")}
        >
          Pencil
        </button>
        <button
          type="button"
          className={`asset-mini-button${tool === "erase" ? " active" : ""}`}
          onClick={() => setTool("erase")}
        >
          Erase
        </button>
        <input
          aria-label="Asset color"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
      </div>

      <div className="asset-palette">
        {palette.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className="asset-swatch"
            style={{ background: swatch }}
            aria-label={swatch}
            onClick={() => setColor(swatch)}
          />
        ))}
      </div>

      <canvas
        ref={editorCanvasRef}
        className="asset-canvas"
        width={192}
        height={192}
        onMouseDown={(event) => {
          setIsDrawing(true);
          paintAt(event.clientX, event.clientY);
        }}
        onMouseMove={(event) => {
          if (isDrawing) paintAt(event.clientX, event.clientY);
        }}
        onMouseUp={() => setIsDrawing(false)}
        onMouseLeave={() => setIsDrawing(false)}
      />

      <div className="asset-frame-controls">
        <button type="button" className="asset-mini-button" onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" className="asset-mini-button" onClick={addFrame}>
          Add
        </button>
        <button type="button" className="asset-mini-button" onClick={copyFrame}>
          Copy
        </button>
        <button type="button" className="asset-mini-button" onClick={deleteFrame}>
          Delete
        </button>
      </div>

      <div className="asset-frames">
        {asset.frames.map((frame, index) => (
          <button
            key={frame.id}
            type="button"
            className={`asset-frame-tab${index === activeFrameIndex ? " active" : ""}`}
            onClick={() => setActiveFrameIndex(index)}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <div className="asset-actions">
        <button type="button" className="pixel-button" onClick={saveAsset}>
          Save
        </button>
        <button type="button" className="pixel-button danger-button" onClick={clearFrame}>
          Clear Frame
        </button>
      </div>

      <div className="asset-preview-row">
        <canvas ref={previewCanvasRef} width={64} height={64} />
        <p>
          Scene {SCENE_WIDTH}x{SCENE_HEIGHT}
          <br />
          Asset {widthRatio}% x {heightRatio}%
        </p>
      </div>

      <div className="asset-room-reference" aria-label="Room reference">
        <div
          className="asset-room-wall"
          style={{
            left: `${(WALL_AREA.x / SCENE_WIDTH) * 100}%`,
            top: `${(WALL_AREA.y / SCENE_HEIGHT) * 100}%`,
            width: `${(WALL_AREA.width / SCENE_WIDTH) * 100}%`,
            height: `${(WALL_AREA.height / SCENE_HEIGHT) * 100}%`,
          }}
        />
        <div
          className="asset-room-floor"
          style={{
            left: `${(FLOOR_AREA.x / SCENE_WIDTH) * 100}%`,
            top: `${(FLOOR_AREA.y / SCENE_HEIGHT) * 100}%`,
            width: `${(FLOOR_AREA.width / SCENE_WIDTH) * 100}%`,
            height: `${(FLOOR_AREA.height / SCENE_HEIGHT) * 100}%`,
          }}
        />
        <div className="asset-room-box" style={roomAssetBox} />
      </div>

      <div className="asset-anchor-row">
        <label>
          X
          <input
            type="number"
            min={0}
            max={SCENE_WIDTH}
            value={anchor.x}
            onChange={(event) =>
              setAnchor((current) => ({
                ...current,
                x: clamp(Number(event.target.value), 0, SCENE_WIDTH),
              }))
            }
          />
        </label>
        <label>
          Y
          <input
            type="number"
            min={0}
            max={SCENE_HEIGHT}
            value={anchor.y}
            onChange={(event) =>
              setAnchor((current) => ({
                ...current,
                y: clamp(Number(event.target.value), 0, SCENE_HEIGHT),
              }))
            }
          />
        </label>
      </div>
    </section>
  );
};
