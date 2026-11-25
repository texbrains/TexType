// What a valid custom symbol is: the user's library is checked here when the page hands it in, and refused
// with a precise error otherwise (custom-symbols.ts keeps the checked library).
import { kernelCompletionCatalogData } from "../kernel/host.ts";
import type {
  CustomSymbolDefinition,
  CustomSymbolDesignerSourceArchive,
  CustomSymbolLayerEffects,
  CustomSymbolLibrary,
  CustomSymbolLimitsBehavior,
  CustomSymbolMathRole,
  CustomSymbolMetrics,
  CustomSymbolVectorShape,
  CustomSymbolVectorTransform,
} from "./custom-symbol-types.ts";


export const CUSTOM_SYMBOL_LIBRARY_VERSION = 1 as const;
const maximumShapesPerDesignerAsset = 256;
const maximumCompiledArtworkShapes = 4_096;
const maximumDesignerAssets = 96;
const maximumDesignerLayers = 192;
const maximumDesignerSourceLatexLength = 2_000;
const maximumPathLength = 24_000;
const maximumNameLength = 64;
const maximumFallbackLength = 2_000;
const minimumMetric = 0.02;
const maximumWidthEm = 64;
const maximumVerticalMetricEm = 64;
const finiteCoordinateLimit = 100_000;

