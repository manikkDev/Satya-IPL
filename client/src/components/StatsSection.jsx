import useCountUp from "@/hooks/useCountUp";

const stats = [
  { end: 6, suffix: "M+", label: "Versioned PaySim research transactions" },
  { end: 5, suffix: "", label: "Isolated institution partitions (real SecAgg+)" },
  { end: 66, suffix: "%", label: "Federated PR-AUC on the untouched test split (run flwr_residual_v1)" },
  { end: 52, suffix: "", label: "Automated checks passing (26 Python · 18 copilot · 8 API)" },
];

const StatsSection = () => {
  return (
    <section className="py-16 bg-primary">
      <div className="mx-auto max-w-6xl px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {stats.map((s, i) => (
          <StatItem key={i} {...s} />
        ))}
      </div>
    </section>
  );
};

const StatItem = ({ end, suffix, label }) => {
  const { count, ref } = useCountUp(end);

  return (
    <div ref={ref}>
      <p className="text-4xl md:text-[56px] font-mono text-primary-foreground font-semibold">
        {count}{suffix}
      </p>
      <p className="text-sm text-primary-foreground mt-1" style={{ opacity: 0.85 }}>
        {label}
      </p>
    </div>
  );
};

export default StatsSection;
