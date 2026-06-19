import * as ShadersReact from "@paper-design/shaders-react";
import {
  SHADERS_BY_ID,
  type Param,
  type ParamValue,
  type ParamValues,
  type Shader,
} from "@/lib/studio/registry";

/**
 * A quick-apply preset for one shader: a display name plus the subset of
 * normalized param values it sets. Values are pre-validated against the
 * registry (ranges clamped, enums verified, types coerced) so applying one is
 * a plain `replaceValues`.
 */
export interface ShaderPreset {
  name: string;
  values: ParamValues;
}

/** Raw shape of the library's exported preset entries (`*Presets` arrays). */
interface RawLibraryPreset {
  name: string;
  params: Record<string, unknown>;
}

/**
 * The paper-shaders module is a flat namespace; the preset arrays are exported
 * as `<camelComponent>Presets` (e.g. `MeshGradient` -> `meshGradientPresets`).
 * Treat it as an indexable map for the dynamic lookup — `as unknown as` (NOT
 * `any`) is the one narrow assertion needed to reshape the typed namespace.
 */
const presetsMap = ShadersReact as unknown as Record<string, unknown>;

function presetsExportKey(component: string): string {
  return `${component.charAt(0).toLowerCase()}${component.slice(1)}Presets`;
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Coerce one raw library preset value into a valid value for the given param,
 * validating against the registry. Returns `null` when the raw value can't be
 * sensibly mapped (so the caller drops it and keeps the param's current value).
 */
export function coercePresetValue(param: Param, raw: unknown): ParamValue | null {
  switch (param.control) {
    case "range": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return null;
      return clamp(n, param.min, param.max);
    }
    case "boolean":
      return typeof raw === "boolean" ? raw : null;
    case "enum":
      return typeof raw === "string" && param.options.includes(raw) ? raw : null;
    case "color":
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    case "palette": {
      if (!Array.isArray(raw)) return null;
      const colors = raw.filter((c): c is string => typeof c === "string");
      return colors.length > 0 ? colors : null;
    }
    default:
      return null;
  }
}

/**
 * Map a raw library preset into a registry-validated `{ name, values }`. Only
 * params that exist in the catalog are kept; unknown preset keys are dropped,
 * out-of-range numbers are clamped, invalid enums fall back to nothing for that
 * key (the param keeps whatever value it already has when applied as a patch).
 */
function mapPreset(shader: Shader, raw: RawLibraryPreset): ShaderPreset {
  const values: ParamValues = {};
  for (const param of shader.params) {
    if (!(param.name in raw.params)) continue;
    const coerced = coercePresetValue(param, raw.params[param.name]);
    if (coerced !== null) values[param.name] = coerced;
  }
  return { name: raw.name || "Preset", values };
}

function isRawPreset(v: unknown): v is RawLibraryPreset {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as RawLibraryPreset).name === "string" &&
    typeof (v as RawLibraryPreset).params === "object" &&
    (v as RawLibraryPreset).params !== null
  );
}

/**
 * The library's presets for a shader, mapped/validated against the registry.
 * Returns `[]` for a shader id with no exported presets (or an unknown id) so
 * the UI can simply skip the row.
 */
export function presetsFor(shaderId: string): ShaderPreset[] {
  const shader = SHADERS_BY_ID[shaderId];
  if (!shader) return [];
  const raw = presetsMap[presetsExportKey(shader.component)];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRawPreset).map((p) => mapPreset(shader, p));
}

/**
 * Whether `values` already match `preset.values` (so the chip can show as
 * active). Compares only the keys the preset sets; numbers within an epsilon,
 * arrays element-wise.
 */
export function valuesMatchPreset(
  values: ParamValues,
  preset: ShaderPreset,
): boolean {
  for (const key of Object.keys(preset.values)) {
    const a = values[key];
    const b = preset.values[key];
    if (Array.isArray(b)) {
      if (!Array.isArray(a) || a.length !== b.length) return false;
      for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
    } else if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > 1e-4) return false;
    } else if (a !== b) {
      return false;
    }
  }
  return true;
}
