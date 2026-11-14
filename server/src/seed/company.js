// Master data for the ONE curated demo company. Everything here is fictional
// (CONSTRUCTED_DEMO): names, PANs, GSTINs, Udyam numbers and bank accounts were
// made up to be *format-valid and internally consistent* — GSTIN checksum,
// PAN embedded in GSTIN, PAN holder type, state code ↔ city ↔ PIN, Udyam
// state code — not to match any real registration.
import { buildGstin } from "./india.js";

export const DEMO_COMPANY_ID = "satya-demo"; // legacy companyId -> Group.legacyCompanyId
export const ENTITY_CODE = "SATYAD";

export const ENTITY = {
  code: ENTITY_CODE,
  legalName: "Satya Equipment Distribution Pvt Ltd",
  tradeName: "Satya Equipment Distribution",
  pan: "AAKCS4821M",
  stateCode: "27",
  cin: "U46599MH2019PTC184322",
  aatoBand: "5-10cr",
  einvoiceApplicable: true,
  address: {
    line1: "Gat No. 214, Pune–Nashik Highway, Chakan MIDC Phase II",
    city: "Pune", state: "Maharashtra", stateCode: "27", pin: "410501",
  },
  shipping: {
    label: "Chakan works — stores gate 2",
    line1: "Gat No. 214, Pune–Nashik Highway, Chakan MIDC Phase II",
    city: "Pune", state: "Maharashtra", stateCode: "27", pin: "410501",
    contact: "Stores desk · +91 98220 41105",
  },
  bank: { bank: "HDFC Bank, Chakan branch", ifsc: "HDFC0001207", accountNo: "50200041127741" },
  lut: { arn: "AD270326041178K", fy: "2026-27", validFrom: "2026-04-01", validTo: "2027-03-31" },
};
ENTITY.gstin = buildGstin(ENTITY.stateCode, ENTITY.pan);

