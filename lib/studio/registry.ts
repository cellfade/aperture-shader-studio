import type { ComponentType } from "react";
import * as ShadersReact from "@paper-design/shaders-react";
import catalog from "@/lib/shader-catalog.json";

export type ParamControl = "range" | "color" | "enum" | "boolean" | "palette";

export interface RawParam {
  name: string;
  control: "range" | "color" | "enum" | "boolean";
  min?: number | null;
  max?: number | null;
  step?: number | null;
  default?: unknown;
  options?: string[];
  note?: string;
}

export interface RawShader {
  id: string;
  component: string;
  category: "image-filter" | "generative" | "logo";
  takesImage: boolean;
  blurb?: string;
  hasMeta?: boolean;
  hasPresets?: boolean;
  presetNames?: string[];
  params: RawParam[];
}

export interface Param {
  name: string;
  label: string;
  control: ParamControl;
  min: number;
  max: number;
  step: number;
  options: string[];
  default: number | string | boolean | string[];
  note?: string;
}

export interface Shader {
  id: string;
  component: string;
  category: "image-filter" | "generative" | "logo";
  takesImage: boolean;
  blurb: string;
  params: Param[];
}

export type ParamValue = number | string | boolean | string[];
export type ParamValues = Record<string, ParamValue>;

const DEFAULT_PALETTE = ["#9ee7ff", "#5100ff", "#00ff80", "#ffcc00"];

const componentMap = ShadersReact as unknown as Record<
  string,
  ComponentType<Record<string, unknown>>
>;

/** Pretty label from a camelCase param name: "colorHighlight" -> "Color highlight" */
function toLabel(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function normalizeParam(p: RawParam): Param | null {
  // `image` is wired to the upload, never a normal control (catalog mistypes it as boolean).
  if (p.name === "image") return null;

  // `colors` is a color *array* in the library — render it as a palette editor.
  const isPalette = p.name === "colors";
  const control: ParamControl = isPalette ? "palette" : p.control;

  let def: ParamValue;
  if (isPalette) {
    def = Array.isArray(p.default) ? (p.default as string[]) : DEFAULT_PALETTE;
  } else if (control === "range") {
    const min = p.min ?? 0;
    const max = p.max ?? 1;
    def =
      typeof p.default === "number"
        ? (p.default as number)
        : Math.round(((min + max) / 2) * 100) / 100;
  } else if (control === "color") {
    def = typeof p.default === "string" ? (p.default as string) : "#9ee7ff";
  } else if (control === "enum") {
    def =
      typeof p.default === "string" && p.options?.includes(p.default as string)
        ? (p.default as string)
        : p.options?.[0] ?? "";
  } else {
    def = typeof p.default === "boolean" ? (p.default as boolean) : false;
  }

  return {
    name: p.name,
    label: toLabel(p.name),
    control,
    min: p.min ?? 0,
    max: p.max ?? 1,
    step: p.step ?? 0.01,
    options: p.options ?? [],
    default: def,
    note: p.note,
  };
}

export const SHADERS: Shader[] = (catalog.shaders as RawShader[]).map((s) => ({
  id: s.id,
  component: s.component,
  category: s.category,
  takesImage: s.takesImage,
  blurb: s.blurb ?? "",
  params: s.params.map(normalizeParam).filter((p): p is Param => p !== null),
}));

export const SHADERS_BY_ID: Record<string, Shader> = Object.fromEntries(
  SHADERS.map((s) => [s.id, s]),
);

/** Curated ordering — lead with image-driven effects, then the generative range. */
const FEATURED_ORDER = [
  "image-dithering",
  "halftone-cmyk",
  "fluted-glass",
  "halftone-dots",
  "water",
  "liquid-metal",
  "gem-smoke",
  "heatmap",
  "paper-texture",
];

function orderWithin(list: Shader[]): Shader[] {
  return [...list].sort((a, b) => {
    const ia = FEATURED_ORDER.indexOf(a.id);
    const ib = FEATURED_ORDER.indexOf(b.id);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    }
    return a.id.localeCompare(b.id);
  });
}

export const CATEGORIES: {
  key: Shader["category"];
  label: string;
  hint: string;
  shaders: Shader[];
}[] = [
  {
    key: "image-filter",
    label: "Image filters",
    hint: "Transform your photo",
    shaders: orderWithin(SHADERS.filter((s) => s.category === "image-filter")),
  },
  {
    key: "logo",
    label: "Logo",
    hint: "Photo or built-in shape",
    shaders: orderWithin(SHADERS.filter((s) => s.category === "logo")),
  },
  {
    key: "generative",
    label: "Generative",
    hint: "Render their own art",
    shaders: orderWithin(SHADERS.filter((s) => s.category === "generative")),
  },
];

export const DEFAULT_SHADER_ID = "image-dithering";

export function initialValues(shader: Shader): ParamValues {
  const v: ParamValues = {};
  for (const p of shader.params) v[p.name] = p.default;
  return v;
}

export function getComponent(
  name: string,
): ComponentType<Record<string, unknown>> | null {
  return componentMap[name] ?? null;
}
