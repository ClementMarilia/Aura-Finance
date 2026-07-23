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

export function exportMonthlyReportPDF(report, ownerName) {
  const doc = new jsPDF();
  const { period, summary, expense_profile: profile } = report;
  const currency = report.base_currency || "EUR";
  const money = (value) => new Intl.NumberFormat("pt-BR", {
    style: "currency", currency,
  }).format(value || 0);
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" })
    .format(new Date(period.year, period.month - 1, 1));
  const title = `Relatório mensal — ${monthName} ${period.year}`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 63, 51);
  doc.text(title, 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(107, 112, 104);
  doc.text(`Moeda-base: ${currency} | Gerado para ${ownerName || "usuário"}`, 14, 25);

  autoTable(doc, {
    startY: 31,
    head: [["Entradas", "Saídas", "Saldo", "Saldo realizado"]],
    body: [[
      money(summary.income), money(summary.expense),
      money(summary.balance), money(summary.realized_balance),
    ]],
    theme: "grid",
    headStyles: { fillColor: [30, 63, 51], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 3 },
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 6,
    head: [["Fixos", "Variáveis", "Parcelas", "Saídas pendentes", "Taxa de economia"]],
    body: [[
      money(profile.fixed), money(profile.variable), money(profile.installments),
      money(summary.pending_expense),
      summary.savings_rate == null ? "—" : `${summary.savings_rate}%`,
    ]],
    theme: "grid",
    headStyles: { fillColor: [44, 92, 74], textColor: 255 },
    styles: { fontSize: 8.5, cellPadding: 3 },
  });

  const detailRows = [...report.entries, ...report.expenses]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .map((item) => [
      item.date?.split("-").reverse().join("/") || "—",
      item.type === "income" ? "Entrada" : "Saída",
      item.description || "Sem descrição",
      item.category || "Sem categoria",
      item.source === "installment" ? "Parcela" : item.source === "recurrence" ? "Recorrência" : "Manual",
      item.status === "paid" ? "Pago" : "Pendente",
      money(item.base_amount),
    ]);

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Data", "Tipo", "Descrição", "Categoria", "Origem", "Status", `Valor (${currency})`]],
    body: detailRows,
    foot: [["", "", "Total", "", "", "", money(summary.balance)]],
    theme: "striped",
    headStyles: { fillColor: [30, 63, 51], textColor: 255 },
    footStyles: { fillColor: [241, 239, 231], textColor: [30, 63, 51], fontStyle: "bold" },
    styles: { fontSize: 7.5, cellPadding: 2.4 },
    columnStyles: { 2: { cellWidth: 42 }, 3: { cellWidth: 28 } },
  });

  doc.save(`relatorio_mensal_${period.year}_${String(period.month).padStart(2, "0")}.pdf`);
}
