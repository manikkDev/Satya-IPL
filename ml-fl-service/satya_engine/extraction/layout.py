"""Column-preserving text from a PDF text layer (pdftotext -layout style).

pdfium's own text order collapses side-by-side blocks ("Supplier: Bill To:")
into single-spaced runs, which destroys the column structure invoices rely
on. Here characters are regrouped by baseline and placed on a fixed character
grid, so separate columns stay separated by 2+ spaces and keep roughly
stable column offsets across lines.
"""
CELL_PT = 4.2          # one output column per ~4.2pt of page width
LINE_TOLERANCE = 0.45  # fraction of glyph height for same-baseline grouping


def page_lines(textpage):
    """Layout lines for one pypdfium2 PdfTextPage."""
    import pypdfium2.raw as pdfium_c

    chars = []
    for index in range(textpage.count_chars()):
        if pdfium_c.FPDFText_IsGenerated(textpage, index):
            continue
        code = pdfium_c.FPDFText_GetUnicode(textpage, index)
        if code in (0, 0xFFFE, 0xFFFF) or code in (10, 13):
            continue
        try:
            left, bottom, right, top = textpage.get_charbox(index, loose=True)
        except Exception:
            continue
        chars.append((chr(code), left, bottom, right, top))
    if not chars:
        return []
    chars.sort(key=lambda c: (-round(c[2], 1), c[1]))
    rows = []
    for char in chars:
        height = max(char[4] - char[2], 1.0)
        for row in rows:
            if abs(row["bottom"] - char[2]) <= LINE_TOLERANCE * max(height, row["height"]):
                row["chars"].append(char)
                break
        else:
            rows.append({"bottom": char[2], "height": height, "chars": [char]})
    rows.sort(key=lambda r: -r["bottom"])
    lines = []
    for row in rows:
        row_chars = sorted(row["chars"], key=lambda c: c[1])
        out, prev_right = [], None
        widths = [c[3] - c[1] for c in row_chars if c[0].strip()]
        avg_width = sum(widths) / len(widths) if widths else CELL_PT
        for glyph, left, _b, right, _t in row_chars:
            if glyph.isspace():
                if out and out[-1] != " ":
                    out.append(" ")
                prev_right = right
                continue
            target = int(round(left / CELL_PT))
            if prev_right is not None:
                gap = left - prev_right
                if gap > max(2.2 * avg_width, 7.0):
                    target = max(target, len(out) + 2)
                    out.extend(" " * (target - len(out)))
                elif gap > 0.3 * avg_width and out and out[-1] != " ":
                    out.append(" ")
            elif target > len(out):
                out.extend(" " * target)
            out.append(glyph)
            prev_right = right
        lines.append("".join(out).rstrip())
    return lines


def layout_pages(doc, max_pages):
    """[(page_number, [lines...]), ...] for the first max_pages pages."""
    pages = []
    for index in range(min(len(doc), max_pages)):
        pages.append((index + 1, page_lines(doc[index].get_textpage())))
    return pages


def layout_text(pages):
    return "\f".join("\n".join(lines) for _page, lines in pages)
