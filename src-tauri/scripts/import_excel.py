#!/usr/bin/env python3
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "office_rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}

MAIN = f"{{{NS['main']}}}"
OFFICE_REL = f"{{{NS['office_rel']}}}"

MONTHS = {
    "ENERO": 1,
    "FEBRERO": 2,
    "MARZO": 3,
    "ABRIL": 4,
    "MAYO": 5,
    "JUNIO": 6,
    "JULIO": 7,
    "AGOSTO": 8,
    "SEPTIEMBRE": 9,
    "SETIEMBRE": 9,
    "OCTUBRE": 10,
    "NOVIEMBRE": 11,
    "DICIEMBRE": 12,
}

MONTH_NAMES = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
]

WEEKDAYS = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
]


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def canonical(value):
    normalized = unicodedata.normalize("NFD", clean_text(value))
    stripped = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return stripped.upper()


def title_es(value):
    return " ".join(part.capitalize() for part in clean_text(value).lower().split())


def cell_column(reference):
    match = re.match(r"([A-Z]+)", reference or "")
    return match.group(1) if match else ""


def cell_row(reference):
    match = re.search(r"(\d+)$", reference or "")
    return int(match.group(1)) if match else 0


def read_shared_strings(source):
    if "xl/sharedStrings.xml" not in source.namelist():
        return []

    root = ET.fromstring(source.read("xl/sharedStrings.xml"))
    return [
        "".join(text.text or "" for text in item.iter(f"{MAIN}t"))
        for item in root.findall(f"{MAIN}si")
    ]


def cell_value(cell, shared_strings):
    value_node = cell.find(f"{MAIN}v")
    inline_node = cell.find(f"{MAIN}is")

    if cell.attrib.get("t") == "s" and value_node is not None:
        index = int(value_node.text or 0)
        return shared_strings[index] if index < len(shared_strings) else ""

    if inline_node is not None:
        return "".join(text.text or "" for text in inline_node.iter(f"{MAIN}t"))

    return value_node.text if value_node is not None else ""


def worksheet_rows(source, sheet_path, shared_strings):
    root = ET.fromstring(source.read(sheet_path))
    rows = {}

    for cell in root.findall(f".//{MAIN}c"):
        reference = cell.attrib.get("r", "")
        row_number = cell_row(reference)
        column = cell_column(reference)
        if not row_number or not column:
            continue

        rows.setdefault(row_number, {})[column] = clean_text(cell_value(cell, shared_strings))

    return rows


def workbook_sheets(source):
    workbook = ET.fromstring(source.read("xl/workbook.xml"))
    rels = ET.fromstring(source.read("xl/_rels/workbook.xml.rels"))
    targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall(f"{{{NS['rel']}}}Relationship")
    }

    sheets = []
    for sheet in workbook.findall(f"{MAIN}sheets/{MAIN}sheet"):
        relationship_id = sheet.attrib.get(f"{OFFICE_REL}id")
        target = targets.get(relationship_id, "")
        path = target.lstrip("/")
        if not path.startswith("xl/"):
            path = f"xl/{path}"
        sheets.append((sheet.attrib.get("name", ""), path))

    return sheets


def parse_school_year(value):
    years = re.findall(r"(?:19|20)\d{2}", str(value or ""))
    if len(years) >= 2:
        return f"{years[0]}-{years[1]}"
    return clean_text(value).replace("CICLO ESCOLAR", "").replace("Ciclo Escolar", "").strip()


def parse_period(value):
    text = clean_text(value)
    match = re.search(r"PERIODO\s*(\d+)\s*:?\s*(.*)", text, flags=re.IGNORECASE)
    if not match:
        return "Periodo", title_es(text), None

    period_number = int(match.group(1))
    period_name = f"Periodo {period_number}"
    period_range = title_es(match.group(2).replace("-", " - "))
    period_range = re.sub(r"\s+-\s+", " - ", period_range)
    return period_name, period_range, period_number


def infer_year(school_year, period_number, month):
    years = [int(year) for year in re.findall(r"(?:19|20)\d{2}", school_year or "")]
    if len(years) >= 2:
        if period_number == 1:
            return years[0]
        if period_number == 2:
            return years[1]
        return years[1] if month <= 6 else years[0]

    if years:
        return years[0]

    return date.today().year


def career_code_from_text(value):
    text = canonical(value)
    if "LISI" in text or "SISTEMAS DE INFORMACION" in text:
        return "LISI"
    if re.search(r"\bLI\b", text) or "INFORMATICA" in text:
        return "LI"
    return ""


def parse_sheet_name(name, school_year, period_number):
    text = canonical(name)
    month_pattern = "|".join(MONTHS.keys())
    match = re.search(
        rf"\b({month_pattern})\s+(\d{{1,2}})(?:\s*-\s*(\d{{1,2}}))?(?:\s+(LISI|LI))?\b",
        text,
    )
    if not match:
        return None

    month = MONTHS[match.group(1)]
    first_day = int(match.group(2))
    second_day = int(match.group(3) or match.group(2))
    year = infer_year(school_year, period_number, month)

    return {
        "firstDate": date(year, month, first_day).isoformat(),
        "secondDate": date(year, month, second_day).isoformat(),
        "careerCode": match.group(4) or "",
    }


