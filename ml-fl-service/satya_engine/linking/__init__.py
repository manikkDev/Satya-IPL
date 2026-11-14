"""Live document linking (v2): block -> featurize -> score -> calibrate -> zone.

INVOICE_IN -> PO (BILLS), GRN -> PO (RECEIVES), PAYMENT_OUT -> INVOICE_IN
(SETTLES). Trained offline (satya_engine.linking.train) on synthetic,
BPI-2019-derived and curated-demo data; artifacts live in models/link_*/.
"""
