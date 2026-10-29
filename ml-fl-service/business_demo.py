"""Compatibility import; implementation lives in satya_engine."""
import sys

from satya_engine import business_demo

sys.modules[__name__] = business_demo
