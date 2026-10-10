import type { SourceRecord } from "./business-api";

export type CsvKind = "PO" | "GRN" | "INVOICE" | "PAYMENT" | "CREDIT_NOTE" | "RETURN" | "PROFORMA";
export type CsvSource = { name: string; content: string; recordType: CsvKind | ""; source: string; numberFormat: "plain" | "en-IN"; mapping: Record<string, string>; columns: string[]; rows: string[][] };
export const recordLabels: Record<CsvKind, string> = { PO:"Purchase order", GRN:"Delivery receipt", INVOICE:"Invoice", PAYMENT:"Payment", CREDIT_NOTE:"Credit note", RETURN:"Return", PROFORMA:"Proforma invoice" };
export const fieldLabels: Record<string, string> = {
  id:"Unique record ID", reference:"Document reference", supplier:"Supplier name", currency:"Currency", occurredAt:"Document date and time", observedAt:"Recorded date and time", status:"Approval / payment status", poId:"Linked purchase order ID", invoiceId:"Linked invoice ID", amount:"Total amount", netAmount:"Amount before tax", lineId:"Item line ID", description:"Item description", sku:"Product code", quantity:"Quantity", unitPrice:"Price per unit", uom:"Unit (EA, BOX, SET, M, KG)", acceptedQuantity:"Accepted quantity", poLineId:"Linked order line ID", packSize:"Items per box", taxCGST:"CGST amount", taxSGST:"SGST amount", taxIGST:"IGST amount", taxCESS:"Cess amount", utr:"Bank transfer reference", coverage:"Delivery-record coverage", matchingLevel:"Matching method", dueAt:"Expected delivery date and time", gstin:"Supplier GST number", irn:"Invoice registration number",
};
const aliases: Record<string, string[]> = {
  id:["recordid", "sourceid", "observationid", "postingid"], reference:["documentreference", "referencenumber", "invoicenumber", "ordernumber", "receiptno"], supplier:["suppliername", "vendor", "vendorname"], currency:["currencycode"], occurredAt:["documentdate", "timestamp", "issuedat"], observedAt:["recordedat", "importedat"], status:["paymentstatus", "approvalstatus"], poId:["purchaseorderid", "linkedorderid"], invoiceId:["linkedinvoiceid"], amount:["totalamount", "grossamount"], netAmount:["subtotal", "amountbeforetax"], lineId:["itemlineid", "linenumber"], description:["itemdescription", "productname", "itemname"], sku:["productcode", "itemcode"], quantity:["qty"], unitPrice:["priceperunit", "price"], uom:["unit", "unitofmeasure"], acceptedQuantity:["acceptedqty"], poLineId:["orderlineid"], utr:["bankreference", "transferreference"], dueAt:["expectedat"],
};
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseCsv(content: string) {
  const text = content.replace(/^\ufeff/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closedQuote = false;
  const cell = () => { row.push(field); field = ""; closedQuote = false; };
  const finish = () => { cell(); if (row.some((value) => value !== "")) rows.push(row); row = []; if (rows.length > 2001) throw new Error("Use at most 2,000 data rows per file. Split a larger export into smaller files."); };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') { quoted = false; closedQuote = true; }
      else field += character;
    } else if (character === ",") cell();
    else if (character === "\n" || character === "\r") { if (character === "\r" && text[index + 1] === "\n") index++; finish(); }
    else if (character === '"' && field === "" && !closedQuote) quoted = true;
    else if (closedQuote) throw new Error("A quoted CSV value must be followed by a comma or a new line.");
    else field += character;
  }
  if (quoted) throw new Error("A CSV value has an unclosed quote. Close the quote and upload the file again.");
  if (field !== "" || row.length) finish();
  const columns = rows.shift() || [];
  if (!columns.length || columns.some((column) => !column.trim())) throw new Error("Add a header row with a name for every column.");
  if (columns.length > 50 || new Set(columns).size !== columns.length) throw new Error("Use unique column names and no more than 50 columns.");
  return { columns, rows };
}

export function inferCsvKind(name: string): CsvKind | "" {
  const value = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\bcredit\b/.test(value)) return "CREDIT_NOTE";
  if (/\bproforma\b/.test(value)) return "PROFORMA";
  if (/\breturns?\b/.test(value)) return "RETURN";
  if (/\b(payments?|transfers?|bank)\b/.test(value)) return "PAYMENT";
  if (/\b(grn|receipts?|deliveries|delivery)\b/.test(value)) return "GRN";
  if (/\binvoices?\b/.test(value)) return "INVOICE";
  if (/\b(po|orders?|purchaseorders?)\b/.test(value)) return "PO";
  return "";
}

