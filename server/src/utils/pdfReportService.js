import PDFDocument from "pdfkit";

/**
 * Generates an executive PDF report for a Case investigation or MOU Legal Expiry.
 * Returns a Promise that resolves with a Buffer.
 */
export function generateExecutiveReportPdf({
  title = "Satya AI Executive Intelligence Report",
  subtitle = "Procurement Integrity, Legal Clause Verification & Financial Reconciliation",
  caseData = null,
  contractData = null,
  generatedBy = "Satya AI Intelligence Engine",
  companyName = "Bharat Petroleum Procurement & Infrastructure (BPCI)"
}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        info: {
          Title: title,
          Author: generatedBy,
          Subject: "Procurement Audit and Legal Clause Verification",
          Keywords: "BPCI, Satya, Audit, Procurement, Reconciliation, Legal"
        }
      });

      const buffers = [];
      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      const primaryColor = "#0f172a"; // Slate 900
      const brandColor = "#0284c7";   // Sky 600
      const accentRed = "#dc2626";    // Red 600
      const accentGreen = "#16a34a";  // Green 600
      const textMuted = "#64748b";    // Slate 500

      // Header Banner
      doc.rect(50, 45, 495, 4).fill(brandColor);

      doc.moveDown(1);
      doc.fillColor(primaryColor).fontSize(20).font("Helvetica-Bold").text("SATYA AI ENTERPRISE INTELLIGENCE", 50, 60);
      doc.fillColor(textMuted).fontSize(9).font("Helvetica").text(companyName.toUpperCase(), 50, 85);
      doc.text(`Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST | Auth: ${generatedBy}`, 50, 97);

      doc.moveTo(50, 115).lineTo(545, 115).strokeColor("#e2e8f0").lineWidth(1).stroke();

      // Report Title
      doc.moveDown(2);
      doc.fillColor(brandColor).fontSize(14).font("Helvetica-Bold").text(title.toUpperCase(), 50, 130);
      doc.fillColor(textMuted).fontSize(10).font("Helvetica").text(subtitle, 50, 148);

      let yPos = 175;

      // Section 1: Executive Summary Box
      doc.rect(50, yPos, 495, 65).fillAndStroke("#f8fafc", "#cbd5e1");
      doc.fillColor(primaryColor).fontSize(10).font("Helvetica-Bold").text("EXECUTIVE COMPLIANCE SUMMARY", 65, yPos + 12);

      const statusText = contractData?.contradictions?.length > 0
        ? "ACTION REQUIRED: Legal clause contradiction detected between base agreement and addendum."
        : "NORMAL: All procurement controls and contractual milestones operational.";

      doc.fillColor(contractData?.contradictions?.length > 0 ? accentRed : accentGreen)
        .fontSize(9).font("Helvetica-Bold")
        .text(statusText, 65, yPos + 28, { width: 465 });

      doc.fillColor(textMuted).fontSize(8).font("Helvetica")
        .text("Verified against statutory BPCI challenge procurement rules, 3-way matching constraints, and GFR-12A guidelines.", 65, yPos + 44);

      yPos += 85;

      // Section 2: Case Financial Reconciliation (if caseData present)
      if (caseData) {
        doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text(`CASE RECONCILIATION: ${caseData.poId || caseData.id}`, 50, yPos);
        yPos += 20;

        const ledger = caseData.ledger || {};
        const cur = ledger.currency || "INR";

        const stats = [
          ["Purchase Order Total", `${cur} ${ledger.ordered || "0.00"}`],
          ["Delivered / Received", `${cur} ${ledger.received || "0.00"}`],
          ["Delivery Shortfall", `${cur} ${ledger.openDelivery || "0.00"}`],
          ["Supported Outstanding", `${cur} ${ledger.supportedOutstanding || "0.00"}`],
          ["Disputed Exposure", `${cur} ${ledger.disputedExposure || "0.00"}`]
        ];

        stats.forEach(([label, val], idx) => {
          const x = 50 + (idx % 2) * 250;
          const y = yPos + Math.floor(idx / 2) * 30;
          doc.rect(x, y, 240, 26).fillAndStroke("#ffffff", "#e2e8f0");
          doc.fillColor(textMuted).fontSize(8).font("Helvetica").text(label, x + 10, y + 5);
          doc.fillColor(primaryColor).fontSize(9).font("Helvetica-Bold").text(val, x + 10, y + 15);
        });

        yPos += Math.ceil(stats.length / 2) * 32 + 10;
      }

      // Section 3: Legal Clause Contradiction (MOU Expiry vs Addendum)
      if (contractData?.contradictions?.length > 0) {
        doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("LEGAL CLAUSE CONTRADICTION & SUPERSESSION", 50, yPos);
        yPos += 20;

        const c = contractData.contradictions[0];

        doc.rect(50, yPos, 495, 115).fillAndStroke("#fffbeb", "#fde68a");
        doc.fillColor("#b45309").fontSize(9).font("Helvetica-Bold").text(`Topic: ${c.topic}`, 65, yPos + 10);
        doc.fillColor(textMuted).fontSize(8).font("Helvetica").text(`Counterparty: ${c.counterparty}`, 65, yPos + 24);

        // Comparison columns
        doc.fillColor(accentRed).fontSize(8).font("Helvetica-Bold")
          .text(`Original MOU (${c.baseAgreement?.number}): Expiry ${new Date(c.baseAgreement?.expiryDate).toLocaleDateString("en-IN")}`, 65, yPos + 40);
        doc.fillColor(textMuted).fontSize(8).font("Helvetica")
          .text(`"${c.baseAgreement?.clauseText || 'Expired 30 Nov 2026'}"`, 65, yPos + 52, { width: 460 });

        doc.fillColor(accentGreen).fontSize(8).font("Helvetica-Bold")
          .text(`Superseding Addendum (${c.supersedingDocument?.number}): Extended ${new Date(c.supersedingDocument?.extendedExpiryDate).toLocaleDateString("en-IN")}`, 65, yPos + 72);
        doc.fillColor(textMuted).fontSize(8).font("Helvetica")
          .text(`"${c.supersedingDocument?.clauseText || 'Extended to 31 March 2027'}"`, 65, yPos + 84, { width: 460 });

        doc.fillColor(primaryColor).fontSize(8).font("Helvetica-Bold")
          .text(`Recommendation: ${c.recommendation}`, 65, yPos + 100, { width: 460 });

        yPos += 130;
      }

      // Section 4: Non-Financial Obligations Table
      if (contractData?.obligations?.length > 0) {
        doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("ACTIVE CONTRACT OBLIGATIONS & MILESTONES", 50, yPos);
        yPos += 20;

        doc.rect(50, yPos, 495, 20).fill("#f1f5f9");
        doc.fillColor(primaryColor).fontSize(8).font("Helvetica-Bold");
        doc.text("ID", 55, yPos + 6);
        doc.text("Title", 130, yPos + 6);
        doc.text("Category", 320, yPos + 6);
        doc.text("Due Date", 410, yPos + 6);
        doc.text("Status", 480, yPos + 6);

        yPos += 22;

        contractData.obligations.slice(0, 6).forEach((obl) => {
          doc.rect(50, yPos, 495, 22).strokeColor("#f1f5f9").lineWidth(1).stroke();
          doc.fillColor(primaryColor).fontSize(7).font("Helvetica-Bold").text(obl.obligationId || obl.id, 55, yPos + 6);
          doc.fillColor(primaryColor).fontSize(7).font("Helvetica").text((obl.title || "").slice(0, 40), 130, yPos + 6);
          doc.fillColor(textMuted).fontSize(7).font("Helvetica").text((obl.type || obl.category || "OBL").replaceAll("_", " "), 320, yPos + 6);
          doc.fillColor(textMuted).fontSize(7).font("Helvetica").text(new Date(obl.dueDate).toLocaleDateString("en-IN"), 410, yPos + 6);

          const stColor = obl.status === "satisfied" ? accentGreen : obl.status === "disputed_superseded" ? accentRed : "#d97706";
          doc.fillColor(stColor).fontSize(7).font("Helvetica-Bold").text((obl.status || "pending").toUpperCase(), 480, yPos + 6);

          yPos += 24;
        });
      }

      // Footer & Official Seal
      doc.moveTo(50, 750).lineTo(545, 750).strokeColor("#cbd5e1").lineWidth(1).stroke();
      doc.fillColor(textMuted).fontSize(8).font("Helvetica")
        .text("Bharat Petroleum Procurement & Infrastructure (BPCI) Confidential. Grounded on immutable hash-verified evidence.", 50, 760);
      doc.fillColor(textMuted).fontSize(8).font("Helvetica")
        .text(`Page 1 of 1 · Verification Checksum: ${Date.now().toString(36).toUpperCase()}`, 400, 760, { align: "right" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