// key, legal identity, location, MSME status and commercial terms.
// holder: company | firm | llp | proprietor (drives PAN 4th character).
// einvoice: supplier's AATO is above the e-invoice threshold, so its tax
// invoices carry an IRN.
const RAW_SUPPLIERS = [
  {
    key: "shakti", legalName: "Shakti Industrial Suppliers Pvt Ltd", holder: "company", pan: "AAHCS6742Q",
    stateCode: "27", address: { line1: "Plot J-88, MIDC Bhosari", city: "Pune", pin: "411026" },
    udyam: { number: "UDYAM-MH-26-0012345", category: "small" }, termsDays: 45, einvoice: true,
    invoicePrefix: "SIS/{FY}/", invoicePad: 4,
    contact: { name: "Vikram Shinde", email: "accounts@shaktiindustrial.example", phone: "+91 98220 31457" },
    bank: { ifsc: "SBIN0004261", accountNo: "38114562017", bank: "State Bank of India, Bhosari" },
  },
  {
    key: "kaveri", legalName: "Kaveri Pumps & Motors Ltd", holder: "company", pan: "AACCK4412P",
    stateCode: "29", address: { line1: "No. 44, 3rd Phase, Peenya Industrial Area", city: "Bengaluru", pin: "560058" },
    udyam: { number: "UDYAM-KR-03-0009821", category: "medium" }, termsDays: 30, einvoice: true,
    invoicePrefix: "KPML/{FY4}/", invoicePad: 5,
    contact: { name: "Ramesh Gowda", email: "receivables@kaveripumps.example", phone: "+91 98450 22816" },
    bank: { ifsc: "CNRB0000437", accountNo: "0437201004416", bank: "Canara Bank, Peenya" },
  },
  {
    key: "rathod", legalName: "Rathod Engineering Works Pvt Ltd", holder: "company", pan: "AAJCR8821M",
    stateCode: "27", address: { line1: "Plot D-42, MIDC Chinchwad", city: "Pimpri-Chinchwad", pin: "411019" },
    udyam: { number: "UDYAM-MH-26-0077112", category: "micro" }, termsDays: 45, einvoice: false,
    invoicePrefix: "REW/{FY}/", invoicePad: 4,
    contact: { name: "Kiran Rathod", email: "kiran@rathodengg.example", phone: "+91 98230 66104" },
    bank: { ifsc: "BKID0000512", accountNo: "051220110003318", bank: "Bank of India, Chinchwad" },
  },
  {
    key: "deccan", legalName: "Deccan Valve Industries", holder: "firm", pan: "AAKFD3320R",
    stateCode: "27", address: { line1: "Gat No. 611, Additional MIDC", city: "Satara", pin: "415004" },
    udyam: { number: "UDYAM-MH-31-0044559", category: "small" }, termsDays: 30, einvoice: false,
    invoicePrefix: "DVI/{FY}/", invoicePad: 4,
    contact: { name: "Sachin Jadhav", email: "sales@deccanvalves.example", phone: "+91 94220 15873" },
    bank: { ifsc: "MAHB0000781", accountNo: "60281455903", bank: "Bank of Maharashtra, Satara MIDC" },
  },
  {
    key: "maratha", legalName: "Maratha Bearings & Drives LLP", holder: "llp", pan: "AAPFM9012K",
    stateCode: "27", address: { line1: "C-19, MIDC Waluj", city: "Chhatrapati Sambhajinagar", pin: "431136" },
    udyam: { number: "UDYAM-MH-04-0033117", category: "small" }, termsDays: 30, einvoice: false,
    invoicePrefix: "MBD/{FY}/", invoicePad: 3,
    contact: { name: "Amol Kale", email: "accounts@marathabearings.example", phone: "+91 97640 20931" },
    bank: { ifsc: "UTIB0000912", accountNo: "917020044187361", bank: "Axis Bank, Waluj" },
  },
  {
    // Flagship PO-1001 supplier. Proprietary concern of Rajesh Joshi (PAN
    // holder type P, 5th character = surname initial J).
    key: "meridian", legalName: "Meridian Pump Supply", holder: "proprietor", pan: "BXJPJ7316C",
    stateCode: "27", address: { line1: "Shop 14, Shivaji Udyamnagar", city: "Kolhapur", pin: "416008" },
    udyam: { number: "UDYAM-MH-18-0061204", category: "micro" }, termsDays: 45, einvoice: false,
    invoicePrefix: "MPS/{FY}/", invoicePad: 3,
    contact: { name: "Rajesh Joshi (proprietor)", email: "meridianpumps@mail.example", phone: "+91 98221 70345" },
    bank: { ifsc: "BARB0KOLHAP", accountNo: "33440200001952", bank: "Bank of Baroda, Kolhapur" },
  },
  {
    key: "saurashtra", legalName: "Saurashtra Castings & Flanges Pvt Ltd", holder: "company", pan: "AAFCS2209H",
    stateCode: "24", address: { line1: "Plot 112, GIDC Lodhika (Metoda)", city: "Rajkot", pin: "360021" },
    udyam: { number: "UDYAM-GJ-20-0018874", category: "small" }, termsDays: 45, einvoice: true,
    invoicePrefix: "SCF/{FY}/", invoicePad: 4,
    contact: { name: "Hiren Patel", email: "export@saurashtracastings.example", phone: "+91 98250 47712" },
    bank: { ifsc: "UTIB0000331", accountNo: "921020051144207", bank: "Axis Bank, Rajkot" },
  },
  {
    key: "kongu", legalName: "Kongu Pumps & Spares Pvt Ltd", holder: "company", pan: "AADCK7758N",
    stateCode: "33", address: { line1: "SF No. 212, SIDCO Industrial Estate, Kurichi", city: "Coimbatore", pin: "641021" },
    udyam: { number: "UDYAM-TN-12-0027730", category: "small" }, termsDays: 45, einvoice: true,
    invoicePrefix: "KPS{FY4}-", invoicePad: 4,
    contact: { name: "S. Karthikeyan", email: "billing@kongupumps.example", phone: "+91 94430 18826" },
    bank: { ifsc: "IOBA0001146", accountNo: "114602000007731", bank: "Indian Overseas Bank, Kurichi" },
  },
  {
    key: "aravali", legalName: "Aravali Electricals & Controls Pvt Ltd", holder: "company", pan: "AAGCA5531D",
    stateCode: "06", address: { line1: "Plot 18, Sector 24 Industrial Area", city: "Faridabad", pin: "121005" },
    udyam: { number: "UDYAM-HR-03-0015569", category: "small" }, termsDays: 45, einvoice: true,
    invoicePrefix: "AEC/{FY}/", invoicePad: 4,
    contact: { name: "Neeraj Sharma", email: "accounts@aravalicontrols.example", phone: "+91 98110 52634" },
    bank: { ifsc: "PUNB0167300", accountNo: "1673002100018842", bank: "Punjab National Bank, Faridabad" },
  },
  {
    // Proprietary concern of Sunita Pawar (PAN holder P, surname initial P).
    key: "indrayani", legalName: "Indrayani Fasteners & Hardware", holder: "proprietor", pan: "CQPPP4408F",
    stateCode: "27", address: { line1: "Gat No. 312, Kharabwadi, Chakan", city: "Pune", pin: "410501" },
    udyam: { number: "UDYAM-MH-26-0103388", category: "micro" }, termsDays: 30, einvoice: false,
    invoicePrefix: "IFH-", invoicePad: 4,
    contact: { name: "Sunita Pawar (proprietor)", email: "indrayanifasteners@mail.example", phone: "+91 90110 48327" },
    bank: { ifsc: "MAHB0001388", accountNo: "60391877245", bank: "Bank of Maharashtra, Chakan" },
  },
  {
    // Large enterprise — not MSME, so its 60-day terms are lawful.
    key: "godavari", legalName: "Godavari Electric Motors Ltd", holder: "company", pan: "AABCG1187E",
    stateCode: "27", address: { line1: "Plot F-21, MIDC Satpur", city: "Nashik", pin: "422007" },
    udyam: null, termsDays: 60, einvoice: true,
    invoicePrefix: "GEM/{FY}/", invoicePad: 5,
    contact: { name: "Anand Kulkarni", email: "ar@godavarimotors.example", phone: "+91 253 2350 418" },
    bank: { ifsc: "ICIC0000624", accountNo: "062405003392", bank: "ICICI Bank, Satpur" },
  },
];

