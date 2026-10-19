import { Camera, Mic, PenLine } from "lucide-react";
import { translate as tr } from "@/i18n";

const ACTIONS = [
  { mode: "escanear", icon: Camera, label: () => tr("escanear") },
  { mode: "falar", icon: Mic, label: () => tr("falar") },
  { mode: "digitar", icon: PenLine, label: () => tr("digitar") },
];

// Three ways to add an entry, fanned above the "+" on the phone bottom bar.
export default function QuickAddMenu({ open, onClose, onPick }) {
  if (!open) return null;
  return (
    <div className="md:hidden fixed inset-0 z-20 bg-black/60 backdrop-blur-sm" data-testid="quick-add-overlay"
      onClick={onClose}>
      <div className="absolute inset-x-0 flex justify-center gap-8 px-6"
        style={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}>
        {ACTIONS.map(({ mode, icon: Icon, label }) => (
          <button key={mode} type="button" data-testid={`quick-add-${mode}`}
            onClick={(event) => { event.stopPropagation(); onPick(mode); }}
            className="flex flex-col items-center gap-2 text-sm font-medium text-white">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#061B4A] ring-2 ring-white/30 transition active:scale-95">
              <Icon size={24} />
            </span>
            {label()}
          </button>
        ))}
      </div>
    </div>
  );
}
