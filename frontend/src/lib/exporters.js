import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function exportCSV(filename, headers, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(";"), ...rows.map(r => r.map(esc).join(";"))];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportPDF(title, subtitle, headers, rows, footRow) {
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 63, 51);
  doc.text(title, 14, 20);
  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(107, 112, 104);
    doc.text(subtitle, 14, 28);
  }
  autoTable(doc, {
    startY: 34,
    head: [headers],
    body: rows,
    foot: footRow ? [footRow] : undefined,
    theme: "striped",
    headStyles: { fillColor: [30, 63, 51], textColor: 255 },
    footStyles: { fillColor: [241, 239, 231], textColor: [30, 63, 51], fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 3 },
  });
  doc.save(`${title.replace(/\s+/g, "_").toLowerCase()}.pdf`);
}
