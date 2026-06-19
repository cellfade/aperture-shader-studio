"use client";

import { memo } from "react";
import {
  getComponent,
  type Shader,
  type ParamValues,
} from "@/lib/studio/registry";
import { useReducedMotion } from "@/lib/studio/use-media-query";

interface ShaderViewProps {
  shader: Shader;
  values: ParamValues;
  imageUrl?: string | null;
  className?: string;
}

/** Renders any catalog shader with the current param values, filling its parent. */
function ShaderViewImpl({ shader, values, imageUrl, className }: ShaderViewProps) {
  const reduced = useReducedMotion();
  const Comp = getComponent(shader.component);
  if (!Comp) return null;

  const props: Record<string, unknown> = {
    ...values,
    fit: "cover",
    style: { width: "100%", height: "100%", display: "block" },
  };
  // Freeze animated shaders for users who prefer reduced motion (matches export).
  if (reduced && "speed" in props) props.speed = 0;
  if (shader.takesImage && imageUrl) props.image = imageUrl;

  const label = `${shader.id.replace(/-/g, " ")} shader${
    imageUrl ? " applied to the loaded photo" : ""
  }`;

  // `Comp` is a stable registry component: `getComponent` is a module-level
  // memoized lookup into the paper-shaders map, not a component created during
  // render, so it is referentially stable across renders.
  // eslint-disable-next-line react-hooks/static-components
  return <Comp className={className} role="img" aria-label={label} {...props} />;
}

export const ShaderView = memo(ShaderViewImpl);
