"use client";

import { useState } from "react";
import { ShaderPicker } from "@/components/studio/shader-picker";
import { ParamControl } from "@/components/studio/param-control";
import { PresetRow } from "@/components/studio/preset-row";
import {
  buildShareUrl,
  copyShareLink,
} from "@/components/studio/use-url-state";
import {
  initialValues,
  type Shader,
  type ParamValue,
  type ParamValues,
} from "@/lib/studio/registry";

const FOOTER_BTN =
  "font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface Props {
  shader: Shader;
  values: ParamValues;
  onSelectShader: (id: string) => void;
  onChange: (name: string, value: ParamValue) => void;
  onReplaceValues: (values: ParamValues) => void;
}

export function ControlPanel({
  shader,
  values,
  onSelectShader,
  onChange,
  onReplaceValues,
}: Props) {
  const colorParams = shader.params.filter(
    (p) => p.control === "color" || p.control === "palette",
  );
  const valueParams = shader.params.filter(
    (p) => p.control === "range" || p.control === "enum",
  );
  const toggleParams = shader.params.filter((p) => p.control === "boolean");

  const [copied, setCopied] = useState(false);
  const reset = () => onReplaceValues(initialValues(shader));

  const share = async () => {
    const url = buildShareUrl({ shaderId: shader.id, values });
    const ok = await copyShareLink(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const randomize = () => {
    const next: ParamValues = { ...initialValues(shader) };
    for (const p of shader.params) {
      if (p.control === "range") {
        const raw = p.min + Math.random() * (p.max - p.min);
        next[p.name] =
          p.step >= 1 ? Math.round(raw) : Math.round(raw * 100) / 100;
      } else if (p.control === "boolean") {
        next[p.name] = Math.random() > 0.5;
      } else if (p.control === "enum") {
        next[p.name] = p.options[Math.floor(Math.random() * p.options.length)];
      } else if (p.control === "color") {
        next[p.name] = randomHex();
      } else if (p.control === "palette") {
        const len = Array.isArray(p.default) ? p.default.length : 4;
        next[p.name] = Array.from({ length: len }, randomHex);
      }
    }
    onReplaceValues(next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 pb-4 pt-4">
        <ShaderPicker activeId={shader.id} onSelect={onSelectShader} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4">
          <h2 className="font-display text-[15px] font-medium capitalize tracking-tight text-foreground">
            {shader.id.replace(/-/g, " ")}
          </h2>
          {shader.blurb && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {shader.blurb}
            </p>
          )}
        </div>

        <PresetRow
          shader={shader}
          values={values}
          onReplaceValues={onReplaceValues}
        />

        {(valueParams.length > 0 || toggleParams.length > 0) && (
          <Section title="Adjust">
            {valueParams.map((p) => (
              <ParamControl
                key={p.name}
                param={p}
                value={values[p.name]}
                onChange={onChange}
              />
            ))}
            {toggleParams.length > 0 && (
              <div className="space-y-1 border-t border-border/60 pt-3">
                {toggleParams.map((p) => (
                  <ParamControl
                    key={p.name}
                    param={p}
                    value={values[p.name]}
                    onChange={(v) => onChange(p.name, v)}
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        {colorParams.length > 0 && (
          <Section title="Color">
            {colorParams.map((p) => (
              <ParamControl
                key={p.name}
                param={p}
                value={values[p.name]}
                onChange={onChange}
              />
            ))}
          </Section>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <button type="button" onClick={reset} className={FOOTER_BTN}>
          Reset all
        </button>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={share}
            aria-label="Copy a shareable link to this look"
            className={FOOTER_BTN}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" onClick={randomize} className={FOOTER_BTN}>
            Randomize
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-3 border-b border-border pb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}

function randomHex(): string {
  const h = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `#${h}`;
}
