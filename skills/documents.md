---
name: documents
description: Read, summarize, compare and create documents - PDF, Word, Excel/CSV and Markdown - such as reports, invoices, resumes, contracts, specs and slides converted to PDF.
triggers: pdf, docx, word document, excel, xlsx, spreadsheet, csv, invoice, report, resume, cv, contract, summarize this document, extract from, convert to pdf, letter
---
**Reading**
1. Use `read_document` for PDF (use `pages` for long files: skim the first pages, then read what matters), Word `.docx` and text formats. For `.xlsx`, check whether Python with `openpyxl` or `pandas` is available (`python -c "import openpyxl"`) and read the sheets with a short script; otherwise ask the user to export CSV.
2. Scanned PDFs have no text layer; say so, and suggest OCR (for example `tesseract`, if installed) rather than guessing.
3. Quote exact figures and clauses with page numbers. For summaries, lead with what the reader needs to decide or do.

**Creating**
1. Draft the content in Markdown first: clear headings, tables for numbers, short paragraphs. Then call `generate_pdf` (Markdown supports tables, code, quotes and `<!-- pagebreak -->`; use HTML with `css` for custom layouts such as invoices or letterheads).
2. For Word or Excel output, write a small script using libraries that are already installed (Python `python-docx`/`openpyxl`, or Node `docx`/`exceljs` if present in the project). Don't install packages globally without asking.
3. Verify the result: read the generated PDF back with `read_document` and check page count, totals and names. Fix and regenerate if anything is off.
4. Never invent facts, figures or signatures. Mark placeholders clearly, e.g. `[CLIENT NAME]`.
