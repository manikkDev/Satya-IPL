const FooterCTA = () => {
  return (
    <section className="py-24 md:py-32 bg-background">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl md:text-[44px] leading-[1.15] font-serif text-foreground">
          Built to learn what
          <br />
          <span className="font-bold">no institution can see alone.</span>
        </h2>
        <p className="mt-4 text-base text-muted-foreground">
          Arth Saathi — privacy-preserving federated risk intelligence
        </p>
        <div className="mt-8">
          <a href="/signup" className="btn-primary animate-glow-pulse">
            Explore the Demo ↗
          </a>
        </div>
      </div>

      {/* Footer bar */}
      <div className="mt-24 border-t border-border">
        <div className="mx-auto max-w-6xl px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground font-mono">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />
            <span className="font-serif text-foreground text-sm">Arth Saathi</span>
          </div>
          <p>© 2026 · Arth Saathi</p>
          <a href="#" className="text-primary hover:underline">GitHub ↗</a>
        </div>
      </div>
    </section>
  );
};

export default FooterCTA;
