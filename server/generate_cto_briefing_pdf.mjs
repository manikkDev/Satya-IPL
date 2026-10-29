import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

const mdPath = path.resolve("../SATYA_AI_CTO_BRIEFING.md");
const pdfPath = path.resolve("../SATYA_AI_CTO_BRIEFING.pdf");

if (!fs.existsSync(mdPath)) {
  console.error("Markdown briefing not found at", mdPath);
  process.exit(1);
}

const content = fs.readFileSync(mdPath, "utf-8");
const lines = content.split("\n");

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 40, bottom: 45, left: 45, right: 45 },
  info: {
    Title: "Satya AI — CTO Master Briefing",
    Author: "Antigravity Engineering Core",
    Subject: "Technical Deep Dive, Architectural Defense & Investor Intelligence"
  }
});

const stream = fs.createWriteStream(pdfPath);
doc.pipe(stream);

// Color palette
const NAVY = "#0f172a";
const SLATE = "#334155";
const MUTED = "#64748b";
const BLUE = "#0284c7";
const BORDER = "#e2e8f0";

// Running header / footer
let pageNum = 1;
doc.on("pageAdded", () => {
  pageNum++;
  doc.save();
  doc.fontSize(8).fillColor(MUTED).text("SATYA AI — CTO MASTER BRIEFING & INVESTOR INTELLIGENCE", 45, 20);
  doc.text(`Page ${pageNum}`, 500, 20, { align: "right" });
  doc.moveTo(45, 30).lineTo(550, 30).strokeColor(BORDER).stroke();
  doc.restore();
});

// Title & Header Block
doc.rect(45, 40, 505, 75).fillAndStroke("#f8fafc", "#cbd5e1");
doc.fillColor(NAVY).fontSize(18).font("Helvetica-Bold").text("SATYA AI — CTO MASTER BRIEFING", 55, 50);
doc.fillColor(BLUE).fontSize(10).font("Helvetica-Bold").text("TECHNICAL DEEP DIVE, ARCHITECTURAL DEFENSE & INVESTOR INTELLIGENCE", 55, 72);
doc.fillColor(MUTED).fontSize(8).font("Helvetica").text("Author: Antigravity Architecture Core · Version: 2.4.0 · Verified Codebase Grounding", 55, 90);

doc.y = 130;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trimEnd();

  // Skip title line if already rendered
  if (line.startsWith("# SATYA AI — CTO MASTER BRIEFING")) continue;
  if (line.startsWith("**Technical Deep Dive")) continue;
  if (line.startsWith("*Author:*")) continue;

  // Horizontal Rule
  if (line.startsWith("---")) {
    doc.moveDown(0.5);
    doc.moveTo(45, doc.y).lineTo(550, doc.y).strokeColor(BORDER).stroke();
    doc.moveDown(0.5);
    continue;
  }

  // Heading 1 (Sections)
  if (line.startsWith("## ")) {
    if (doc.y > 680) doc.addPage();
    doc.moveDown(0.8);
    const title = line.replace("## ", "");
    doc.fillColor(NAVY).fontSize(13).font("Helvetica-Bold").text(title);
    doc.moveTo(45, doc.y + 2).lineTo(550, doc.y + 2).strokeColor("#0284c7").lineWidth(1.5).stroke();
    doc.lineWidth(1);
    doc.moveDown(0.5);
    continue;
  }

  // Heading 2 (Subsections)
  if (line.startsWith("### ")) {
    if (doc.y > 700) doc.addPage();
    doc.moveDown(0.5);
    const title = line.replace("### ", "");
    doc.fillColor(BLUE).fontSize(10.5).font("Helvetica-Bold").text(title);
    doc.moveDown(0.3);
    continue;
  }

  // Heading 3
  if (line.startsWith("#### ")) {
    if (doc.y > 720) doc.addPage();
    doc.moveDown(0.3);
    const title = line.replace("#### ", "");
    doc.fillColor(SLATE).fontSize(9.5).font("Helvetica-Bold").text(title);
    doc.moveDown(0.2);
    continue;
  }

  // Bullet point
  if (line.startsWith("* ") || line.startsWith("- ")) {
    const text = line.replace(/^[\*\-]\s+/, "");
    doc.fillColor(SLATE).fontSize(8.5).font("Helvetica").text("•  " + text, { indent: 10, lineGap: 2 });
    continue;
  }

  // Table row
  if (line.startsWith("|")) {
    if (line.includes("---")) continue; // Skip markdown divider
    const cells = line.split("|").slice(1, -1).map(c => c.trim().replace(/<br>/g, " "));
    const rowText = cells.join("   |   ");
    doc.fillColor("#1e293b").fontSize(7.5).font("Courier").text(rowText, { indent: 5, lineGap: 1 });
    continue;
  }

  // Code / Diagram block fence
  if (line.startsWith("```")) {
    doc.moveDown(0.2);
    continue;
  }

  // Monospace block content
  if (line.startsWith("┌") || line.startsWith("│") || line.startsWith("└") || line.startsWith("├") || line.includes("──►") || line.includes("──")) {
    doc.fillColor("#0369a1").fontSize(6.5).font("Courier").text(line, { lineGap: 0.5 });
    continue;
  }

  // Normal text paragraph
  if (line.length > 0) {
    doc.fillColor(SLATE).fontSize(8.5).font("Helvetica").text(line, { lineGap: 2.5 });
  } else {
    doc.moveDown(0.3);
  }
}

doc.end();

stream.on("finish", () => {
  const stats = fs.statSync(pdfPath);
  console.log(`Successfully generated ${pdfPath} (${(stats.size / 1024).toFixed(1)} KB)`);
});