export function automaticMapping(columns: string[]) {
  return Object.fromEntries(Object.keys(fieldLabels).flatMap((field) => {
    const exact = columns.find((column) => column === field);
    const matches = columns.filter((column) => normalized(column) === normalized(field) || aliases[field]?.includes(normalized(column)));
    return exact ? [[field, exact]] : matches.length === 1 ? [[field, matches[0]]] : [];
  }));
}

export function csvSource(name: string, content: string, kind?: CsvKind): CsvSource {
  const parsed = parseCsv(content);
  return { name, content, recordType:kind || inferCsvKind(name), source:name.replace(/\.csv$/i, "").slice(0, 80), numberFormat:"plain", mapping:automaticMapping(parsed.columns), ...parsed };
}

export function requiredFields(kind: CsvKind | "") {
  const fields = ["id", "reference", "supplier", "currency", "occurredAt"];
  if (["PO", "INVOICE", "GRN", "RETURN"].includes(kind)) fields.push("description", "quantity", "uom");
  if (["PO", "INVOICE"].includes(kind)) fields.push("unitPrice");
  if (["PO", "PAYMENT"].includes(kind)) fields.push("status");
  if (["INVOICE", "PAYMENT", "CREDIT_NOTE"].includes(kind)) fields.push("amount");
  return fields;
}

export function orderCandidates(files: CsvSource[]) {
  return [...new Set(files.filter((file) => file.recordType === "PO").flatMap((file) => {
    const id = file.columns.indexOf(file.mapping.id), status = file.columns.indexOf(file.mapping.status);
    return file.rows.filter((row) => row[status]?.trim() === "approved").map((row) => row[id]?.trim()).filter(Boolean);
  }))];
}

export function csvPayload(title: string, poId: string, files: CsvSource[]) {
  return { title:title.trim(), poId:poId.trim(), files:files.map(({ name, content, recordType, source, numberFormat, mapping }) => ({ name, content, recordType, source, numberFormat, mapping })) };
}

const scale = BigInt("1000000");
function decimalAtoms(value: string) {
  if (!/^\d{1,13}(?:\.\d{1,6})?$/.test(value)) throw new Error("Use a positive plain number with up to six decimal places, without commas or currency symbols.");
  const [integer, fraction = ""] = value.split(".");
  const atoms = BigInt(integer) * scale + BigInt(fraction.padEnd(6, "0"));
  if (atoms > BigInt("1000000000000000000")) throw new Error("A quantity or price must not exceed 1,000,000,000,000.");
  return atoms;
}
export function orderSubtotal(lines: { quantity: string; unitPrice: string }[]) {
  const total = lines.reduce((sum, line) => sum + decimalAtoms(line.quantity) * decimalAtoms(line.unitPrice), BigInt(0));
  const cents = (total + BigInt("5000000000")) / BigInt("10000000000");
  return `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}
export function validateOrderLines(lines: { description: string; quantity: string; unitPrice: string }[]) {
  if (!lines.length || lines.length > 100) throw new Error("Add between 1 and 100 items to the order.");
  for (const [index, line] of lines.entries()) {
    if (!line.description.trim() || line.description.length > 500) throw new Error(`Add an item description of up to 500 characters for item ${index + 1}.`);
    if (decimalAtoms(line.quantity) === BigInt(0)) throw new Error(`Item ${index + 1} needs a quantity greater than zero.`);
    decimalAtoms(line.unitPrice);
  }
}

export function recordsCsv(records: SourceRecord[]) {
  const columns = ["id", "reference", "supplier", "currency", "occurredAt", "observedAt", "status", "dueAt", "lineId", "description", "sku", "quantity", "unitPrice", "uom"];
  const escape = (value: string) => {
    const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const rows = records.flatMap((record) => (record.lines || []).map((line) => columns.map((column) => {
    if (column === "lineId") return line.id;
    const value = ["description", "sku", "quantity", "unitPrice", "uom"].includes(column) ? line[column as keyof typeof line] : record[column as keyof typeof record];
    return typeof value === "string" ? value : "";
  })));
  return [columns, ...rows].map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

export function downloadText(name: string, content: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