const mathRoles = new Set<CustomSymbolMathRole>([
  "ordinary",
  "binary",
  "relation",
  "operator",
  "open",
  "close",
  "punctuation",
]);
const limitsBehaviors = new Set<CustomSymbolLimitsBehavior>([
  "auto",
  "limits",
  "nolimits",
]);
const lineCaps = new Set(["butt", "round", "square"] as const);
const lineJoins = new Set(["miter", "round", "bevel"] as const);
/** The control words of the command catalogue, when the editor has handed it in (the render page has none). */
let catalogueWords: { size: number; words: Set<string> } | null = null;
function catalogueControlWords(): Set<string> {
  if (catalogueWords?.size !== kernelCompletionCatalogData.length) {
    const words = kernelCompletionCatalogData.flatMap((command) => {
      const match = command.command.match(/^\\([A-Za-z]+)/);
      return match?.[1] ? [match[1]] : [];
    });
    catalogueWords = { size: kernelCompletionCatalogData.length, words: new Set(words) };
  }
  return catalogueWords.words;
}
const reservedCoreControlWords = new Set([
  "begin", "end", "left", "right", "middle",
  "class", "htmlClass", "cssId", "htmlId", "href",
  "color", "textcolor", "colorbox", "fcolorbox",
  "rule", "raise", "raisebox", "phantom", "hphantom", "vphantom",
  "mathord", "mathbin", "mathrel", "mathop", "mathopen", "mathclose", "mathpunct",
  "limits", "nolimits", "displaylimits",
  "over", "atop", "above", "choose",
  "def", "gdef", "let", "newcommand", "renewcommand", "providecommand",
  "operatorname", "operatornamewithlimits",
  "text", "mbox", "hbox", "vbox",
  "kern", "mkern", "hskip", "vskip", "hspace", "vspace",
  "style", "bbox", "unicode", "char",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function finiteCoordinate(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > finiteCoordinateLimit) {
    throw new Error("Custom symbol geometry contains an invalid coordinate.");
  }
  return numeric;
}

function normalizeTransform(value: unknown): CustomSymbolVectorTransform | undefined {
  if (!isRecord(value)) return undefined;
  const result: CustomSymbolVectorTransform = {};
  const numericKeys = [
    "translateX",
    "translateY",
    "scaleX",
    "scaleY",
    "skewXDeg",
    "skewYDeg",
    "rotateDeg",
    "originX",
    "originY",
  ] as const;
  for (const key of numericKeys) {
    if (value[key] === undefined) continue;
    result[key] = finiteCoordinate(value[key]);
  }
  if (result.scaleX === 0 || result.scaleY === 0) {
    throw new Error("Custom symbol geometry cannot use a zero scale.");
  }
  if (value.matrix !== undefined) {
    if (!Array.isArray(value.matrix) || value.matrix.length !== 6) {
      throw new Error("Custom symbol geometry contains an invalid transform matrix.");
    }
    const matrix = value.matrix.map(finiteCoordinate) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if (Math.abs(determinant) < 0.0000001) {
      throw new Error("Custom symbol geometry cannot use a singular transform matrix.");
    }
    result.matrix = matrix;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeClipRect(value: unknown) {
  if (!isRecord(value)) return undefined;
  const x = finiteCoordinate(value.x);
  const y = finiteCoordinate(value.y);
  const width = finiteCoordinate(value.width);
  const height = finiteCoordinate(value.height);
  if (width <= 0 || height <= 0) {
    throw new Error("Custom symbol clip rectangles must have positive size.");
  }
  return { x, y, width, height };
}

function normalizeShape(value: unknown): CustomSymbolVectorShape {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Custom symbol artwork contains an invalid shape.");
  }
  const common = {
    ...(value.operation === "erase" ? { operation: "erase" as const } : {}),
    ...(typeof value.fill === "boolean" ? { fill: value.fill } : {}),
    ...(value.strokeWidth === undefined
      ? {}
      : { strokeWidth: Math.max(0, finiteCoordinate(value.strokeWidth)) }),
    ...(lineCaps.has(value.lineCap as "butt" | "round" | "square")
      ? { lineCap: value.lineCap as "butt" | "round" | "square" }
      : {}),
    ...(lineJoins.has(value.lineJoin as "miter" | "round" | "bevel")
      ? { lineJoin: value.lineJoin as "miter" | "round" | "bevel" }
      : {}),
    ...(value.transform === undefined
      ? {}
      : { transform: normalizeTransform(value.transform) }),
    ...(value.clipRect === undefined
      ? {}
      : { clipRect: normalizeClipRect(value.clipRect) }),
  };

  switch (value.kind) {
    case "path": {
      const d = typeof value.d === "string" ? value.d.trim() : "";
      if (!d || d.length > maximumPathLength) {
        throw new Error("Custom symbol path data is empty or too large.");
      }
      if (!/^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\-\s]+$/.test(d)) {
        throw new Error("Custom symbol path contains unsupported SVG syntax.");
      }
      return { kind: "path", d, ...common };
    }
    case "circle":
      return {
        kind: "circle",
        cx: finiteCoordinate(value.cx),
        cy: finiteCoordinate(value.cy),
        r: Math.max(0, finiteCoordinate(value.r)),
        ...common,
      };
    case "line":
      return {
        kind: "line",
        x1: finiteCoordinate(value.x1),
        y1: finiteCoordinate(value.y1),
        x2: finiteCoordinate(value.x2),
        y2: finiteCoordinate(value.y2),
        ...common,
      };
    case "rect":
      return {
        kind: "rect",
        x: finiteCoordinate(value.x),
        y: finiteCoordinate(value.y),
        width: Math.max(0, finiteCoordinate(value.width)),
        height: Math.max(0, finiteCoordinate(value.height)),
        ...(value.rx === undefined ? {} : { rx: Math.max(0, finiteCoordinate(value.rx)) }),
        ...(value.ry === undefined ? {} : { ry: Math.max(0, finiteCoordinate(value.ry)) }),
        ...common,
      };
    case "ellipse":
      return {
        kind: "ellipse",
        cx: finiteCoordinate(value.cx),
        cy: finiteCoordinate(value.cy),
        rx: Math.max(0, finiteCoordinate(value.rx)),
        ry: Math.max(0, finiteCoordinate(value.ry)),
        ...common,
      };
    case "polygon": {
      if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > 256) {
        throw new Error("Custom symbol polygon has an invalid number of points.");
      }
      return {
        kind: "polygon",
        points: value.points.map((point) => {
          if (!Array.isArray(point) || point.length !== 2) {
            throw new Error("Custom symbol polygon contains an invalid point.");
          }
          return [finiteCoordinate(point[0]), finiteCoordinate(point[1])];
        }),
        ...common,
      };
    }
    case "text": {
      const text = typeof value.text === "string" ? value.text.normalize("NFC") : "";
      const fontFamily =
        typeof value.fontFamily === "string" ? value.fontFamily.trim() : "";
      const fontSize = finiteNumber(value.fontSize, NaN);
      const fontWeight =
        value.fontWeight === undefined
          ? undefined
          : Math.round(finiteNumber(value.fontWeight, NaN));
      if (
        !text ||
        Array.from(text).length > 16 ||
        /[\u0000-\u001f\u007f]/.test(text) ||
        !fontFamily ||
        fontFamily.length > 128 ||
        /[\u0000-\u001f\u007f"'<>]/.test(fontFamily) ||
        !Number.isFinite(fontSize) ||
        fontSize < 20 ||
        fontSize > 8_000 ||
        (fontWeight !== undefined &&
          (!Number.isFinite(fontWeight) || fontWeight < 100 || fontWeight > 900))
      ) {
        throw new Error("Custom symbol system-font glyph is invalid or too large.");
      }
      return {
        kind: "text",
        text,
        x: finiteCoordinate(value.x),
        y: finiteCoordinate(value.y),
        fontFamily,
        fontSize,
        ...(value.fontStyle === "italic" || value.fontStyle === "normal"
          ? { fontStyle: value.fontStyle }
          : {}),
        ...(fontWeight === undefined ? {} : { fontWeight }),
        ...common,
      };
    }
    default:
      throw new Error(`Unsupported custom symbol shape: ${value.kind}`);
  }
}

function normalizeMetrics(value: unknown): CustomSymbolMetrics {
  if (!isRecord(value)) throw new Error("Custom symbol metrics are missing.");
  const widthEm = finiteNumber(value.widthEm, NaN);
  const ascentEm = finiteNumber(value.ascentEm, NaN);
  const descentEm = finiteNumber(value.descentEm, NaN);
  if (
    !Number.isFinite(widthEm) ||
    !Number.isFinite(ascentEm) ||
    !Number.isFinite(descentEm) ||
    widthEm < minimumMetric ||
    widthEm > maximumWidthEm ||
    ascentEm < minimumMetric ||
    ascentEm > maximumVerticalMetricEm ||
    descentEm < 0 ||
    descentEm > maximumVerticalMetricEm
  ) {
    throw new Error("Custom symbol metrics are outside the supported range.");
  }
  return { widthEm, ascentEm, descentEm };
}

function normalizeCommandName(value: unknown) {
  const command = typeof value === "string" ? value.trim().replace(/^\\/, "") : "";
  if (!/^[A-Za-z]+$/.test(command)) {
    throw new Error(
      "Custom symbol commands must be TeX control words containing letters only.",
    );
  }
  if (command.length > 48) {
    throw new Error("Custom symbol command names are too long.");
  }
  return command;
}

function isReservedControlWord(command: string) {
  return reservedCoreControlWords.has(command) || catalogueControlWords().has(command);
}

function normalizeDesignerLayerId(value: unknown, kind: string) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id)) {
    throw new Error(`Custom symbol ${kind} has an invalid identifier.`);
  }
  return id;
}

