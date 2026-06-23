import { AmbientGradient } from "@/components/ambient-gradient";
import { Studio } from "@/components/studio/studio";

export default function Home() {
  return (
    <main className="bg-grain relative isolate flex-1 overflow-hidden">
      <AmbientGradient />

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
            Runs in your browser
          </span>
        </header>

        {/* Hero — the thesis */}
        <section className="pt-8 pb-10 sm:pt-12 sm:pb-14">
          <p className="font-mono text-xs uppercase tracking-[0.32em] text-muted-foreground">
            Real-time image shaders
          </p>
          <h1 className="mt-5 max-w-[16ch] text-balance font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-7xl">
            A darkroom for WebGL shaders.
          </h1>
          <p className="mt-7 max-w-[54ch] text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Drop in a photo and push it through real-time effects — dither it,
            halftone it, melt it through fluted glass and liquid metal, and two
            dozen more. Tune every dial live, drag to compare before and after,
            then download at full resolution. It all runs on your machine; the
            photo never leaves your browser.
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
            <span className="text-foreground/80">Your photos never leave your browser</span>
            <span className="mx-2 text-border">·</span>
            no account, no upload
          </span>
          <span className="text-muted-foreground">
            Built on @paper-design/shaders-react · pinned 0.0.x
          </span>
        </div>
      </footer>
    </main>
  );
}
