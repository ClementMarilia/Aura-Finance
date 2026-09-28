import pytest

from services.statement_import.parser import (
    MappingRequired,
    StatementParseError,
    description_key,
    parse_amount,
    parse_date,
    parse_statement,
    row_fingerprints,
)


@pytest.mark.parametrize("raw, expected", [
    ("1.234,56", 1234.56),
    ("-1.234,56", -1234.56),
    ("1,234.56", 1234.56),
    ("-45.90", -45.9),
    ("R$ 10,00", 10.0),
    ("€ -3,50", -3.5),
    ("(12.00)", -12.0),
    ("12,50-", -12.5),
    ("1 234,56", 1234.56),
    ("1.500", 1500.0),
    ("0.500", 0.5),
    ("2500", 2500.0),
    ("", None),
    ("abc", None),
])
def test_parse_amount_handles_bank_formats(raw, expected):
    assert parse_amount(raw) == expected


def test_parse_date_formats():
    assert parse_date("2026-03-05") == "2026-03-05"
    assert parse_date("05/03/2026") == "2026-03-05"
    assert parse_date("05/03/2026", day_first=False) == "2026-05-03"
    assert parse_date("05.03.26") == "2026-03-05"
    assert parse_date("20260305120000[-3:BRT]") == "2026-03-05"
    assert parse_date("31/02/2026") is None
    assert parse_date("Saldo") is None


OFX_SGML = """OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260310000000[-3:BRT]
<TRNAMT>-52.30
<FITID>A1
<MEMO>PADARIA CENTRAL
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260305
<TRNAMT>3500,00
<FITID>A2
<NAME>SALARIO
<MEMO>EMPRESA X
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""

OFX_XML = """<?xml version="1.0"?><?OFX OFXHEADER="200"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</CURDEF><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260401</DTPOSTED><TRNAMT>-9.99</TRNAMT><FITID>X9</FITID><NAME>NETFLIX</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
"""


def test_parse_ofx_sgml_without_closing_tags():
    statement = parse_statement(OFX_SGML, "extrato.ofx")

    assert statement.format == "ofx"
    assert statement.currency == "BRL"
    assert [(r.date, r.amount, r.description, r.external_id) for r in statement.rows] == [
        ("2026-03-10", -52.3, "PADARIA CENTRAL", "A1"),
        ("2026-03-05", 3500.0, "SALARIO EMPRESA X", "A2"),
    ]


def test_parse_ofx_xml_is_detected_by_content():
    statement = parse_statement(OFX_XML, "download.txt")

    assert statement.format == "ofx"
    assert statement.currency == "EUR"
    assert statement.rows[0].amount == -9.99
    assert statement.rows[0].description == "NETFLIX"


def test_parse_brazilian_csv_with_preamble_and_footer():
    content = (
        "Conta corrente;12345-6\n"
        "\n"
        "Data;Lançamento;Valor (R$);Saldo\n"
        "02/03/2026;PIX RECEBIDO MARIA;1.200,00;1.500,00\n"
        "13/03/2026;COMPRA CARTAO MERCADO;-235,47;1.264,53\n"
        ";Saldo final;;1.264,53\n"
    )

    statement = parse_statement(content, "extrato.csv")

    assert statement.format == "csv"
    assert [(r.date, r.amount, r.description) for r in statement.rows] == [
        ("2026-03-02", 1200.0, "PIX RECEBIDO MARIA"),
        ("2026-03-13", -235.47, "COMPRA CARTAO MERCADO"),
    ]


def test_parse_csv_with_separate_debit_and_credit_columns():
    content = (
        "Data contabile,Descrizione,Uscite,Entrate\n"
        "2026-04-01,Affitto,800.00,\n"
        "2026-04-02,Stipendio,,2100.50\n"
    )

    rows = parse_statement(content, "movimenti.csv").rows

    assert [(r.amount, r.description) for r in rows] == [(-800.0, "Affitto"), (2100.5, "Stipendio")]


def test_parse_us_csv_detects_month_first_dates():
    content = (
        "Date,Description,Amount\n"
        "03/25/2026,Coffee,-4.50\n"
        "04/01/2026,Paycheck,2000.00\n"
    )

    rows = parse_statement(content, "bank.csv").rows

    assert [r.date for r in rows] == ["2026-03-25", "2026-04-01"]


def test_unknown_csv_columns_require_mapping_then_accept_it():
    content = "Quando;O quê;Quanto\n01/05/2026;Loja;-10,00\n"

    with pytest.raises(MappingRequired) as error:
        parse_statement(content, "x.csv")
    assert error.value.headers == ["Quando", "O quê", "Quanto"]

    rows = parse_statement(
        content, "x.csv", {"date": "Quando", "description": "O quê", "amount": "Quanto"}
    ).rows
    assert [(r.date, r.amount) for r in rows] == [("2026-05-01", -10.0)]


def test_empty_file_is_rejected():
    with pytest.raises(StatementParseError):
        parse_statement("   ", "vazio.csv")


def test_fingerprints_distinguish_identical_rows_but_are_stable():
    content = "Data;Descrição;Valor\n01/05/2026;Café;-3,50\n01/05/2026;Café;-3,50\n"
    rows = parse_statement(content, "a.csv").rows

    first = row_fingerprints("acc-1", rows)
    again = row_fingerprints("acc-1", parse_statement(content, "a.csv").rows)

    assert len(set(first)) == 2
    assert first == again
    assert row_fingerprints("acc-2", rows) != first


def test_description_key_ignores_dates_digits_and_accents():
    assert description_key("PIX ENVIADO 12/03 JOÃO") == description_key("Pix enviado 15/04 Joao")