function normalizeDesignerLayerEffects(
  value: unknown,
): CustomSymbolLayerEffects | undefined {
  if (!isRecord(value)) return undefined;
  const effects: CustomSymbolLayerEffects = {};
  if (isRecord(value.outline)) {
    const width = finiteNumber(value.outline.width, 30);
    if (width < 1 || width > 1_200) {
      throw new Error("Custom symbol outline width is outside the supported range.");
    }
    effects.outline = {
      enabled: value.outline.enabled === true,
      width,
    };
  }
  if (isRecord(value.perspective)) {
    const depth = finiteNumber(value.perspective.depth, 240);
    const angleDeg = finiteNumber(value.perspective.angleDeg, 35);
    const steps = Math.round(finiteNumber(value.perspective.steps, 8));
    if (
      depth < 0 ||
      depth > 4_000 ||
      angleDeg < -720 ||
      angleDeg > 720 ||
      steps < 1 ||
      steps > 24
    ) {
      throw new Error("Custom symbol perspective parameters are outside the supported range.");
    }
    effects.perspective = {
      enabled: value.perspective.enabled === true,
      depth,
      angleDeg,
      steps,
    };
  }
  return Object.keys(effects).length ? effects : undefined;
}

function normalizeDesignerSource(
  value: unknown,
): CustomSymbolDesignerSourceArchive | null {
  if (value == null) return null;
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Custom symbol designer source has an unsupported version.");
  }
  if (
    !Array.isArray(value.assets) ||
    !Array.isArray(value.layers) ||
    value.assets.length > maximumDesignerAssets ||
    value.layers.length > maximumDesignerLayers
  ) {
    throw new Error("Custom symbol designer source is too large.");
  }

  const assetIds = new Set<string>();
  const assets = value.assets.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("Custom symbol designer asset must be an object.");
    }
    const id = normalizeDesignerLayerId(candidate.id, "designer asset");
    if (assetIds.has(id)) {
      throw new Error("Custom symbol designer source has duplicate asset IDs.");
    }
    assetIds.add(id);
    const sourceLatex =
      typeof candidate.sourceLatex === "string" ? candidate.sourceLatex.trim() : "";
    if (
      !sourceLatex ||
      sourceLatex.length > maximumDesignerSourceLatexLength ||
      !Array.isArray(candidate.shapes) ||
      candidate.shapes.length === 0 ||
      candidate.shapes.length > maximumShapesPerDesignerAsset
    ) {
      throw new Error("Custom symbol designer asset is invalid or too large.");
    }
    return {
      id,
      sourceLatex,
      metrics: normalizeMetrics(candidate.metrics),
      shapes: candidate.shapes.map(normalizeShape),
    };
  });

  const layerIds = new Set<string>();
  const layers = value.layers.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("Custom symbol designer layer must be an object.");
    }
    const id = normalizeDesignerLayerId(candidate.id, "designer layer");
    if (layerIds.has(id)) {
      throw new Error("Custom symbol designer source has duplicate layer IDs.");
    }
    layerIds.add(id);
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name || name.length > maximumNameLength) {
      throw new Error("Custom symbol designer layer name is invalid.");
    }
    const base = {
      id,
      name,
      visible: candidate.visible !== false,
      locked: candidate.locked === true,
      transform: normalizeTransform(candidate.transform) ?? {},
      ...(normalizeDesignerLayerEffects(candidate.effects)
        ? { effects: normalizeDesignerLayerEffects(candidate.effects) }
        : {}),
      ...(candidate.clipRect == null
        ? {}
        : { clipRect: normalizeClipRect(candidate.clipRect) }),
    };
    if (candidate.kind === "glyph") {
      const assetId = normalizeDesignerLayerId(candidate.assetId, "designer asset reference");
      if (!assetIds.has(assetId)) {
        throw new Error("Custom symbol designer layer references a missing glyph asset.");
      }
      return { ...base, kind: "glyph" as const, assetId };
    }
    if (candidate.kind === "geometry") {
      if (!isRecord(candidate.bounds)) {
        throw new Error("Custom symbol geometry layer is missing designer bounds.");
      }
      const bounds = {
        x: finiteCoordinate(candidate.bounds.x),
        y: finiteCoordinate(candidate.bounds.y),
        width: finiteCoordinate(candidate.bounds.width),
        height: finiteCoordinate(candidate.bounds.height),
      };
      if (bounds.width <= 0 || bounds.height <= 0) {
        throw new Error("Custom symbol geometry bounds must have positive size.");
      }
      const geometryPresets = new Set([
        "line",
        "circle",
        "ellipse",
        "rect",
        "triangle",
        "arrow",
        "arc",
        "eraser",
      ]);
      const geometryPreset =
        typeof candidate.geometryPreset === "string" &&
        geometryPresets.has(candidate.geometryPreset)
          ? (candidate.geometryPreset as
              | "line"
              | "circle"
              | "ellipse"
              | "rect"
              | "triangle"
              | "arrow"
              | "arc"
              | "eraser")
          : undefined;
      return {
        ...base,
        kind: "geometry" as const,
        ...(geometryPreset ? { geometryPreset } : {}),
        shape: normalizeShape(candidate.shape),
        bounds,
      };
    }
    throw new Error("Custom symbol designer layer has an invalid kind.");
  });

  const baseLayerId =
    value.baseLayerId === null ? null : typeof value.baseLayerId === "string" && layerIds.has(value.baseLayerId) ? value.baseLayerId : undefined;
  return {
    version: 1,
    ...(value.metrics == null ? {} : { metrics: normalizeMetrics(value.metrics) }),
    ...(baseLayerId !== undefined ? { baseLayerId } : {}),
    assets,
    layers,
  };
}

