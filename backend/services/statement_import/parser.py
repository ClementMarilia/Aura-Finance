"""Parse bank statements (OFX/QFX and CSV) into normalised rows.

Pure functions only: no database access, so every bank quirk can be covered
by unit tests. Each parsed row carries a signed ``amount`` (negative for money
leaving the account), an ISO ``date`` and a ``description``.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Optional


MAX_ROWS = 2000


class StatementParseError(ValueError):
    """The file cannot be read as a statement."""


class MappingRequired(StatementParseError):
    """CSV columns could not be detected; the caller must map them."""

    def __init__(self, headers: List[str]):
        super().__init__("Não foi possível identificar as colunas do CSV")
        self.headers = headers


@dataclass
class ParsedRow:
    date: str
    amount: float
    description: str
    external_id: Optional[str] = None


@dataclass
class ParsedStatement:
    format: str
    rows: List[ParsedRow]
    currency: Optional[str] = None
    headers: Optional[List[str]] = None


def normalize_text(value: object) -> str:
    """Case- and accent-insensitive text with collapsed whitespace."""
    decomposed = unicodedata.normalize("NFKD", str(value or "").casefold())
    plain = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", plain).strip()


def description_key(value: object) -> str:
    """Stable key for learning categories: ignores digits and punctuation.

    "PIX ENVIADO 12/03 JOAO" and "Pix enviado 15/04 João" share a key, so a
    category chosen once is suggested for the next month's statement.
    """
    text = re.sub(r"[^a-z ]+", " ", normalize_text(value))
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------- amounts

_CURRENCY_NOISE = re.compile(r"[^\d,.\-+()]")


def parse_amount(raw: object) -> Optional[float]:
    """Parse "1.234,56", "-1,234.56", "(12.00)", "R$ 10,00", "12,5-" ..."""
    text = str(raw or "").strip()
    if not text:
        return None
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
    if text.endswith("-") or text.upper().endswith(" D") or text.upper().endswith("DB"):
        negative = True
    cleaned = _CURRENCY_NOISE.sub("", text.replace("−", "-"))
    cleaned = cleaned.strip("()+")
    if cleaned.endswith("-"):
        cleaned = cleaned[:-1]
    if cleaned.startswith("-"):
        negative = True
        cleaned = cleaned[1:]
    if not cleaned or not re.search(r"\d", cleaned):
        return None

    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")
    if last_comma > last_dot:
        decimal_sep, thousands_sep = ",", "."
    elif last_dot > last_comma:
        decimal_sep, thousands_sep = ".", ","
    else:
        decimal_sep, thousands_sep = None, None

    if decimal_sep:
        integer, _, fraction = cleaned.rpartition(decimal_sep)
        # "1.234" or "1,234" with exactly three digits and no other separator
        # is a thousands group, not a decimal fraction.
        if (
            len(fraction) == 3
            and thousands_sep not in cleaned
            and cleaned.count(decimal_sep) == 1
            and integer.strip("0")
        ):
            integer, fraction = integer + fraction, ""
        integer = integer.replace(thousands_sep, "").replace(decimal_sep, "")
        cleaned = f"{integer}.{fraction}" if fraction else integer
    try:
        value = float(cleaned)
    except ValueError:
        return None
    return -value if negative else value


# ------------------------------------------------------------------ dates

_DATE_ISO = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})")
_DATE_DMY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})")


def _safe_date(year: int, month: int, day: int) -> Optional[str]:
    if year < 100:
        year += 2000
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def detect_day_first(values: List[str]) -> bool:
    """Day-first unless some value proves month-first (e.g. 03/25/2026)."""
    for value in values:
        match = _DATE_DMY.match(str(value).strip())
        if not match:
            continue
        first, second = int(match.group(1)), int(match.group(2))
        if first > 12 >= second:
            return True
        if second > 12 >= first:
            return False
    return True


def parse_date(raw: object, day_first: bool = True) -> Optional[str]:
    text = str(raw or "").strip()
    match = _DATE_ISO.match(text)
    if match:
        return _safe_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    match = _DATE_DMY.match(text)
    if match:
        a, b, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        day, month = (a, b) if day_first else (b, a)
        return _safe_date(year, month, day)
    compact = re.match(r"^(\d{4})(\d{2})(\d{2})", text)
    if compact:
        return _safe_date(int(compact.group(1)), int(compact.group(2)), int(compact.group(3)))
    return None


# -------------------------------------------------------------------- OFX

_OFX_TRANSACTION = re.compile(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>)|(?=</BANKTRANLIST>))", re.S | re.I)


def _ofx_field(block: str, name: str) -> Optional[str]:
    match = re.search(rf"<{name}>([^<\r\n]*)", block, re.I)
    if not match:
        return None
    value = match.group(1).strip()
    return value or None


def looks_like_ofx(content: str) -> bool:
    head = content[:2000].upper()
    return "OFXHEADER" in head or "<OFX>" in head or "<STMTTRN>" in content.upper()


def parse_ofx(content: str) -> ParsedStatement:
    rows: List[ParsedRow] = []
    for block in _OFX_TRANSACTION.findall(content):
        posted = parse_date(_ofx_field(block, "DTPOSTED"))
        amount = parse_amount(_ofx_field(block, "TRNAMT"))
        if not posted or amount is None:
            continue
        name = _ofx_field(block, "NAME") or ""
        memo = _ofx_field(block, "MEMO") or ""
        if memo and normalize_text(memo) not in normalize_text(name):
            description = f"{name} {memo}".strip() if name else memo
        else:
            description = name or memo
        rows.append(ParsedRow(
            date=posted,
            amount=round(amount, 2),
            description=_clean_description(description),
            external_id=_ofx_field(block, "FITID"),
        ))
    if not rows:
        raise StatementParseError("Nenhum lançamento encontrado no arquivo OFX")
    currency = _ofx_field(content, "CURDEF")
    return ParsedStatement(format="ofx", rows=_limit(rows), currency=currency.upper() if currency else None)


# -------------------------------------------------------------------- CSV

HEADER_ALIASES: Dict[str, tuple] = {
    "date": (
        "data", "date", "data lancamento", "data movimento", "data mov", "data operacao",
        "data contabile", "data valuta", "fecha", "fecha operacion", "booking date",
        "transaction date", "posted date", "dt", "data transacao",
    ),
    "description": (
        "descricao", "description", "historico", "lancamento", "descrizione",
        "descripcion", "concepto", "memo", "details", "detalhes", "estabelecimento",
        "name", "payee", "causale", "titulo",
    ),
    "amount": (
        "valor", "amount", "importo", "importe", "valor (r$)", "valor r$",
        "value", "montante", "quantia", "valor em r$", "valor (eur)", "importo (eur)",
    ),
    "debit": (
        "debito", "debit", "saida", "saidas", "uscite", "addebiti", "cargo",
        "withdrawal", "withdrawals", "money out", "debit amount",
    ),
    "credit": (
        "credito", "credit", "entrada", "entradas", "entrate", "accrediti", "abono",
        "deposit", "deposits", "money in", "credit amount",
    ),
}


def _match_column(headers: List[str], field: str) -> Optional[str]:
    normalized = {header: normalize_text(header).strip(" :") for header in headers}
    aliases = HEADER_ALIASES[field]
    for header, key in normalized.items():
        if key in aliases:
            return header
    for header, key in normalized.items():
        if any(key.startswith(alias) for alias in aliases if len(alias) > 3):
            return header
    return None


def detect_mapping(headers: List[str]) -> Optional[Dict[str, Optional[str]]]:
    mapping = {field: _match_column(headers, field) for field in HEADER_ALIASES}
    if mapping["debit"] == mapping["amount"]:
        mapping["debit"] = None
    if mapping["credit"] == mapping["amount"]:
        mapping["credit"] = None
    has_amount = mapping["amount"] or (mapping["debit"] and mapping["credit"])
    if mapping["date"] and mapping["description"] and has_amount:
        return mapping
    return None


def _sniff_dialect(sample: str) -> csv.Dialect:
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,\t|")
    except csv.Error:
        class Fallback(csv.excel):
            delimiter = ";" if sample.count(";") > sample.count(",") else ","
        return Fallback()


def _find_header_row(records: List[List[str]]) -> int:
    """Banks often prepend account info; the header is the first row that maps."""
    for index, record in enumerate(records[:30]):
        if detect_mapping([cell.strip() for cell in record]):
            return index
    return 0


def parse_csv(content: str, mapping: Optional[Dict[str, Optional[str]]] = None) -> ParsedStatement:
    text = content.lstrip("﻿")
    if not text.strip():
        raise StatementParseError("Arquivo vazio")
    dialect = _sniff_dialect(text[:5000])
    records = [row for row in csv.reader(io.StringIO(text), dialect) if any(cell.strip() for cell in row)]
    if not records:
        raise StatementParseError("Arquivo vazio")

    header_index = _find_header_row(records)
    headers = [cell.strip() for cell in records[header_index]]
    selected = mapping or detect_mapping(headers)
    if not selected:
        raise MappingRequired(headers)
    unknown = [value for value in selected.values() if value and value not in headers]
    if unknown:
        raise MappingRequired(headers)
    if not selected.get("date") or not selected.get("description") or not (
        selected.get("amount") or selected.get("debit") or selected.get("credit")
    ):
        raise MappingRequired(headers)

    index = {header: position for position, header in enumerate(headers)}

    def cell(record: List[str], field: str) -> str:
        column = selected.get(field)
        if not column:
            return ""
        position = index[column]
        return record[position].strip() if position < len(record) else ""

    body = records[header_index + 1:]
    day_first = detect_day_first([cell(record, "date") for record in body])

    rows: List[ParsedRow] = []
    for record in body:
        parsed_date = parse_date(cell(record, "date"), day_first)
        if not parsed_date:
            continue  # footer lines such as "Saldo final"
        amount = parse_amount(cell(record, "amount")) if selected.get("amount") else None
        if amount is None:
            debit = parse_amount(cell(record, "debit"))
            credit = parse_amount(cell(record, "credit"))
            if debit:
                amount = -abs(debit)
            elif credit:
                amount = abs(credit)
        if not amount:
            continue
        rows.append(ParsedRow(
            date=parsed_date,
            amount=round(amount, 2),
            description=_clean_description(cell(record, "description")),
        ))
    if not rows:
        raise StatementParseError("Nenhum lançamento encontrado no arquivo CSV")
    return ParsedStatement(format="csv", rows=_limit(rows), headers=headers)


# ----------------------------------------------------------------- common

def _clean_description(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:200] or "Sem descrição"


def _limit(rows: List[ParsedRow]) -> List[ParsedRow]:
    if len(rows) > MAX_ROWS:
        raise StatementParseError(f"O arquivo tem mais de {MAX_ROWS} lançamentos. Divida-o por período.")
    return rows


def parse_statement(
    content: str,
    filename: str = "",
    mapping: Optional[Dict[str, Optional[str]]] = None,
) -> ParsedStatement:
    lower = filename.lower()
    if lower.endswith((".ofx", ".qfx")) or (not lower.endswith(".csv") and looks_like_ofx(content)):
        return parse_ofx(content)
    return parse_csv(content, mapping)


def row_fingerprints(account_id: str, rows: List[ParsedRow]) -> List[str]:
    """Deterministic per-row identity used to never import a row twice.

    OFX rows use the bank's FITID. CSV rows use date, amount and description
    plus an occurrence counter, so two identical coffees on the same day stay
    two distinct rows while re-importing the same file matches both.
    """
    seen: Dict[str, int] = {}
    fingerprints = []
    for row in rows:
        if row.external_id:
            base = f"{account_id}|fitid|{row.external_id}"
        else:
            base = f"{account_id}|{row.date}|{row.amount:.2f}|{normalize_text(row.description)}"
        occurrence = seen.get(base, 0)
        seen[base] = occurrence + 1
        fingerprints.append(hashlib.sha256(f"{base}|{occurrence}".encode()).hexdigest()[:32])
    return fingerprints
