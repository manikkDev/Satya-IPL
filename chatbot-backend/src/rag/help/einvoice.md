# e-Invoice / IRN

An e-invoice is a tax invoice reported to a government Invoice Registration
Portal (IRP), which returns an IRN (a 64-character hash) and a digitally
signed QR code. Required when supplier turnover exceeds the threshold
(currently ₹5 crore). From 1 Apr 2025 taxpayers with AATO ≥ ₹10 crore
cannot report invoices older than 30 days. Satya verifies the signed QR
when present — a well-formed IRN is not the same as an active one.
