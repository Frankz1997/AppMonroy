#!/usr/bin/env python3
import copy
import json
import re
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from xml.etree import ElementTree as ET

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "office_rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "content": "http://schemas.openxmlformats.org/package/2006/content-types",
}

ET.register_namespace("", NS["main"])
ET.register_namespace("r", NS["office_rel"])

MAIN = f"{{{NS['main']}}}"
REL = f"{{{NS['rel']}}}"
OFFICE_REL = f"{{{NS['office_rel']}}}"
CONTENT = f"{{{NS['content']}}}"

BLOCKS = [
    {"date_row": 12, "title_row": 13, "start_row": 15},
    {"date_row": 12, "title_row": 22, "start_row": 25},
    {"date_row": 33, "title_row": 34, "start_row": 36},
    {"date_row": 33, "title_row": 43, "start_row": 46},
]
ROWS_PER_BLOCK = 6
DATA_STYLE_BY_COLUMN = {
    1: "10",
    2: "11",
    5: "11",
    8: "12",
}


def column_to_number(column):
    value = 0
    for char in column:
        value = value * 26 + ord(char.upper()) - ord("A") + 1
    return value


def cell_column_number(reference):
    match = re.match(r"([A-Z]+)", reference)
    if not match:
        return 0
    return column_to_number(match.group(1))


def safe_sheet_name(name, fallback):
    cleaned = re.sub(r"[\[\]:*?/\\]", " ", name or fallback).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or fallback)[:31]


def clean_career_name(name):
    value = re.split(r"\s+(?:HORA|FECHA|PERIODO|GRUPO):", name or "", maxsplit=1)[0]
    return re.sub(r"\s+", " ", value).strip()


def copy_zip_info(info):
    copied = ZipInfo(info.filename, date_time=info.date_time)
    copied.comment = info.comment
    copied.extra = info.extra
    copied.internal_attr = info.internal_attr
    copied.external_attr = info.external_attr
    copied.compress_type = ZIP_DEFLATED
    return copied


def parse_xml(source, name):
    return ET.fromstring(source.read(name))


def xml_bytes(root):
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def row_map(sheet_root):
    sheet_data = sheet_root.find(f"{MAIN}sheetData")
    return {int(row.attrib["r"]): row for row in sheet_data.findall(f"{MAIN}row")}


def get_cell(rows, row_number, column, style=None):
    row = rows[row_number]
    reference = f"{column}{row_number}"
    for cell in row.findall(f"{MAIN}c"):
        if cell.attrib.get("r") == reference:
            return cell

    cell = ET.Element(f"{MAIN}c", {"r": reference})
    if style:
        cell.set("s", style)

    inserted = False
    target_column = column_to_number(column)
    for index, sibling in enumerate(list(row)):
        if sibling.tag != f"{MAIN}c":
            continue
        if cell_column_number(sibling.attrib.get("r", "")) > target_column:
            row.insert(index, cell)
            inserted = True
            break

    if not inserted:
        row.append(cell)

    return cell


def set_cell_text(rows, row_number, column, value, style=None):
    cell = get_cell(rows, row_number, column, style)
    if style and "s" not in cell.attrib:
        cell.set("s", style)

    for child in list(cell):
        cell.remove(child)

    value = str(value or "")
    if not value:
        cell.attrib.pop("t", None)
        return

    cell.set("t", "inlineStr")
    inline_string = ET.SubElement(cell, f"{MAIN}is")
    text = ET.SubElement(inline_string, f"{MAIN}t")
    text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    text.text = value


def clear_block(rows, block):
    set_cell_text(rows, block["title_row"], "A", "", "6")
    for offset in range(ROWS_PER_BLOCK):
        row_number = block["start_row"] + offset
        for column_number, column in ((1, "A"), (2, "B"), (5, "E"), (8, "H")):
            set_cell_text(
                rows,
                row_number,
                column,
                "",
                DATA_STYLE_BY_COLUMN[column_number],
            )


def write_block(rows, block, data):
    set_cell_text(rows, block["title_row"], "A", data.get("turn", ""), "6")
    source_rows = data.get("rows") or []
    for offset in range(ROWS_PER_BLOCK):
        row_number = block["start_row"] + offset
        row = source_rows[offset] if offset < len(source_rows) else {}
        set_cell_text(rows, row_number, "A", row.get("time", ""), "10")
        set_cell_text(rows, row_number, "B", row.get("subject", ""), "11")
        set_cell_text(rows, row_number, "E", row.get("teacher", ""), "11")
        set_cell_text(rows, row_number, "H", row.get("group", ""), "12")


def fill_sheet(sheet_root, sheet, payload, selected=False):
    rows = row_map(sheet_root)
    blocks = sheet.get("blocks") or []
    career = clean_career_name(blocks[0].get("career", "") if blocks else "")

    set_cell_text(rows, 7, "A", career, "3")
    set_cell_text(rows, 9, "A", f"CICLO ESCOLAR {payload.get('schoolYear', '')}", "4")
    set_cell_text(
        rows,
        10,
        "A",
        f"{payload.get('periodName', '')}: {payload.get('periodRange', '')}".upper(),
        "4",
    )

    first_day = blocks[0].get("day", "") if len(blocks) > 0 else ""
    second_day = blocks[2].get("day", "") if len(blocks) > 2 else ""
    set_cell_text(rows, 12, "A", first_day.upper(), "5")
    set_cell_text(rows, 33, "A", second_day.upper(), "5")

    for index, block_template in enumerate(BLOCKS):
        if index < len(blocks):
            write_block(rows, block_template, blocks[index])
        else:
            clear_block(rows, block_template)

    sheet_view = sheet_root.find(f"{MAIN}sheetViews/{MAIN}sheetView")
    if sheet_view is not None and not selected:
        sheet_view.attrib.pop("tabSelected", None)


