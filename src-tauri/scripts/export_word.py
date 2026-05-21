#!/usr/bin/env python3
import copy
import json
import mimetypes
import re
import sys
from datetime import date
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "office_rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "content": "http://schemas.openxmlformats.org/package/2006/content-types",
}

ET.register_namespace("w", NS["w"])
ET.register_namespace("wp", NS["wp"])
ET.register_namespace("a", NS["a"])
ET.register_namespace("pic", NS["pic"])
ET.register_namespace("r", NS["office_rel"])

W = f"{{{NS['w']}}}"
WP = f"{{{NS['wp']}}}"
A = f"{{{NS['a']}}}"
PIC = f"{{{NS['pic']}}}"
REL = f"{{{NS['rel']}}}"
OFFICE_REL = f"{{{NS['office_rel']}}}"
CONTENT = f"{{{NS['content']}}}"
TABLE_MARKERS = ("{{CARRERA}}", "{{MATERIA}}", "{{FECHA_APLICACION}}")
COORDINATOR_MARKER = "{{NOMBRE_COORDINADOR}}"
IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
ASSET_LAYOUT = {
    "seal": {
        "relationship_id": "rIdAppSeal",
        "drawing_name": "AppMonroySeal",
        "position_h": 2640000,
        "position_v": -852000,
        "extent_cx": 1645920,
        "extent_cy": 1496060,
        "relative_height": "3",
    },
    "signature": {
        "relationship_id": "rIdAppSignature",
        "drawing_name": "AppMonroySignature",
        "position_h": 1840000,
        "position_v": -852000,
        "extent_cx": 1663065,
        "extent_cy": 1457325,
        "relative_height": "4",
    },
}
MONTHS_ES = [
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


def copy_zip_info(info):
    copied = ZipInfo(info.filename, date_time=info.date_time)
    copied.comment = info.comment
    copied.extra = info.extra
    copied.internal_attr = info.internal_attr
    copied.external_attr = info.external_attr
    copied.compress_type = ZIP_DEFLATED
    return copied


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def safe_filename(value):
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:120] or "documento"


def format_date_es(value):
    if not value:
        return ""

    try:
        year, month, day = [int(part) for part in str(value).split("-")[:3]]
        parsed = date(year, month, day)
    except ValueError:
        return str(value)

    return f"{parsed.day} de {MONTHS_ES[parsed.month - 1]} {parsed.year}"


def format_table_date_es(value):
    if not value:
        return ""

    try:
        year, month, day = [int(part) for part in str(value).split("-")[:3]]
        parsed = date(year, month, day)
    except ValueError:
        return str(value)

    return f"{MONTHS_ES[parsed.month - 1].capitalize()} {parsed.day}"


def format_time(value):
    value = str(value or "").strip()
    match = re.match(r"^0?(\d{1,2}):(\d{2})$", value)
    if not match:
        return value
    return f"{int(match.group(1))}:{match.group(2)}"


