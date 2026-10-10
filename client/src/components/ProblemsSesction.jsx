import useScrollReveal from "@/hooks/useScrollReveal";

const txRows = [
  { from: "Bank", to: "repayment history", amount: "Siloed" },
  { from: "Insurer", to: "claims history", amount: "Siloed" },
  { from: "Lending app", to: "spending patterns", amount: "Siloed" },
];

const ProblemSection = () => {
  const { ref: sectionRef, isVisible: sectionVisible } = useScrollReveal();
  const { ref: cardRef, isVisible: cardVisible } = useScrollReveal();

  return (
    <section
      id="about"
      className="py-24 md:py-32 bg-secondary"
    >
      <div
        ref={sectionRef}
        className="mx-auto max-w-6xl px-6 grid md:grid-cols-2 gap-12 items-center"
        style={{
          opacity: sectionVisible ? 1 : 0,
          transform: sectionVisible ? "translateY(0)" : "translateY(24px)",
          transition: "all 0.6s ease",
        }}
      >
        {/* Left text */}
        <div>
          <span className="text-8xl font-mono text-primary text-bold mb-2">
            THE PROBLEM
          </span>
          <h2 className="mt-6 text-3xl md:text-[42px] leading-[1.15] text-foreground font-serif">
            Every institution sees a slice.
            <br />
            <span className="font-bold">Nobody can pool it legally.</span>
          </h2>
          <p className="mt-6 text-[15px] leading-[1.8] text-muted-foreground max-w-md">
            A customer's financial life is split across a bank, an insurer and a lending app. Moving raw data across institutions breaks the DPDP Act and RBI localization rules — so each trains on thin, siloed data and misses the fraud rings that span them all.
          </p>
          <a
            href="#how-it-works"
            className="mt-6 inline-block text-sm text-primary hover:underline"
          >
            See how federated learning fixes this →
          </a>
        </div>

        {/* Right floating card */}
        <div
          className="flex justify-center md:justify-end"
          ref={cardRef}
          style={{
            opacity: cardVisible ? 1 : 0,
            transform: cardVisible ? "translateX(0)" : "translateX(28px)",
            transition: "opacity 0.6s ease, transform 0.6s ease",
          }}
        >
          <div className="float-card animate-idle-float p-6 w-full max-w-sm" style={{ transform: "rotate(-2deg)" }}>
            <span className="pill-badge mb-4">ILLUSTRATIVE SYNTHETIC SCENARIO</span>
            <h3 className="mt-4 text-xl font-serif text-foreground">
              Mule Network 3f8a…c91d
            </h3>
            <p className="text-xs font-mono text-muted-foreground mt-1">
              Designed to demonstrate a future multi-institution signal
            </p>
            <p className="mt-4 text-4xl font-mono text-destructive font-semibold">
              94 <span className="text-lg text-muted-foreground font-normal">/ 100</span>
            </p>

            <div className="mt-6 space-y-0">
              {txRows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-3 border-b border-border text-sm"
                >
                  <span className="text-foreground">
                    {row.from} → {row.to}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {row.amount}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <span className="pill-badge-red">Pseudonymised · derived signals only</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProblemSection;
