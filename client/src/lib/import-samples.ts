import type { CsvKind } from "./import-helpers";

export const sampleOrderId = "DEMO-PO-6101";
export const sampleTitle = "Pump order · deliveries, duplicate invoice and payments";
export const importSamples: { name: string; recordType: CsvKind; label: string; content: string }[] = [
  { name:"sample-purchase-orders.csv", recordType:"PO", label:"Purchase order · 100 pumps", content:`id,reference,supplier,currency,occurredAt,observedAt,status,dueAt,lineId,description,sku,quantity,unitPrice,uom,coverage
DEMO-PO-6101,DEMO/PO/6101,Example Pump Supplier,INR,2026-10-01T10:00:00+05:30,2026-10-01T10:00:00+05:30,approved,2026-10-30T18:00:00+05:30,1,Water pump 1 kW,PUMP-1KW,100,1000.00,EA,complete
` },
  { name:"sample-delivery-receipts.csv", recordType:"GRN", label:"Delivery receipts · 40 + 20 pumps", content:`id,reference,supplier,currency,occurredAt,observedAt,status,poId,lineId,description,sku,quantity,acceptedQuantity,uom,poLineId,coverage
DEMO-GRN-6101,DEMO/GRN/6101,Example Pump Supplier,INR,2026-10-02T10:00:00+05:30,2026-10-02T10:00:00+05:30,posted,DEMO-PO-6101,1,Water pump 1 kW,PUMP-1KW,40,40,EA,1,complete
DEMO-GRN-6102,DEMO/GRN/6102,Example Pump Supplier,INR,2026-10-03T10:00:00+05:30,2026-10-03T10:00:00+05:30,posted,DEMO-PO-6101,1,Water pump 1 kW,PUMP-1KW,20,20,EA,1,complete
` },
  { name:"sample-invoices.csv", recordType:"INVOICE", label:"Invoices · one possible duplicate", content:`id,reference,supplier,currency,occurredAt,observedAt,status,poId,amount,netAmount,taxCGST,taxSGST,lineId,description,sku,quantity,unitPrice,uom,poLineId
DEMO-INVOICE-6101,DEMO/INV/6101,Example Pump Supplier,INR,2026-10-04T10:00:00+05:30,2026-10-04T10:00:00+05:30,posted,DEMO-PO-6101,70800.00,60000.00,5400.00,5400.00,1,Water pump 1 kW,PUMP-1KW,60,1000.00,EA,1
DEMO-INVOICE-COPY-6101,DEMO/INV/6101,Example Pump Supplier,INR,2026-10-04T10:00:00+05:30,2026-10-04T11:00:00+05:30,posted,DEMO-PO-6101,70800.00,60000.00,5400.00,5400.00,1,Water pump 1 kW,PUMP-1KW,60,1000.00,EA,1
` },
  { name:"sample-payments.csv", recordType:"PAYMENT", label:"Payments · two linked, one unlinked", content:`id,reference,supplier,currency,occurredAt,observedAt,status,poId,invoiceId,amount,utr
DEMO-PAYMENT-6101,DEMO/PAY/6101,Example Pump Supplier,INR,2026-10-05T10:00:00+05:30,2026-10-05T10:00:00+05:30,settled,DEMO-PO-6101,DEMO-INVOICE-6101,30000.00,DEMO-UTR-6101
DEMO-PAYMENT-6102,DEMO/PAY/6102,Example Pump Supplier,INR,2026-10-06T10:00:00+05:30,2026-10-06T10:00:00+05:30,settled,DEMO-PO-6101,DEMO-INVOICE-6101,20800.00,DEMO-UTR-6102
DEMO-PAYMENT-6103,DEMO/PAY/6103,Example Pump Supplier,INR,2026-10-07T10:00:00+05:30,2026-10-07T10:00:00+05:30,settled,DEMO-PO-6101,,15000.00,DEMO-UTR-6103
` },
];
export const purchaseOrderSample = { name:"sample-purchase-order-only.csv", recordType:"PO" as const, label:"Standalone purchase order · 10 pumps", content:`id,reference,supplier,currency,occurredAt,observedAt,status,dueAt,lineId,description,sku,quantity,unitPrice,uom,coverage
DEMO-PO-6201,DEMO/PO/6201,Example Pump Supplier,INR,2026-10-01T10:00:00+05:30,2026-10-01T10:00:00+05:30,approved,2026-10-30T18:00:00+05:30,1,Water pump 1 kW,PUMP-1KW,10,1250.00,EA,unknown
` };
export const expectedSample = { ordered:"100", received:"60", openDelivery:"40", settled:"50800.00", supportedOutstanding:"20000.00", recordedOutstanding:"90800.00", disputedExposure:"70800.00", unallocated:"15000.00" };
