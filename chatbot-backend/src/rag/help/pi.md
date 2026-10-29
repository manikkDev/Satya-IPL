# Proforma Invoice (PI)

A proforma invoice is a commercial quote/advance-request from the supplier.
It is NOT a tax invoice — it cannot be used to claim GST input credit.
Suppliers commonly ask for advance payment against a PI for custom
engineering goods. Classic leak: the advance is paid against the PI but
never adjusted when the final tax invoice arrives — the buyer pays twice.
Satya flags advances that were not adjusted (DUP_ADVANCE_NOT_ADJUSTED).
