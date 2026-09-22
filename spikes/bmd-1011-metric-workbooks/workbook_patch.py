"""
Surgical editing of a Defra Statutory Biodiversity Metric v4 workbook.

An .xlsx is a zip of XML parts. This rewrites only the worksheet parts it has
to touch and copies every other entry byte-for-byte, so styles, data
validation, charts, defined names and the other 40-odd sheets survive exactly
as they were.

Why not just load and re-save with a spreadsheet library: SheetJS preserves the
formulas but re-serialises the styles, taking the file from 3.6MB to 82MB. At a
few hundred scenarios that is not a corpus anyone can keep.

Python's stdlib is used only because it has zip and XML built in. A production
writer living beside the reader in src/workbook/ would need a small zip
dependency in Node (fflate or similar); that choice was not worth making before
the approach was proven.
"""

import re
import zipfile
from xml.sax.saxutils import escape


def sheet_part(zin, sheet_name):
    """The worksheet XML part backing a sheet, by its display name."""
    wb = zin.read('xl/workbook.xml').decode('utf8')
    rels = zin.read('xl/_rels/workbook.xml.rels').decode('utf8')
    relmap = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
    pattern = r'<sheet name="([^"]+)" sheetId="\d+"[^>]*r:id="([^"]+)"'
    for name, rid in re.findall(pattern, wb):
        if name == sheet_name:
            return 'xl/' + relmap[rid].lstrip('/')
    raise KeyError(f'no sheet named {sheet_name!r}')


def _cell_xml(xml, ref):
    """The whole <c> element for a ref, self-closing or not."""
    match = re.search(r'<c r="%s"(?:\s[^>]*)?/>' % ref, xml)
    if match:
        return match
    return re.search(r'<c r="%s"(?:\s[^>]*)?>.*?</c>' % ref, xml, re.S)


def _style_of(cell_xml):
    match = re.search(r'\ss="(\d+)"', cell_xml)
    return f' s="{match.group(1)}"' if match else ''


def set_value(xml, ref, value):
    """
    Put a literal into an input cell, keeping its style.

    Strings are written inline rather than through the shared-strings table:
    the table is a separate part with its own count attributes, and rewriting
    it is a second chance to corrupt the file for no gain. Excel and
    LibreOffice both read inline strings.
    """
    match = _cell_xml(xml, ref)
    if not match:
        raise KeyError(f'cell {ref} is not in the sheet XML')
    existing = match.group(0)
    if '<f' in existing:
        raise ValueError(f'{ref} holds a formula, not an input')

    style = _style_of(existing)
    if isinstance(value, (int, float)):
        body = f'<v>{value}</v>'
        type_attr = ''
    else:
        body = f'<is><t xml:space="preserve">{escape(str(value))}</t></is>'
        type_attr = ' t="inlineStr"'
    replacement = f'<c r="{ref}"{style}{type_attr}>{body}</c>'
    return xml[: match.start()] + replacement + xml[match.end():]


def set_formula(xml, ref, formula):
    """
    Replace a cell's formula, dropping its cached value.

    The stale value has to go: a reader that does not recalculate would
    otherwise report the old answer as though it were the new one.
    """
    match = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not match:
        raise KeyError(ref)
    attrs, body = match.group(1), match.group(2)
    formula_attrs = re.search(r'<f([^>]*)>', body)
    formula_attrs = formula_attrs.group(1) if formula_attrs else ''
    replacement = f'<c r="{ref}"{attrs}><f{formula_attrs}>{escape(formula)}</f></c>'
    return xml[: match.start()] + replacement + xml[match.end():]


def patch_workbook(src, dst, edits):
    """
    Apply edits and write a new workbook.

    edits: { sheet name: { cell ref: value } } for inputs, and the same shape
    under the key `_formulas` for formula corrections.
    """
    zin = zipfile.ZipFile(src)
    parts = {}
    for sheet, cells in edits.items():
        if sheet == '_formulas':
            continue
        part = sheet_part(zin, sheet)
        xml = parts.get(part) or zin.read(part).decode('utf8')
        for ref, value in cells.items():
            xml = set_value(xml, ref, value)
        parts[part] = xml
    for sheet, cells in edits.get('_formulas', {}).items():
        part = sheet_part(zin, sheet)
        xml = parts.get(part) or zin.read(part).decode('utf8')
        for ref, formula in cells.items():
            xml = set_formula(xml, ref, formula)
        parts[part] = xml

    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = parts[item.filename].encode('utf8') if item.filename in parts \
                else zin.read(item.filename)
            zout.writestr(item, data)
    zin.close()
    return sorted(parts)
