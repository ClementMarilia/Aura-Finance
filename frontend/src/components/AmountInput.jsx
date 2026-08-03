import { useState } from "react";
import { Calculator, Delete } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { calculate, percentageOperand, toAmountValue } from "@/lib/calculator";
import { translate as tr } from "@/i18n";

const DIGITS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];
function initialDisplay(value) {
  const number = Number(value);
  return value !== "" && Number.isFinite(number) ? String(number) : "0";
}

export default function AmountInput({ value, onValueChange, currency, className, ...inputProps }) {
  const [open, setOpen] = useState(false);
  const [display, setDisplay] = useState("0");
  const [accumulator, setAccumulator] = useState(null);
  const [operator, setOperator] = useState(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [divisor, setDivisor] = useState("2");
  const [error, setError] = useState("");

  const openCalculator = () => {
    setDisplay(initialDisplay(value));
    setAccumulator(null);
    setOperator(null);
    setWaitingForOperand(false);
    setDivisor("2");
    setError("");
    setOpen(true);
  };

  const showResult = (result) => {
    setDisplay(String(result));
    setError("");
  };

  const handleError = (reason) => {
    setError(reason === "division_by_zero" ? tr("Não é possível dividir por zero") : tr("Cálculo inválido"));
  };

  const inputDigit = (digit) => {
    setError("");
    if (waitingForOperand || display === "0") {
      setDisplay(digit);
      setWaitingForOperand(false);
      return;
    }
    if (display.replace(/[.-]/g, "").length < 14) setDisplay(`${display}${digit}`);
  };

  const inputDecimal = () => {
    setError("");
    if (waitingForOperand) {
      setDisplay("0.");
      setWaitingForOperand(false);
    } else if (!display.includes(".")) {
      setDisplay(`${display}.`);
    }
  };

  const chooseOperator = (nextOperator) => {
    const current = Number(display);
    try {
      const result = operator && accumulator !== null && !waitingForOperand
        ? calculate(accumulator, current, operator)
        : current;
      showResult(result);
      setAccumulator(result);
      setOperator(nextOperator);
      setWaitingForOperand(true);
    } catch (reason) {
      handleError(reason.message);
    }
  };

  const equals = () => {
    if (!operator || accumulator === null || waitingForOperand) return;
    try {
      const result = calculate(accumulator, Number(display), operator);
      showResult(result);
      setAccumulator(null);
      setOperator(null);
      setWaitingForOperand(true);
    } catch (reason) {
      handleError(reason.message);
    }
  };

  const percent = () => {
    try {
      const result = percentageOperand(display, accumulator, operator);
      showResult(result);
      setWaitingForOperand(false);
    } catch (reason) {
      handleError(reason.message);
    }
  };

  const clear = () => {
    setDisplay("0");
    setAccumulator(null);
    setOperator(null);
    setWaitingForOperand(false);
    setError("");
  };

  const backspace = () => {
    if (waitingForOperand) return;
    setDisplay(previous => previous.length > 1 ? previous.slice(0, -1) : "0");
    setError("");
  };

  const divideByPeople = () => {
    try {
      const count = Number(divisor);
      if (!Number.isInteger(count) || count < 1) throw new Error("invalid_result");
      showResult(calculate(Number(display), count, "÷"));
      setAccumulator(null);
      setOperator(null);
      setWaitingForOperand(true);
    } catch (reason) {
      handleError(reason.message);
    }
  };

  const useResult = () => {
    try {
      onValueChange(toAmountValue(display));
      setOpen(false);
    } catch (reason) {
      handleError(reason.message);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <Input
          {...inputProps}
          type="number"
          step="0.01"
          value={value}
          onChange={event => onValueChange(event.target.value)}
          className={className}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-lg"
          aria-label={tr("Abrir calculadora")}
          title={tr("Abrir calculadora")}
          disabled={inputProps.disabled}
          onClick={openCalculator}
          data-testid={inputProps["data-testid"] ? `${inputProps["data-testid"]}-calculator` : undefined}
        >
          <Calculator size={17} />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm max-sm:left-0 max-sm:top-auto max-sm:bottom-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0">
          <DialogHeader>
            <DialogTitle>{tr("Calculadora")}{currency ? ` · ${currency}` : ""}</DialogTitle>
          </DialogHeader>

          <div className="rounded-2xl bg-[#F1EFE7] p-4 text-right">
            <div className="h-5 text-sm font-medium text-[#6B7068]">{accumulator !== null && operator ? `${accumulator} ${operator}` : "\u00a0"}</div>
            <div className="truncate text-3xl font-semibold text-[#061B4A]" data-testid="calculator-display">{display}</div>
          </div>

          {error && <p className="text-sm text-[#D9453B]" role="alert">{error}</p>}

          <div className="grid grid-cols-4 gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={clear}>C</Button>
            <Button type="button" variant="outline" className="h-11" onClick={percent}>%</Button>
            <Button type="button" variant="outline" className="h-11" onClick={backspace} aria-label={tr("Apagar último dígito")}><Delete size={18} /></Button>
            <Button type="button" className="h-11 bg-[#1268F4] hover:bg-[#061B4A]" onClick={() => chooseOperator("÷")}>÷</Button>
            {DIGITS.map((digit, index) => (
              <Button key={digit} type="button" variant="outline" className="h-11 text-base" onClick={() => inputDigit(digit)}>{digit}</Button>
            )).reduce((rows, button, index) => {
              rows.push(button);
              if (index === 2) rows.push(<Button key="multiply" type="button" className="h-11 bg-[#1268F4] hover:bg-[#061B4A]" onClick={() => chooseOperator("×")}>×</Button>);
              if (index === 5) rows.push(<Button key="subtract" type="button" className="h-11 bg-[#1268F4] hover:bg-[#061B4A]" onClick={() => chooseOperator("−")}>−</Button>);
              if (index === 8) rows.push(<Button key="add" type="button" className="h-11 bg-[#1268F4] hover:bg-[#061B4A]" onClick={() => chooseOperator("+")}>+</Button>);
              return rows;
            }, [])}
            <Button type="button" variant="outline" className="col-span-2 h-11 text-base" onClick={() => inputDigit("0")}>0</Button>
            <Button type="button" variant="outline" className="h-11 text-base" onClick={inputDecimal}>,</Button>
            <Button type="button" className="h-11 bg-[#061B4A] hover:bg-[#1268F4]" onClick={equals}>=</Button>
          </div>

          <div className="flex items-end gap-2 rounded-xl border p-3">
            <div className="flex-1">
              <label htmlFor="calculator-divisor" className="text-sm font-medium">{tr("Dividir entre pessoas")}</label>
              <Input id="calculator-divisor" type="number" min="1" step="1" value={divisor} onChange={event => setDivisor(event.target.value)} />
            </div>
            <Button type="button" variant="outline" onClick={divideByPeople}>{tr("Dividir")}</Button>
          </div>

          <Button type="button" className="h-11 rounded-xl bg-[#061B4A] hover:bg-[#1268F4]" onClick={useResult}>
            {tr("Usar resultado")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