def office_year(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits[-2:] if len(digits) >= 2 else digits.zfill(2)


def career_from_row(row, sheet):
    group = clean_text(row.get("group", ""))
    group_match = re.match(r"([A-Z]{2,})\b", group)
    if group_match:
        return group_match.group(1)

    label_match = re.search(r"\b(LISI|LI)\b$", clean_text(sheet.get("label", "")))
    if label_match:
        return label_match.group(1)

    return clean_text(sheet.get("career", "")) or "LI"


def teacher_full_name(teacher, titles):
    title = clean_text(titles.get(teacher, ""))
    if title and not title.endswith("."):
        title = f"{title}."
    return f"{title} {teacher}".strip() if title else teacher


def text_content(element):
    return "".join(text.text or "" for text in element.iter(f"{W}t"))


def replace_text_nodes(element, replacements):
    for text in element.iter(f"{W}t"):
        if not text.text:
            continue
        for marker, value in replacements.items():
            text.text = text.text.replace(marker, str(value))


def replace_element_xml(element, replacements):
    xml = ET.tostring(element, encoding="unicode")
    for marker, value in replacements.items():
        xml = xml.replace(escape(marker), escape(str(value)))
    return ET.fromstring(xml)


def image_extension(path):
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    raise ValueError("Firma y sello deben ser imágenes PNG o JPG.")


def image_content_type(extension):
    if extension == ".png":
        return "image/png"
    if extension == ".jpg":
        return "image/jpeg"
    return mimetypes.types_map.get(extension, "application/octet-stream")


def media_target(asset_name, source_path):
    extension = image_extension(source_path)
    return f"media/appmonroy_{asset_name}{extension}"


def image_relationships(payload):
    relationships = {}
    for asset_name, payload_key in (("seal", "sealPath"), ("signature", "signaturePath")):
        source_path = clean_text(payload.get(payload_key, ""))
        if not source_path:
            continue
        path = Path(source_path)
        if not path.exists():
            raise ValueError(f"No se encontró la imagen configurada: {source_path}")

        relationships[asset_name] = {
            "source_path": path,
            "target": media_target(asset_name, source_path),
            "relationship_id": ASSET_LAYOUT[asset_name]["relationship_id"],
            "content_type": image_content_type(image_extension(source_path)),
        }

    return relationships


def build_image_drawing(asset_name, relationship_id):
    layout = ASSET_LAYOUT[asset_name]
    drawing_name = layout["drawing_name"]
    anchor = ET.Element(
        f"{WP}anchor",
        {
            "distT": "0",
            "distB": "0",
            "distL": "0",
            "distR": "0",
            "simplePos": "0",
            "relativeHeight": layout["relative_height"],
            "behindDoc": "1",
            "locked": "0",
            "layoutInCell": "1",
            "allowOverlap": "1",
        },
    )
    ET.SubElement(anchor, f"{WP}simplePos", {"x": "0", "y": "0"})
    position_h = ET.SubElement(anchor, f"{WP}positionH", {"relativeFrom": "column"})
    ET.SubElement(position_h, f"{WP}posOffset").text = str(layout["position_h"])
    position_v = ET.SubElement(anchor, f"{WP}positionV", {"relativeFrom": "paragraph"})
    ET.SubElement(position_v, f"{WP}posOffset").text = str(layout["position_v"])
    ET.SubElement(
        anchor,
        f"{WP}extent",
        {"cx": str(layout["extent_cx"]), "cy": str(layout["extent_cy"])},
    )
    ET.SubElement(anchor, f"{WP}effectExtent", {"l": "0", "t": "0", "r": "0", "b": "0"})
    ET.SubElement(anchor, f"{WP}wrapNone")
    ET.SubElement(anchor, f"{WP}docPr", {"id": "1", "name": drawing_name})
    frame_pr = ET.SubElement(anchor, f"{WP}cNvGraphicFramePr")
    ET.SubElement(frame_pr, f"{A}graphicFrameLocks", {"noChangeAspect": "1"})

    graphic = ET.SubElement(anchor, f"{A}graphic")
    graphic_data = ET.SubElement(
        graphic,
        f"{A}graphicData",
        {"uri": "http://schemas.openxmlformats.org/drawingml/2006/picture"},
    )
    picture = ET.SubElement(graphic_data, f"{PIC}pic")
    non_visual = ET.SubElement(picture, f"{PIC}nvPicPr")
    ET.SubElement(non_visual, f"{PIC}cNvPr", {"id": "1", "name": drawing_name})
    c_nv_pic = ET.SubElement(non_visual, f"{PIC}cNvPicPr")
    ET.SubElement(c_nv_pic, f"{A}picLocks", {"noChangeAspect": "1"})
    ET.SubElement(non_visual, f"{PIC}nvPr")
    blip_fill = ET.SubElement(picture, f"{PIC}blipFill", {"rotWithShape": "1"})
    ET.SubElement(blip_fill, f"{A}blip", {f"{OFFICE_REL}embed": relationship_id})
    ET.SubElement(blip_fill, f"{A}stretch")
    shape_pr = ET.SubElement(picture, f"{PIC}spPr", {"bwMode": "auto"})
    transform = ET.SubElement(shape_pr, f"{A}xfrm")
    ET.SubElement(transform, f"{A}off", {"x": "0", "y": "0"})
    ET.SubElement(
        transform,
        f"{A}ext",
        {"cx": str(layout["extent_cx"]), "cy": str(layout["extent_cy"])},
    )
    preset = ET.SubElement(shape_pr, f"{A}prstGeom", {"prst": "rect"})
    ET.SubElement(preset, f"{A}avLst")
    ET.SubElement(shape_pr, f"{A}noFill")

    drawing = ET.Element(f"{W}drawing")
    drawing.append(anchor)
    run = ET.Element(f"{W}r")
    run.append(drawing)
    return run


def insert_configured_images(root, image_rels):
    if not image_rels:
        return

    target_paragraph = None
    for paragraph in root.iter(f"{W}p"):
        if COORDINATOR_MARKER in text_content(paragraph):
            target_paragraph = paragraph
            break

    if target_paragraph is None:
        raise ValueError(
            "No se encontró {{NOMBRE_COORDINADOR}} para anclar firma y sello."
        )

    parents = parent_map(root)
    parent = parents.get(target_paragraph)
    anchor_paragraph = target_paragraph
    if parent is not None:
        siblings = list(parent)
        target_index = siblings.index(target_paragraph)
        for previous in reversed(siblings[:target_index]):
            if previous.tag == f"{W}p":
                anchor_paragraph = previous
                break

    insert_at = 0
    for asset_name in ("seal", "signature"):
        image_rel = image_rels.get(asset_name)
        if not image_rel:
            continue
        anchor_paragraph.insert(
            insert_at,
            build_image_drawing(asset_name, image_rel["relationship_id"]),
        )
        insert_at += 1


def parent_map(root):
    return {child: parent for parent in root.iter() for child in parent}


def find_table_template_row(root):
    for row in root.iter(f"{W}tr"):
        row_text = text_content(row)
        if all(marker in row_text for marker in TABLE_MARKERS):
            return row
    return None


def fill_table_rows(root, entries):
    template_row = find_table_template_row(root)
    if template_row is None:
        raise ValueError(
            "No se encontró la fila plantilla con {{CARRERA}}, {{MATERIA}} y {{FECHA_APLICACION}}."
        )

    parents = parent_map(root)
    table = parents.get(template_row)
    if table is None:
        raise ValueError("No se pudo ubicar la tabla de materias en la plantilla.")

    rows = list(table)
    template_index = rows.index(template_row)
    table.remove(template_row)

    if not entries:
        entries = [{"career": "", "subject": "", "applicationDate": ""}]

    for offset, entry in enumerate(entries):
        next_row = copy.deepcopy(template_row)
        next_row = replace_element_xml(
            next_row,
            {
                "{{CARRERA}}": entry.get("career", ""),
                "{{MATERIA}}": entry.get("subject", ""),
                "{{FECHA_APLICACION}}": entry.get("applicationDate", ""),
            },
        )
        table.insert(template_index + offset, next_row)


def transform_document_xml(source, replacements, entries):
    root = ET.fromstring(source)
    fill_table_rows(root, entries)
    replace_text_nodes(root, replacements)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def page_break_paragraph():
    paragraph = ET.Element(f"{W}p")
    run = ET.SubElement(paragraph, f"{W}r")
    ET.SubElement(run, f"{W}br", {f"{W}type": "page"})
    return paragraph


def local_name(name):
    return name.rsplit("}", 1)[-1]


def uniquify_drawing_ids(root):
    drawing_id = 1
    shape_id = 1

    for element in root.iter():
        tag_name = local_name(element.tag)

        if tag_name in {"docPr", "cNvPr"} and "id" in element.attrib:
            element.set("id", str(drawing_id))
            drawing_id += 1

        if tag_name == "shape":
            for attribute_name in list(element.attrib):
                attribute_local_name = local_name(attribute_name)
                if attribute_local_name == "id":
                    element.set(attribute_name, f"_x0000_i{shape_id}")
                elif attribute_local_name == "spid":
                    element.set(attribute_name, f"_x0000_s{shape_id}")
            shape_id += 1


def transform_document_xml_pages(source, page_payloads, image_rels):
    root = ET.fromstring(source)
    body = root.find(f"{W}body")
    if body is None:
        raise ValueError("No se encontró el cuerpo del documento Word.")

    body_children = list(body)
    section_properties = None
    if body_children and body_children[-1].tag == f"{W}sectPr":
        section_properties = copy.deepcopy(body_children[-1])
        body_children = body_children[:-1]

    template_page = [copy.deepcopy(child) for child in body_children]
    for child in list(body):
        body.remove(child)

    for index, page_payload in enumerate(page_payloads):
        fragment = ET.Element("fragment")
        for child in template_page:
            fragment.append(copy.deepcopy(child))

        fill_table_rows(fragment, page_payload["entries"])
        insert_configured_images(fragment, image_rels)
        replace_text_nodes(fragment, page_payload["replacements"])

        for child in list(fragment):
            body.append(child)

        if index < len(page_payloads) - 1:
            body.append(page_break_paragraph())

    if section_properties is not None:
        body.append(section_properties)

    uniquify_drawing_ids(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def transform_xml(source, replacements):
    root = ET.fromstring(source)
    replace_text_nodes(root, replacements)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def collect_teacher_entries(sheets):
    grouped = {}
    seen = set()

    for sheet in sheets:
        for block in sheet.get("blocks", []) or []:
            application_date = format_table_date_es(block.get("date", ""))
            for row in block.get("rows", []) or []:
                teacher = clean_text(row.get("teacher", ""))
                subject = clean_text(row.get("subject", ""))
                if not teacher or not subject:
                    continue

                entry = {
                    "career": career_from_row(row, sheet),
                    "subject": subject,
                    "applicationDate": application_date,
                }
                key = (teacher, entry["career"], entry["subject"], entry["applicationDate"])
                if key in seen:
                    continue

                seen.add(key)
                grouped.setdefault(teacher, []).append(entry)

    return {
        teacher: sorted(
            entries,
            key=lambda entry: (
                entry.get("applicationDate", ""),
                entry.get("career", ""),
                entry.get("subject", ""),
            ),
        )
        for teacher, entries in sorted(grouped.items())
    }


def write_teacher_docx(template_path, output_path, replacements, entries):
    with ZipFile(template_path, "r") as source, ZipFile(output_path, "w", ZIP_DEFLATED) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "word/document.xml":
                data = transform_document_xml(data, replacements, entries)
            elif info.filename.startswith("word/") and info.filename.endswith(".xml"):
                data = transform_xml(data, replacements)

            target.writestr(copy_zip_info(info), data)


def update_document_relationships(source, image_rels):
    root = ET.fromstring(source)
    existing_ids = {
        relationship.attrib.get("Id")
        for relationship in root.findall(f"{REL}Relationship")
    }

    for image_rel in image_rels.values():
        relationship_id = image_rel["relationship_id"]
        if relationship_id in existing_ids:
            continue
        ET.SubElement(
            root,
            f"{REL}Relationship",
            {
                "Id": relationship_id,
                "Type": IMAGE_REL_TYPE,
                "Target": image_rel["target"],
            },
        )

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def update_content_types(source, image_rels):
    root = ET.fromstring(source)
    existing_extensions = {
        default.attrib.get("Extension")
        for default in root.findall(f"{CONTENT}Default")
    }

    for image_rel in image_rels.values():
        extension = Path(image_rel["target"]).suffix.lstrip(".")
        if extension in existing_extensions:
            continue
        ET.SubElement(
            root,
            f"{CONTENT}Default",
            {
                "Extension": extension,
                "ContentType": image_rel["content_type"],
            },
        )
        existing_extensions.add(extension)

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def write_teachers_docx(template_path, output_path, page_payloads, image_rels):
    with ZipFile(template_path, "r") as source, ZipFile(output_path, "w", ZIP_DEFLATED) as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "word/document.xml":
                data = transform_document_xml_pages(data, page_payloads, image_rels)
            elif info.filename == "word/_rels/document.xml.rels":
                data = update_document_relationships(data, image_rels)
            elif info.filename == "[Content_Types].xml":
                data = update_content_types(data, image_rels)

            target.writestr(copy_zip_info(info), data)

        for image_rel in image_rels.values():
            target.writestr(
                f"word/{image_rel['target']}",
                image_rel["source_path"].read_bytes(),
            )


def export_word(payload_path, template_path, output_dir):
    payload = json.loads(Path(payload_path).read_text(encoding="utf-8"))
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    teacher_entries = collect_teacher_entries(payload.get("sheets", []))
    if not teacher_entries:
        raise ValueError("No hay maestros con materias para generar documentos Word.")

    year = office_year(payload.get("officeYear", ""))
    start_folio = int(payload.get("startFolio", 1))
    titles = payload.get("teacherTitles", {}) or {}
    image_rels = image_relationships(payload)
    page_payloads = []

    for index, (teacher, entries) in enumerate(teacher_entries.items()):
        folio = start_folio + index
        office_no = f"UAS-FIMAZ-CE-{year}-{folio}"
        full_teacher = teacher_full_name(teacher, titles)
        replacements = {
            "{{OFICIO_NO}}": office_no,
            "{{FECHA_OFICIO}}": format_date_es(payload.get("officeDate", "")),
            "{{NOMBRE_MAESTRO_CON_TITULO}}": full_teacher,
            "{{PERIODO}}": clean_text(payload.get("wordPeriod", "")),
            "{{CICLO_ESCOLAR}}": clean_text(payload.get("wordSchoolYear", "")),
            "{{FECHA_INICIO_EXAMENES}}": format_date_es(payload.get("examStartDate", "")),
            "{{HORA_INICIO}}": format_time(payload.get("hourStart", "")),
            "{{HORA_FIN}}": format_time(payload.get("hourEnd", "")),
            "{{NOMBRE_COORDINADOR}}": clean_text(payload.get("coordinatorName", "")),
            "{{CARRERA}}": "",
            "{{MATERIA}}": "",
            "{{FECHA_APLICACION}}": "",
        }

        page_payloads.append({"replacements": replacements, "entries": entries})

    end_folio = start_folio + len(page_payloads) - 1
    file_name = safe_filename(
        f"Oficios Word UAS-FIMAZ-CE-{year}-{start_folio}-{end_folio}.docx"
    )
    output_path = output_dir / file_name
    write_teachers_docx(template_path, output_path, page_payloads, image_rels)

    return [str(output_path)]


def main():
    if len(sys.argv) != 4:
        print("Uso: export_word.py payload.json template.docx output_dir", file=sys.stderr)
        raise SystemExit(2)

    export_word(sys.argv[1], sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