/** An operator's italic correction and where the artwork reaches beyond the box (both optional). */
function normalizeOperatorGeometry(value: Record<string, unknown>) {
  const result: Pick<CustomSymbolDefinition, "italicCorrectionEm" | "artworkBounds"> = {};
  const italic = Number(value.italicCorrectionEm);
  if (value.italicCorrectionEm !== undefined && Number.isFinite(italic) && italic > 0 && italic <= 4) {
    result.italicCorrectionEm = italic;
  }
  if (isRecord(value.artworkBounds)) {
    const bounds = normalizeClipRect(value.artworkBounds);
    if (bounds) result.artworkBounds = bounds;
  }
  return result;
}

function normalizeDefinition(value: unknown): CustomSymbolDefinition {
  if (!isRecord(value)) throw new Error("Custom symbol definition must be an object.");
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(id)) {
    throw new Error("Custom symbol has an invalid identifier.");
  }
  const command = normalizeCommandName(value.command);
  if (isReservedControlWord(command)) {
    throw new Error(`\\${command} is already a command of TexType or LaTeX.`);
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > maximumNameLength) {
    throw new Error("Custom symbol name is empty or too long.");
  }
  if (!mathRoles.has(value.role as CustomSymbolMathRole)) {
    throw new Error("Custom symbol has an invalid mathematical role.");
  }
  if (!limitsBehaviors.has(value.limitsBehavior as CustomSymbolLimitsBehavior)) {
    throw new Error("Custom symbol has an invalid limits behavior.");
  }
  if (!isRecord(value.artwork) || !Array.isArray(value.artwork.shapes)) {
    throw new Error("Custom symbol artwork is missing.");
  }
  if (
    value.artwork.shapes.length === 0 ||
    value.artwork.shapes.length > maximumCompiledArtworkShapes
  ) {
    throw new Error("Custom symbol artwork has an invalid number of shapes.");
  }
  const ommlFallback =
    value.ommlFallback == null
      ? null
      : typeof value.ommlFallback === "string"
        ? value.ommlFallback.trim()
        : null;
  if (ommlFallback && ommlFallback.length > maximumFallbackLength) {
    throw new Error("Custom symbol Word fallback is too large.");
  }
  const now = Date.now();
  return {
    id,
    command,
    name,
    role: value.role as CustomSymbolMathRole,
    limitsBehavior: value.limitsBehavior as CustomSymbolLimitsBehavior,
    metrics: normalizeMetrics(value.metrics),
    artwork: {
      shapes: value.artwork.shapes.map(normalizeShape),
    },
    ...normalizeOperatorGeometry(value),
    ommlFallback,
    designerSource: normalizeDesignerSource(value.designerSource),
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : now,
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : now,
  };
}

