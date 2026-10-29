"""Compatibility import; implementation lives in satya_engine."""
import sys

from satya_engine import business_imports

sys.modules[__name__] = business_imports
