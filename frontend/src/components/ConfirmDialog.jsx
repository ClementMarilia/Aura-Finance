import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Reusable confirm dialog.
 * Usage: <ConfirmDialog open={state} onOpenChange={setState} title="..." description="..." onConfirm={fn} />
 */
export default function ConfirmDialog({
  open, onOpenChange, title = "Confirmar", description = "",
  confirmLabel = "Excluir", cancelLabel = "Cancelar",
  variant = "danger", onConfirm, testId = "confirm-dialog",
}) {
  const confirmBg = variant === "danger"
    ? "bg-[#D9453B] hover:bg-[#B83A30] text-white"
    : "bg-[#061B4A] hover:bg-[#1268F4] text-white";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid={testId}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {description && <p className="text-sm text-[#6B7068]">{description}</p>}
        <DialogFooter className="flex gap-2 sm:justify-end">
          <Button type="button" onClick={() => onOpenChange(false)} data-testid={`${testId}-cancel`}
            className="bg-white border border-[#E5E4E0] text-[#1A1C1A] hover:bg-[#F1EFE7] rounded-xl">
            {cancelLabel}
          </Button>
          <Button type="button" onClick={onConfirm} data-testid={`${testId}-confirm`}
            className={`rounded-xl ${confirmBg}`}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
