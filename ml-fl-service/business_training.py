"""Compatibility import and offline training entry point."""
import sys
import runpy

if __name__ == "__main__":
    runpy.run_module("satya_engine.business_training", run_name="__main__")
else:
    from satya_engine import business_training

    sys.modules[__name__] = business_training
