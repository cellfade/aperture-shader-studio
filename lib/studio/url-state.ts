import {
  SHADERS_BY_ID,
  type Param,
  type ParamValue,
  type ParamValues,
} from "@/lib/studio/registry";

/**
 * Shareable studio state encoded in the URL hash: the active shader id and its
 * param values. The loaded image/video is NEVER encoded — only the look. A
 * recipient opening the link gets the shader + params and loads their own photo.
 */
export interface UrlState {
  shaderId: string;
  values: ParamValues;
}

const SHADER_KEY = "s";
const PARAMS_KEY = "p";

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Encode one param value to a compact string token. */
function encodeValue(value: ParamValue): string {
  if (typeof value === "number") {
    // Trim float noise; keep it short but lossless-enough for sliders.
    return String(Math.round(value * 1e4) / 1e4);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (Array.isArray(value)) return value.join("~");
  return value;
}

/** Decode + validate a raw token against the param's control/range. */
function decodeValue(param: Param, token: string): ParamValue | null {
  switch (param.control) {
    case "range": {
      const n = Number(token);
      if (!Number.isFinite(n)) return null;
      return clamp(n, param.min, param.max);
    }
    case "boolean":
      return token === "1" ? true : token === "0" ? false : null;
    case "enum":
      return param.options.includes(token) ? token : null;
    case "color":
      return token.length > 0 ? token : null;
    case "palette": {
      const colors = token.split("~").filter((c) => c.length > 0);
      return colors.length > 0 ? colors : null;
    }
    default:
      return null;
  }
}

/**
 * Encode state to a hash string (without the leading `#`), e.g.
 * `s=image-dithering&p=size:1.5,type:random,colorFront:%23a2997c`. Only params
 * known to the shader are written. Returns `""` for an unknown shader id.
 */
export function encodeState(state: UrlState): string {
  const shader = SHADERS_BY_ID[state.shaderId];
  if (!shader) return "";
  const known = new Map<string, Param>(shader.params.map((p) => [p.name, p]));
  const parts: string[] = [];
  for (const [name, value] of Object.entries(state.values)) {
    if (!known.has(name)) continue;
    parts.push(`${name}:${encodeURIComponent(encodeValue(value))}`);
  }
  const params = new URLSearchParams();
  params.set(SHADER_KEY, state.shaderId);
  if (parts.length > 0) params.set(PARAMS_KEY, parts.join(","));
  return params.toString();
}

/**
 * Decode a hash string (with or without a leading `#`) into validated state, or
 * `null` when there is no usable shader. Defensive: an unknown shader id, a
 * malformed hash, unknown param keys, or out-of-range values never throw —
 * unknown keys are dropped and out-of-range numbers clamped via the registry.
 */
export function decodeState(hash: string): UrlState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }

  const shaderId = params.get(SHADER_KEY);
  if (!shaderId) return null;
  const shader = SHADERS_BY_ID[shaderId];
  if (!shader) return null;

  const known = new Map<string, Param>(shader.params.map((p) => [p.name, p]));
  const values: ParamValues = {};
  const blob = params.get(PARAMS_KEY) ?? "";
  for (const pair of blob.split(",")) {
    if (!pair) continue;
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const name = pair.slice(0, idx);
    const param = known.get(name);
    if (!param) continue; // drop unknown keys
    let token: string;
    try {
      token = decodeURIComponent(pair.slice(idx + 1));
    } catch {
      continue; // malformed escape — drop this key, keep the rest
    }
    const decoded = decodeValue(param, token);
    if (decoded !== null) values[name] = decoded;
  }

  return { shaderId, values };
}
