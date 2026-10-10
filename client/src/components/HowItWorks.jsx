import useScrollReveal from "@/hooks/useScrollReveal";
import CircularFlowDiagram from "./CircularFlowDiagram";

const steps = [
  {
    num: "01",
    title: "Partition",
    subtitle: "Versioned research data, five institutions",
    body: "5.7M PaySim transactions — synthetic data calibrated from aggregated mobile-money patterns — are checksum-verified and partitioned across five simulated banks. Customer IDs are pseudonymised with a keyed hash.",
  },
  {
    num: "02",
    title: "Train by partition",
    subtitle: "Current benchmark, target isolation",
    body: "The research runner executes local optimization for each partition and aggregates parameter deltas. Separate institution processes and coordinator-inaccessible storage are required before production privacy claims.",
  },
  {
    num: "03",
    title: "Aggregate",
    subtitle: "Aggregation privacy research",
    body: "The current prototype measures institution-update clipping and differential privacy. Its pairwise-mask path is an explicitly labelled SecAgg simulation while the production protocol is being integrated.",
  },
  {
    num: "04",
    title: "Converge",
    subtitle: "A shared global model",
    body: "Rounds repeat until the federated model approaches the centralized ceiling — measurably better than any bank training alone, with PR-AUC tracked per round.",
  },
  {
    num: "05",
    title: "Explain & consent",
    subtitle: "Scores people can trust",
    body: "Analysts see feature-level explanations and a pseudonymised risk graph. Citizens see their band, plain-language reasons, and consent controls they actually own.",
  },
];

const HowItWorksSection = () => {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      id="how-it-works"
      className="py-24 md:py-32 bg-secondary"
    >
      <div
        ref={ref}
        className="mx-auto max-w-6xl px-6"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(24px)",
          transition: "all 0.6s ease",
        }}
      >
        {/* Header row: text left, diagram right */}
        <div className="grid md:grid-cols-2 gap-12 items-center mb-14">
          <div>
            <span className="text-8xl font-mono text-primary text-bold mb-2">HOW IT WORKS</span>
            <h2 className="mt-6 text-3xl md:text-[42px] leading-[1.15] font-serif text-foreground">
              From siloed ledgers
              <br />
              <span className="font-bold">to one shared risk model.</span>
            </h2>
          </div>
          <div className="flex justify-center md:justify-end">
            <div className="float-card animate-idle-float p-5 w-full max-w-[280px]">
              <CircularFlowDiagram />
            </div>
          </div>
        </div>

        {/* Steps grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {steps.map((s, i) => (
            <div
              key={s.num}
              className="glass-card !p-5 flex flex-col"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <span className="text-2xl font-mono text-primary mb-2" style={{ opacity: 0.3 }}>
                {s.num}
              </span>
              <h3 className="text-base font-serif text-foreground">
                {s.title}
              </h3>
              <p className="text-xs font-mono text-primary mb-2">{s.subtitle}</p>
              <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