def parse_date_label(value, school_year, period_number):
    text = canonical(value)
    month_pattern = "|".join(MONTHS.keys())
    match = re.search(rf"\b(\d{{1,2}})\s+DE\s+({month_pattern})\b", text)
    if not match:
        return ""

    day = int(match.group(1))
    month = MONTHS[match.group(2)]
    year = infer_year(school_year, period_number, month)
    return date(year, month, day).isoformat()


def format_day(value):
    if not value:
        return ""

    year, month, day = [int(part) for part in value.split("-")]
    parsed = date(year, month, day)
    weekday = WEEKDAYS[parsed.weekday()]
    month_name = MONTH_NAMES[parsed.month - 1]
    return f"{weekday}, {parsed.day:02d} de {month_name}"


def is_turn_label(value):
    return canonical(value).startswith("TURNO")


def is_table_header(row):
    return canonical(row.get("A", "")).startswith("HORA") and canonical(
        row.get("B", "")
    ).startswith("MATERIA")


def is_date_label(value):
    return bool(parse_date_label(value, "2000-2001", 1))


def is_exam_time(value):
    return bool(re.search(r"\d{1,2}:\d{2}", clean_text(value)))


def should_stop_data(row):
    first_cell = row.get("A", "")
    return is_turn_label(first_cell) or is_table_header(row) or is_date_label(first_cell)


def nearest_date(date_rows, row_number, fallback):
    candidates = [item for item in date_rows if item[0] < row_number]
    if not candidates:
        return fallback
    return candidates[-1][1]


def parse_sheet(name, rows, school_year, period_number):
    career = clean_text(rows.get(7, {}).get("A", ""))
    parsed_name = parse_sheet_name(name, school_year, period_number) or {}
    career_code = parsed_name.get("careerCode") or career_code_from_text(career)

    date_rows = []
    for row_number, row in sorted(rows.items()):
        parsed_date = parse_date_label(row.get("A", ""), school_year, period_number)
        if parsed_date:
            date_rows.append((row_number, parsed_date))

    first_date = parsed_name.get("firstDate") or (date_rows[0][1] if date_rows else "")
    second_date = parsed_name.get("secondDate") or (
        date_rows[1][1] if len(date_rows) > 1 else first_date
    )

    blocks = []
    row_numbers = sorted(rows)
    max_row = max(row_numbers, default=0)

    for row_number in row_numbers:
        row = rows[row_number]
        turn = clean_text(row.get("A", ""))
        if not is_turn_label(turn):
            continue

        header_row = None
        for offset in range(1, 4):
            candidate_number = row_number + offset
            if is_table_header(rows.get(candidate_number, {})):
                header_row = candidate_number
                break

        if header_row is None:
            continue

        block_date = nearest_date(date_rows, row_number, first_date)
        data_rows = []
        current_row = header_row + 1

        while current_row <= max_row:
            data_row = rows.get(current_row, {})
            if should_stop_data(data_row):
                break

            exam_row = {
                "time": clean_text(data_row.get("A", "")),
                "subject": clean_text(data_row.get("B", "")),
                "teacher": clean_text(data_row.get("E", "")),
                "group": clean_text(data_row.get("H", "")),
            }

            if (
                is_exam_time(exam_row["time"])
                and exam_row["subject"]
                and exam_row["teacher"]
            ):
                data_rows.append(exam_row)

            current_row += 1

        if data_rows:
            blocks.append(
                {
                    "day": format_day(block_date),
                    "date": block_date,
                    "turn": turn,
                    "career": career or career_code,
                    "rows": data_rows,
                }
            )

    return {
        "label": clean_text(name),
        "firstDate": first_date,
        "secondDate": second_date,
        "blocks": blocks,
    }


def import_excel(path):
    excel_path = Path(path)
    if not excel_path.exists():
        raise ValueError(f"No se encontró el archivo: {excel_path}")

    with ZipFile(excel_path) as source:
        shared_strings = read_shared_strings(source)
        workbook_items = workbook_sheets(source)
        all_rows = [
            (name, worksheet_rows(source, sheet_path, shared_strings))
            for name, sheet_path in workbook_items
        ]

    first_rows = all_rows[0][1] if all_rows else {}
    school_year = parse_school_year(first_rows.get(9, {}).get("A", ""))
    period_name, period_range, period_number = parse_period(first_rows.get(10, {}).get("A", ""))

    sheets = [
        parse_sheet(name, rows, school_year, period_number)
        for name, rows in all_rows
    ]
    sheets = [sheet for sheet in sheets if sheet["blocks"]]

    if not sheets:
        raise ValueError("No se encontraron tablas de examen dentro del Excel.")

    imported_row_count = sum(
        len(block["rows"]) for sheet in sheets for block in sheet["blocks"]
    )
    exam_start_date = min(
        block["date"] for sheet in sheets for block in sheet["blocks"] if block["date"]
    )

    return {
        "periodName": period_name,
        "periodRange": period_range,
        "schoolYear": school_year,
        "examStartDate": exam_start_date,
        "importedRowCount": imported_row_count,
        "sheets": sheets,
    }


def main():
    if len(sys.argv) != 2:
        print("Uso: import_excel.py calendario.xlsx", file=sys.stderr)
        sys.exit(1)

    result = import_excel(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
