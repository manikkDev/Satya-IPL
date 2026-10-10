import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Shield, Search, MessageCircle, AlertTriangle, Network, FileText, GitBranch, Lock, Scale } from "lucide-react";

const features = [
  { icon: GitBranch, title: "Horizontal FL Research Runner", description: "Five research partitions benchmark FedAvg and FedProx with live per-round convergence. Process-isolated institution clients are the current implementation gate." },
  { icon: Lock, title: "Measured Privacy Controls", description: "Institution-update clipping and central-DP accounting report a measured privacy budget (ε, δ). The current pairwise-mask SecAgg path is transparently labelled as a simulation." },
  { icon: Search, title: "Vertical Collaboration Benchmark", description: "An educational PSI alignment and feature-union benchmark measures the potential gain from bank, insurer and lender feature slices; distributed split learning is the next implementation gate." },
  { icon: Network, title: "Pseudonymised Risk Graph", description: "Neo4j stores derived research intelligence — pseudonymous account nodes, scored relationships and versioned community evidence — without raw source identifiers." },
  { icon: AlertTriangle, title: "Explainable Risk Scores", description: "Analysts get per-customer scores with signed feature contributions; citizens get plain-language explanations, not black-box verdicts." },
  { icon: Scale, title: "Consent & DPDP Rights", description: "Purpose-level consent for scoring, monitoring and training. Erasure requests and full audit trails are first-class API citizens." },
];

const FeatureCard = ({ feature, index }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const Icon = feature.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="glass-card glow-border-hover p-8 rounded-2xl group cursor-default"
    >
      <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center mb-5 group-hover:bg-primary/25 transition-colors duration-500">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <h3 className="font-heading text-lg font-semibold text-foreground mb-3">{feature.title}</h3>
      <p className="font-body text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
    </motion.div>
  );
};

const FeaturesSection = () => {
  return (
    <section id="features" className="section-spacing relative">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="font-heading text-3xl md:text-5xl font-bold text-foreground mb-4">
            Federated <span className="text-gradient-primary">Risk Intelligence</span>
          </h2>
          <p className="font-body text-muted-foreground text-lg max-w-xl mx-auto">
            Privacy infrastructure and machine learning working together — provably, not by promise.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <FeatureCard key={feature.title} feature={feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
