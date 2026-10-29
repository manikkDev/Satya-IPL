# Uploading documents

Drag any file into Documents: PDF, image, CSV, Excel or e-invoice JSON.
Satya parses it deterministically first (QR/e-invoice, text layer), asks
the LLM only when needed, extracts fields with quotes and confidence, and
queues low-confidence fields for human review before they become records.
