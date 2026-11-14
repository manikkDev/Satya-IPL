"""Deterministic document extraction: IRP signed-QR decode, PDF text-layer
field parsing, and evidence fusion with decomposed per-field confidence.

Runtime-light by design (pypdfium2 / zxing-cpp / cryptography only). No LLM
calls happen here: a vision-LLM result produced elsewhere (the gateway) can be
passed to :func:`fuse.fuse`, where it is treated as one more, weaker, source.
"""