export const SUPPLIERS = RAW_SUPPLIERS.map((s) => ({
  ...s,
  id: `sup_cur_${s.key}`,
  gstin: buildGstin(s.stateCode, s.pan),
  msme: Boolean(s.udyam),
  bankMasked: `****${s.bank.accountNo.slice(-4)}`,
}));
export const supplierByKey = Object.fromEntries(SUPPLIERS.map((s) => [s.key, s]));

// Items master. HSN + GST rate are the legally applicable rates after the
// 22 Sep 2025 rate rationalisation (Notification 9/2025-CT(Rate)):
//  - power-driven pumps primarily designed for handling water (8413 70 10):
//    5% (cut from 12%)
//  - valves, bearings, transmission parts, seals/gaskets, motors, control
//    panels, pipe fittings, fasteners, parts of process pumps: 18%
// No 28%/40% items, no services.
export const ITEMS = [
  { code: "PMP-CF-5HP", description: "Centrifugal monoblock pump 5 HP, CI body, 3-phase (clear water)", hsn: "84137010", uom: "EA", gstRate: "5" },
  { code: "PMP-CF-3HP", description: "Centrifugal monoblock pump 3 HP, CI body, 3-phase (clear water)", hsn: "84137010", uom: "EA", gstRate: "5" },
  { code: "PMP-MB-2HP", description: "Monoblock pump 2 HP, single-phase, ISI marked (clear water)", hsn: "84137010", uom: "EA", gstRate: "5" },
  { code: "PMP-SUB-3HP", description: "Submersible borewell pump 3 HP, 100 mm, SS body (water)", hsn: "84137010", uom: "EA", gstRate: "5" },
  { code: "PMP-SUB-5HP", description: "Submersible borewell pump 5 HP, 150 mm, SS body (water)", hsn: "84137010", uom: "EA", gstRate: "5" },
  { code: "PMP-IMP-CP100", description: "CP-100 process pump impeller kit, SS316 (impeller, wear ring, key)", hsn: "84139190", uom: "SET", gstRate: "18" },
  { code: "SEAL-MS-32", description: "Mechanical seal, single spring, 32 mm, SiC/SiC, Viton", hsn: "84842000", uom: "EA", gstRate: "18" },
  { code: "GSK-SPW-100", description: "Spiral-wound gasket DN100 PN16, SS316/graphite", hsn: "84849000", uom: "EA", gstRate: "18" },
  { code: "VLV-SLU-100", description: "CI sluice valve PN16, 100 mm, flanged ends", hsn: "84818030", uom: "EA", gstRate: "18" },
  { code: "VLV-NRV-80", description: "Non-return valve, wafer type, 80 mm, SS304", hsn: "84813000", uom: "EA", gstRate: "18" },
  { code: "VLV-BFV-150", description: "Butterfly valve, gear operated, 150 mm, CI body, SS disc", hsn: "84818030", uom: "EA", gstRate: "18" },
  { code: "VLV-BALL-50", description: "Ball valve 50 mm, SS316, flanged, PN40", hsn: "84818030", uom: "EA", gstRate: "18" },
  { code: "BRG-6310ZZ", description: "Deep-groove ball bearing 6310 ZZ", hsn: "84821011", uom: "EA", gstRate: "18" },
  { code: "BRG-22216", description: "Spherical roller bearing 22216 EK", hsn: "84823000", uom: "EA", gstRate: "18" },
  { code: "HSG-SN511", description: "Plummer block housing SN511", hsn: "84833000", uom: "EA", gstRate: "18" },
  { code: "PUL-2G-200", description: "V-belt pulley, 2-groove, 200 mm PCD, taper-lock", hsn: "84835090", uom: "EA", gstRate: "18" },
  { code: "BSH-TL-2517", description: "Taper-lock bush 2517, 42 mm bore", hsn: "84835090", uom: "EA", gstRate: "18" },
  { code: "MTR-FLP-7.5", description: "Flameproof motor 7.5 HP, 1440 RPM, IE2, foot mounted", hsn: "85015210", uom: "EA", gstRate: "18" },
  { code: "MTR-IE3-15KW", description: "Induction motor 15 kW, 4-pole, IE3, TEFC", hsn: "85015210", uom: "EA", gstRate: "18" },
  { code: "MTR-IE3-30KW", description: "Induction motor 30 kW, 4-pole, IE3, TEFC", hsn: "85015210", uom: "EA", gstRate: "18" },
  { code: "PNL-DOL-3P", description: "DOL starter panel 3-phase with dry-run protection", hsn: "85371000", uom: "EA", gstRate: "18" },
  { code: "PNL-VFD-15", description: "VFD control panel 15 kW, IP54, with bypass", hsn: "85371000", uom: "EA", gstRate: "18" },
  { code: "FLG-SO-100", description: "Slip-on flange 100 NB PN16, carbon steel (ASTM A105)", hsn: "73079190", uom: "EA", gstRate: "18" },
  { code: "ELB-BW-100", description: "Butt-weld elbow 90° 100 NB sch 40, carbon steel", hsn: "73079390", uom: "EA", gstRate: "18" },
  { code: "BLT-M16-60", description: "Hex bolt M16 × 60 with nut, grade 8.8, zinc plated", hsn: "73181500", uom: "SET", gstRate: "18" },
  { code: "ANC-M20-300", description: "Foundation anchor bolt M20 × 300, J-type, with nuts", hsn: "73181500", uom: "SET", gstRate: "18" },
].map((i) => ({ ...i, id: `itm_cur_${i.code.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` }));
export const itemByCode = Object.fromEntries(ITEMS.map((i) => [i.code, i]));

// Demo users. Passwords are only set when an account is first created (or
// when DEMO_RESET_PASSWORDS=1).
export const DEMO_USERS = [
  { email: "manager@satya.demo", name: "Priya Kulkarni", title: "AP manager", role: "ap_manager", roles: ["ap_manager"] },
  { email: "analyst@satya.demo", name: "Sanjay Deshmukh", title: "Operations analyst", role: "ops_analyst", roles: ["buyer", "ap_clerk"] },
  { email: "auditor@satya.demo", name: "CA Anil Mehta", title: "Auditor (read-only)", role: "auditor", roles: ["auditor"] },
];
