"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, SHADERS_BY_ID, type Shader } from "@/lib/studio/registry";

const FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function ShaderPicker({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const activeCat = SHADERS_BY_ID[activeId]?.category ?? "image-filter";
  const [cat, setCat] = useState<Shader["category"]>(activeCat);

  // follow programmatic shader changes that cross categories
  useEffect(() => {
    setCat(activeCat);
  }, [activeCat]);

  const group = CATEGORIES.find((c) => c.key === cat) ?? CATEGORIES[0];

  return (
    <div>
      <div className="flex gap-1" role="group" aria-label="Shader category">
        {CATEGORIES.map((c) => {
          const active = c.key === cat;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setCat(c.key)}
              className={`flex-1 rounded-md px-2 py-2 text-center font-mono text-[10px] uppercase tracking-[0.12em] transition-colors sm:py-1.5 ${FOCUS} ${
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {group.hint}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {group.shaders.map((s) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={active}
              title={s.blurb}
              onClick={() => onSelect(s.id)}
              className={`rounded-md border px-2.5 py-2 text-[12px] transition-colors sm:py-1.5 ${FOCUS} ${
                active
                  ? "border-foreground/30 bg-foreground/10 text-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.id.replace(/-/g, " ")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