def remove_overrides(content_root, predicate):
    for override in list(content_root.findall(f"{CONTENT}Override")):
        if predicate(override.attrib.get("PartName", "")):
            content_root.remove(override)


def add_override(content_root, part_name, content_type):
    ET.SubElement(
        content_root,
        f"{CONTENT}Override",
        {"PartName": part_name, "ContentType": content_type},
    )


def max_relationship_id(rels_root):
    values = []
    for relationship in rels_root.findall(f"{REL}Relationship"):
        match = re.match(r"rId(\d+)$", relationship.attrib.get("Id", ""))
        if match:
            values.append(int(match.group(1)))
    return max(values, default=0)


def update_workbook(workbook_root, workbook_rels_root, sheets):
    sheets_node = workbook_root.find(f"{MAIN}sheets")
    for sheet in list(sheets_node.findall(f"{MAIN}sheet")):
        sheets_node.remove(sheet)

    for relationship in list(workbook_rels_root.findall(f"{REL}Relationship")):
        if relationship.attrib.get("Type", "").endswith("/worksheet"):
            workbook_rels_root.remove(relationship)

    next_relationship = max_relationship_id(workbook_rels_root) + 1
    for index, sheet in enumerate(sheets, start=1):
        relationship_id = f"rId{next_relationship}"
        next_relationship += 1
        ET.SubElement(
            workbook_rels_root,
            f"{REL}Relationship",
            {
                "Id": relationship_id,
                "Type": f"{NS['office_rel']}/worksheet",
                "Target": f"worksheets/sheet{index}.xml",
            },
        )
        ET.SubElement(
            sheets_node,
            f"{MAIN}sheet",
            {
                "name": safe_sheet_name(sheet.get("label", ""), f"Hoja {index}"),
                "sheetId": str(index),
                "state": "visible",
                f"{OFFICE_REL}id": relationship_id,
            },
        )


def update_content_types(content_root, sheet_count):
    remove_overrides(
        content_root,
        lambda part: part.startswith("/xl/worksheets/sheet")
        or part.startswith("/xl/drawings/drawing"),
    )

    for index in range(1, sheet_count + 1):
        add_override(
            content_root,
            f"/xl/worksheets/sheet{index}.xml",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
        )
        add_override(
            content_root,
            f"/xl/drawings/drawing{index}.xml",
            "application/vnd.openxmlformats-officedocument.drawing+xml",
        )


def worksheet_relationship(drawing_index):
    root = ET.Element(f"{REL}Relationships")
    ET.SubElement(
        root,
        f"{REL}Relationship",
        {
            "Id": "rId1",
            "Type": f"{NS['office_rel']}/drawing",
            "Target": f"../drawings/drawing{drawing_index}.xml",
        },
    )
    return root


def write_xlsx(template_path, output_path, payload):
    sheets = payload.get("sheets") or []
    if not sheets:
        raise ValueError("No hay hojas para exportar.")

    with ZipFile(template_path) as source:
        workbook_root = parse_xml(source, "xl/workbook.xml")
        workbook_rels_root = parse_xml(source, "xl/_rels/workbook.xml.rels")
        content_root = parse_xml(source, "[Content_Types].xml")
        template_sheet_root = parse_xml(source, "xl/worksheets/sheet1.xml")
        drawing_root = parse_xml(source, "xl/drawings/drawing1.xml")
        drawing_rels_root = parse_xml(source, "xl/drawings/_rels/drawing1.xml.rels")

        update_workbook(workbook_root, workbook_rels_root, sheets)
        update_content_types(content_root, len(sheets))

        generated_files = {
            "xl/workbook.xml": xml_bytes(workbook_root),
            "xl/_rels/workbook.xml.rels": xml_bytes(workbook_rels_root),
            "[Content_Types].xml": xml_bytes(content_root),
        }

        for index, sheet in enumerate(sheets, start=1):
            sheet_root = copy.deepcopy(template_sheet_root)
            fill_sheet(sheet_root, sheet, payload, selected=index == 1)
            generated_files[f"xl/worksheets/sheet{index}.xml"] = xml_bytes(sheet_root)
            generated_files[f"xl/worksheets/_rels/sheet{index}.xml.rels"] = xml_bytes(
                worksheet_relationship(index)
            )
            generated_files[f"xl/drawings/drawing{index}.xml"] = xml_bytes(
                copy.deepcopy(drawing_root)
            )
            generated_files[f"xl/drawings/_rels/drawing{index}.xml.rels"] = xml_bytes(
                copy.deepcopy(drawing_rels_root)
            )

        skip_prefixes = (
            "xl/worksheets/sheet",
            "xl/worksheets/_rels/sheet",
            "xl/drawings/drawing",
            "xl/drawings/_rels/drawing",
        )
        skip_names = {
            "xl/workbook.xml",
            "xl/_rels/workbook.xml.rels",
            "[Content_Types].xml",
        }

        with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as target:
            for info in source.infolist():
                if info.filename in skip_names or info.filename.startswith(skip_prefixes):
                    continue
                target.writestr(copy_zip_info(info), source.read(info.filename))

            for name, data in generated_files.items():
                target.writestr(name, data)


def main():
    if len(sys.argv) != 4:
        print("Uso: export_excel.py payload.json template.xlsx output.xlsx", file=sys.stderr)
        return 2

    payload_path = Path(sys.argv[1])
    template_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])
    payload = json.loads(payload_path.read_text(encoding="utf-8"))

    if output_path.suffix.lower() != ".xlsx":
        raise ValueError("El exportador directo solo genera archivos .xlsx.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_xlsx(template_path, output_path, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
