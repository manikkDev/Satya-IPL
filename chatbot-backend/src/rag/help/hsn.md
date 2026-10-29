# HSN codes and GST rates

HSN codes classify goods for GST. Rates are effective-dated per HSN (and
sometimes conditional), so Satya loads them from the official CBIC master,
never from memory. Invoice lines need 4-digit HSN up to ₹5 crore turnover
and 6-digit above it. A wrong HSN silently produces the wrong GST.
