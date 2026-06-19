import { AmbientGradient } from "@/components/ambient-gradient";
import { Studio } from "@/components/studio/studio";

export default function Home() {
  return (
    <main className="bg-grain relative isolate flex-1 overflow-hidden">
      <AmbientGradient />
      <div className="bg-blueprint pointer-events-none absolute inset-0 -z-10 opacity-40" />

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        {/* Masthead */}
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <span
              className="relative grid size-7 place-items-center rounded-full border border-border"
              aria-hidden
            >
              <span className="size-2.5 rounded-full bg-muted-foreground" />
            </span>
            <span className="font-display text-sm font-semibold tracking-[0.22em] text-foreground">
              APERTURE
            </span>
          </div>
          <span className="rounded-full border border-border bg-card/60 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground backdrop-blur-sm">
            code-only · no uploads
          </span>
        </header>

        {/* Hero — the thesis */}
        <section className="pt-8 pb-9 sm:pt-12 sm:pb-12">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-muted-foreground">
            Paper&nbsp;·&nbsp;Shaders&nbsp;—&nbsp;React
          </p>
          <h1 className="mt-5 max-w-[16ch] text-balance font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-7xl">
            A darkroom for WebGL shaders.
          </h1>
          <p className="mt-6 max-w-[60ch] text-base leading-relaxed text-muted-foreground sm:text-lg">
            Drop in a photo, run it through any shader in{" "}
            <span className="font-mono text-foreground/90">
              @paper-design/shaders-react
            </span>
            , tune every parameter live, and export the result — all in your
            browser. Nothing is uploaded.
          </p>
        </section>

        {/* The studio */}
        <section className="pb-16">
          <Studio sampleSrc="/sample.jpg" />
        </section>
      </div>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-7 font-mono text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>
            <span className="text-foreground/80">
              npm i @paper-design/shaders-react
            </span>
            <span className="mx-2 text-border">·</span>
            pin exactly — breaking changes ship under 0.0.x
          </span>
          <span className="text-muted-foreground">
            shaders.paper.design · processed entirely client-side
          </span>
        </div>
      </footer>
    </main>
  );
}