function emptyUserLibrary(): CustomSymbolLibrary {
  return { version: CUSTOM_SYMBOL_LIBRARY_VERSION, symbols: [] };
}

/** The user's library, checked: every symbol valid, no id or command twice. */
export function normalizeCustomSymbolLibrary(value: unknown): CustomSymbolLibrary {
  if (value === undefined || value === null) return emptyUserLibrary();
  if (!isRecord(value) || value.version !== CUSTOM_SYMBOL_LIBRARY_VERSION || !Array.isArray(value.symbols)) {
    throw new Error(`The custom symbol library is not a version ${CUSTOM_SYMBOL_LIBRARY_VERSION} library.`);
  }
  const ids = new Set<string>();
  const commands = new Set<string>();
  const symbols = value.symbols.map((candidate, index) => {
    let symbol: CustomSymbolDefinition;
    try {
      symbol = normalizeDefinition(candidate);
    } catch (error) {
      throw new Error(`Custom symbol ${index + 1}: ${(error as Error).message}`);
    }
    if (ids.has(symbol.id)) throw new Error(`Custom symbol ${index + 1}: the identifier ${symbol.id} is used twice.`);
    if (commands.has(symbol.command)) throw new Error(`Custom symbol ${index + 1}: \\${symbol.command} is used twice.`);
    ids.add(symbol.id);
    commands.add(symbol.command);
    return symbol;
  });
  return { version: CUSTOM_SYMBOL_LIBRARY_VERSION, symbols };
}
