import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { normalizeText } from "@/lib/statementImport";
import { getLanguage, translate as tr } from "@/i18n";

const STATUS_LABEL = {
  "loading tesseract core": tr("Preparando o leitor..."),
  "loading language traineddata": tr("Baixando o idioma do leitor..."),
  "recognizing text": tr("Lendo o recibo..."),
};

// Reads a receipt photo on the device and reports { total, date, merchant,
// category_id }. `initialFile` lets a file shared from another app start
// reading as soon as the form opens.
export default function ReceiptScanner({ onResult, initialFile = null }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ status: "", value: 0 });

  const scan = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(tr("Escolha uma foto do recibo (JPG ou PNG)."));
      return;
    }
    setBusy(true);
    setProgress({ status: "", value: 0 });
    try {
      const { readReceipt } = await import(/* webpackChunkName: "ocr" */ "@/lib/receiptOcr");
      const [result, rules] = await Promise.all([
        readReceipt(file, {
          language: getLanguage(),
          onProgress: (status, value) => setProgress({ status, value }),
        }),
        api.get("/statement-imports/rules").then((r) => r.data).catch(() => []),
      ]);
      const merchant = normalizeText(result.merchant);
      const rule = merchant && rules
        .filter((item) => item.type !== "income" && merchant.includes(normalizeText(item.pattern)))
        .sort((a, b) => b.pattern.length - a.pattern.length)[0];
      const found = [result.total && tr("valor"), result.date && tr("data"), result.merchant && tr("loja")].filter(Boolean);
      if (!found.length) {
        toast.error(tr("Não consegui ler este recibo. Tente uma foto mais nítida, reta e bem iluminada."));
        return;
      }
      onResult({ ...result, category_id: rule?.category_id || null });
      toast.success(tr("Recibo lido: {fields}. Confira antes de salvar.", { fields: found.join(", ") }));
    } catch (error) {
      toast.error(tr("Não foi possível ler o recibo neste aparelho."));
      console.error(error);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  useEffect(() => {
    if (initialFile) scan(initialFile);
  }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = busy
    ? `${STATUS_LABEL[progress.status] || tr("Preparando o leitor...")} ${Math.round(progress.value * 100)}%`
    : tr("Ler recibo (foto)");

  return (
    <div className="space-y-1">
      <input ref={input} type="file" accept="image/*" className="hidden"
        data-testid="receipt-file" onChange={(event) => scan(event.target.files?.[0])} />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}
        className="w-full rounded-xl" data-testid="receipt-scan-button">
        <Camera size={16} className="mr-2" /> {label}
      </Button>
      <p className="text-[11px] text-[#6B7068] text-center">
        {tr("A foto é lida no seu aparelho e não é enviada nem guardada.")}
      </p>
    </div>
  );
}
