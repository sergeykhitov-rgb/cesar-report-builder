#!/usr/bin/env python3
"""Import CESAR calculator workbooks into stable, reviewable JSON catalogs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Iterable

import xlrd
from openpyxl import load_workbook


SYSTEM_LABELS = {
    "ritm": "Ритм",
    "si-nord": "Си-Норд",
    "hikvision": "Hikvision",
    "rental-used": "Б/У комплекты для аренды",
    "other": "Другое",
}
STOCK_SHEETS = {"13.08.26", "13.08.26 2725"}
REVIEWED_NON_PRICE_EQUIPMENT = {
    ("103367", "Блок питания 12В 1.5А, FE-12/15 mini,", "Для реле слаботочного"),
    ("50663", "Кабель электропитания 2*0.75мм, ШВВП - 1м", "Для извещателя утечки газа"),
    ("50663", "Кабель электропитания 2*0.75мм, ШВВП - 3м", "Для реле и выключателя"),
    ("50663", "Кабель электропитания 2*0.75мм, ШВВП - 3м", "Для реле слаботочного и силового"),
    ("5211", "Аккумулятор 12V/1,2 А/ч", "Для НОРД GSM/WRL"),
    ("5211", "Аккумулятор 12V/1,2 А/ч", "Для Mega Light 433"),
    ("60725", "Клеммник соединит. WAGO 222-413/CU 3BX - 2шт", "Для реле и выключателя"),
    ("60725", "Клеммник соединит. WAGO 222-413/CU 3BX - 2шт", "Для реле слаботочного и силового"),
    ("96937", "Шнур ШВВП с плоской вилкой", "Для Mega Light 434"),
    ("96937", "Шнур ШВВП с плоской вилкой", "Для сирены"),
}

# These inventory codes describe the same sellable item in several specification
# sheets, but the workbook editors used annotations or omitted a model in some
# copies. Only the exact reviewed variants below may share a stable key. A new
# spelling or model is treated as a conflict instead of being silently merged.
EQUIPMENT_VARIANT_ALLOWLIST = {
    ("si-nord", "91068"): {
        "canonical": ("Комплект Выгодный дом Си-Норд (панель, клав, СМК, 2ИК, Брелок, 1ДУВ, ТЕМП, ДИП, АНТ)", "Норд-GSM"),
        "variants": {
            ("Комплект Выгодный дом Си-Норд (панель, клав, СМК, 2ИК, Брелок, ДУВ, ТЕМП, ДИП, АНТ)", "Норд-GSM"),
            ("Комплект Выгодный дом Си-Норд (панель, клав, СМК, 2ИК, Брелок, 1ДУВ, ТЕМП, ДИП, АНТ)", "Норд-GSM"),
        },
    },
    ("si-nord", "64495"): {
        "canonical": ("Адаптер СИ-НОРД, Ethemet", "Ethemet"),
        "variants": {(я, м) for я, м in [
            ("Адаптер СИ-НОРД, Ethemet", ""),
            ("Адаптер СИ-НОРД, Ethemet", "Ethemet"),
        ]},
    },
    ("si-nord", "98957"): {
        "canonical": ("Ящик с кодовым механизмом - сейф-бокс для ключей", "Сейф-бокс"),
        "variants": {(я, м) for я, м in [
            ("Ящик с кодовым механизмом - сейф-бокс для ключей", ""),
            ("Ящик с кодовым механизмом - сейф-бокс для ключей", "Сейф-бокс"),
        ]},
    },
    ("hikvision", "108840"): {
        "canonical": ("Датчик ИК беспроводной, защита от животных Hikvision, DS-PDP15P-EG2-WE,", "PIR"),
        "variants": {(я, "PIR") for я in [
            "Датчик ИК беспроводной, защита от животных Hikvision, DS-PDP15P-EG2-WE,",
            "Датчик ИК беспроводной, защита от животных Hikvision, DS-PDP15P-EG2-WE, ТРИ ВАРИАНТА ЗАМЕНЫ НИЖЕ",
        ]},
    },
    ("hikvision", "103206"): {
        "canonical": ("Датчик протечки воды (AX PRO) Hikvision, DS-PDWL-E-WE,", "WaterLeak"),
        "variants": {(я, "WaterLeak") for я in [
            "Датчик протечки воды (AX PRO) Hikvision, DS-PDWL-E-WE,",
            "Датчик протечки воды (AX PRO) Hikvision, DS-PDWL-E-WE, ВАРИАНТ ЗАМЕНЫ НИЖЕ",
        ]},
    },
    ("hikvision", "108841"): {
        "canonical": ("Извещатель пожар, дымовой Hikvision, DS-PDSMK-S-WE,", "Smoke"),
        "variants": {(я, "Smoke") for я in [
            "Извещатель пожар, дымовой Hikvision, DS-PDSMK-S-WE,",
            "Извещатель пожар, дымовой Hikvision, DS-PDSMK-S-WE, вариант для панелей RU ниже",
        ]},
    },
    ("hikvision", "108844"): {
        "canonical": ("Датчик СМК беспроводной Hikvision, DS-PDMC-EG2-WE,", "Door"),
        "variants": {(я, "Door") for я in [
            "Датчик СМК беспроводной Hikvision, DS-PDMC-EG2-WE,",
            "Датчик СМК беспроводной Hikvision, DS-PDMC-EG2-WE, ВАРИАНТ ЗАМЕНЫ НИЖЕ",
        ]},
    },
    ("si-nord", "89012"): {
        "canonical": ("Датчик температурный СИ-НОРД, выносной, проводной", "выносной"),
        "variants": {(я, м) for я, м in [
            ("Датчик температурный СИ-НОРД, выносной, проводной", ""),
            ("Датчик температурный СИ-НОРД, выносной, проводной", "выносной"),
        ]},
    },
    ("si-nord", "100334"): {
        "canonical": ("Расширитель СИ-НОРД охранный, ЕХ81", "ЕХ81"),
        "variants": {(
            "Расширитель СИ-НОРД, ЕХ81 проводных шлейфов", ""
        ), (
            "Расширитель СИ-НОРД охранный, ЕХ81", "ЕХ81"
        )},
    },
    ("si-nord", "102022"): {
        "canonical": ("Расширитель СИ-НОРД пожарный, ЕХ22", "ЕХ22"),
        "variants": {(
            "Расширитель СИ-НОРД, ЕХ22 пожарных шлейфов", ""
        ), (
            "Расширитель СИ-НОРД пожарный, ЕХ22", "ЕХ22"
        )},
    },
    ("si-nord", "64491"): {
        "canonical": ("Датчик магнитоконтактный СИ-НОРД, СН-СМК исп.1", "СН-СМК"),
        "variants": {(я, "СН-СМК") for я in [
            "Датчик магнитоконтактный СИ-НОРД, СН-СМК исп.1",
            "Датчик магнитоконтактный СИ-НОРД, СН-СМК исп.1 (большой,ПРД для подключения стороннего оборудования)",
        ]},
    },
}


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def format_source(source: dict[str, Any] | None, field: str) -> str:
    if not source:
        return field
    return (
        f"{source.get('workbook', '<unknown workbook>')} / "
        f"{source.get('sheet', '<unknown sheet>')} row {source.get('row', '<unknown>')} / {field}"
    )


def normalize_number(
    value: Any,
    *,
    allow_none: bool = False,
    source: dict[str, Any] | None = None,
    field: str = "value",
) -> int | float | None:
    if value is None or normalize_text(value) == "":
        if allow_none:
            return None
        raise ValueError(f"numeric value is blank at {format_source(source, field)}")
    if isinstance(value, str):
        text = value.replace("\u00a0", " ").strip()
        if not re.fullmatch(r"[+-]?(?:\d{1,3}(?:[ ]\d{3})+|\d+)(?:[.,]\d+)?", text):
            raise ValueError(
                f"invalid numeric value {value!r} at {format_source(source, field)}"
            )
        value = text.replace(" ", "").replace(",", ".")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"invalid numeric value {value!r} at {format_source(source, field)}"
        ) from exc
    if not math.isfinite(number):
        raise ValueError(
            f"non-finite numeric value {value!r} at {format_source(source, field)}"
        )
    return int(number) if number.is_integer() else number


def normalize_code(value: Any) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = normalize_text(value)
    return text[:-2] if re.fullmatch(r"\d+\.0", text) else text


def is_reviewed_non_price_equipment(code: str, name: str, value: Any) -> bool:
    return (code, normalize_text(name), normalize_text(value)) in REVIEWED_NON_PRICE_EQUIPMENT


def source_ref(workbook: Path, sheet: str, row: int) -> dict[str, Any]:
    return {"workbook": workbook.name, "sheet": sheet, "row": row}


def source_with_fields(
    workbook: Path,
    sheet: str,
    row: int,
    **fields: Any,
) -> dict[str, Any]:
    return {**source_ref(workbook, sheet, row), **fields}


def table_rows(ws: Any) -> list[tuple[int, list[Any]]]:
    return [(index, list(row)) for index, row in enumerate(ws.iter_rows(values_only=True), 1)]


def records_from_rows(
    workbook: Path,
    sheet: str,
    rows: list[tuple[int, list[Any]]],
    field_names: list[str],
) -> list[dict[str, Any]]:
    records = []
    for row_number, values in rows[1:]:
        padded = values + [None] * (len(field_names) - len(values))
        if not any(normalize_text(value) for value in padded[: len(field_names)]):
            continue
        record = {
            field: normalize_text(value)
            for field, value in zip(field_names, padded)
        }
        record["source"] = source_ref(workbook, sheet, row_number)
        records.append(record)
    return records


def read_calculator_reference(reference_path: Path) -> dict[str, Any]:
    workbook = load_workbook(reference_path, data_only=True, read_only=True)
    sheets = {ws.title: table_rows(ws) for ws in workbook.worksheets}

    def rows(name: str) -> list[tuple[int, list[Any]]]:
        if name not in sheets:
            raise ValueError(f"required reference sheet is missing: {name}")
        return sheets[name]

    b2c_tariffs = []
    for row_number, values in rows("B2C_Тарифы1")[1:]:
        if not normalize_text(values[4] if len(values) > 4 else None):
            continue
        b2c_tariffs.append({
            "category": normalize_text(values[0]),
            "region": normalize_text(values[1]),
            "objectType": normalize_text(values[2]),
            "name": normalize_text(values[3]),
            "code": normalize_code(values[4]),
            "monthlyPrice": normalize_number(
                values[5], source=source_ref(reference_path, "B2C_Тарифы1", row_number), field="monthly price"
            ),
            "hasVideo": normalize_text(values[6]).lower() == "да",
            "hasHouseholdSensors": normalize_text(values[7]).lower() == "да",
            "hasExtendedLiability": normalize_text(values[8]).lower() == "да",
            "contents": normalize_text(values[9]),
            "authority": normalize_text(values[10]),
            "source": source_ref(reference_path, "B2C_Тарифы1", row_number),
        })

    b2c_rental = []
    for row_number, values in rows("B2C_Аренда")[1:]:
        if not normalize_text(values[4] if len(values) > 4 else None):
            continue
        b2c_rental.append({
            "category": normalize_text(values[0]),
            "region": normalize_text(values[1]),
            "objectType": normalize_text(values[2]),
            "name": normalize_text(values[3]),
            "code": normalize_code(values[4]),
            "monthlyPrice": normalize_number(
                values[5], source=source_ref(reference_path, "B2C_Аренда", row_number), field="monthly price"
            ),
            "source": source_ref(reference_path, "B2C_Аренда", row_number),
        })

    b2b_tariffs = []
    for row_number, values in rows("B2B_Тарифы")[1:]:
        if not normalize_text(values[3] if len(values) > 3 else None):
            continue
        b2b_tariffs.append({
            "category": normalize_text(values[0]),
            "region": normalize_text(values[1]),
            "priceLevel": normalize_text(values[2]),
            "name": normalize_text(values[3]),
            "contents": normalize_text(values[4]),
            "monthlyPrice": normalize_number(
                values[5], source=source_ref(reference_path, "B2B_Тарифы", row_number), field="monthly price"
            ),
            "rental": normalize_text(values[6]).lower() == "да",
            "source": source_ref(reference_path, "B2B_Тарифы", row_number),
        })

    options = []
    for row_number, values in rows("Опции")[1:]:
        name = normalize_text(values[1] if len(values) > 1 else None)
        if not name:
            continue
        raw_price = normalize_text(values[3])
        price = None if raw_price.casefold() == "индивидуально" else normalize_number(
            values[3],
            allow_none=True,
            source=source_ref(reference_path, "Опции", row_number),
            field="monthly price",
        )
        options.append({
            "category": normalize_text(values[0]),
            "name": name,
            "frequency": normalize_text(values[2]),
            "monthlyPrice": price,
            "pricing": "fixed" if price is not None else "individual",
            "condition": normalize_text(values[4]),
            "authority": normalize_text(values[5]),
            "source": source_ref(reference_path, "Опции", row_number),
        })

    liability_entries = []
    liability = {"b2c": {"apartment": {}, "cottage": {}}, "b2b": {"any": {}}}
    level_ids = {"базовый": "basic", "выгодный": "value", "премиальный": "premium", "любой": "any"}
    object_ids = {"квартира": "apartment", "коттедж": "cottage", "любой": "any"}
    for row_number, values in rows("Мат_ответственность")[1:]:
        category = normalize_text(values[0]).lower()
        object_label = normalize_text(values[1])
        level_label = normalize_text(values[2])
        amount = normalize_number(
            values[3],
            source=source_ref(reference_path, "Мат_ответственность", row_number),
            field="amount",
        )
        object_id = object_ids[object_label.lower()]
        level_id = level_ids[level_label.lower()]
        segment_id = category.lower()
        liability[segment_id][object_id][level_id] = amount
        liability_entries.append({
            "category": normalize_text(values[0]),
            "objectType": object_label,
            "level": level_label,
            "amount": amount,
            "source": source_ref(reference_path, "Мат_ответственность", row_number),
        })
    liability["entries"] = liability_entries

    discounts = []
    for row_number, values in rows("Скидки")[1:]:
        label = normalize_text(values[0] if values else None)
        if not label:
            continue
        value = None if label.casefold() == "индивидуальная скидка" else normalize_number(
            values[0],
            source=source_ref(reference_path, "Скидки", row_number),
            field="discount percent",
        )
        discounts.append({
            "percent": value,
            "kind": "standard" if value is not None else "individual",
            "label": label,
            "rule": normalize_text(values[1]),
            "source": source_ref(reference_path, "Скидки", row_number),
        })

    readme = {
        normalize_text(values[0]): normalize_text(values[1])
        for _, values in rows("README")
        if len(values) >= 2 and normalize_text(values[0])
    }

    return {
        "schemaVersion": 1,
        "sourceWorkbook": reference_path.name,
        "readme": readme,
        "b2cTariffs": b2c_tariffs,
        "b2cTransitions": records_from_rows(reference_path, "B2C_Переходы", rows("B2C_Переходы"), [
            "segmentObject", "sourceTariff", "condition", "result", "automaticTransition", "note"
        ]),
        "b2cRentalTariffs": b2c_rental,
        "b2bTariffs": b2b_tariffs,
        "options": options,
        "rentalLogic": records_from_rows(reference_path, "Аренда_Логика", rows("Аренда_Логика"), [
            "category", "scenario", "parameter", "value", "note"
        ]),
        "materialLiability": liability,
        "discounts": discounts,
        "responseTimes": records_from_rows(reference_path, "Время_реагирования", rows("Время_реагирования"), [
            "territoryType", "target", "manualAdjustment"
        ]),
        "unresolvedDecisions": records_from_rows(reference_path, "Требует_решения", rows("Требует_решения"), [
            "block", "topic", "known", "status"
        ]),
    }


def system_for_sheet(sheet: str) -> str:
    folded = sheet.casefold()
    if "б_у" in folded or "б/у" in folded or "аренд" in folded:
        return "rental-used"
    if "hikvision" in folded:
        return "hikvision"
    if "ритм" in folded:
        return "ritm"
    if "си-норд" in folded or "си_норд" in folded or "неотапливаемые" in folded:
        return "si-nord"
    return "other"


EQUIPMENT_HEADER_ALIASES = {
    "code": {"код", "код оборудования"},
    "name": {"наименование", "наименование оборудования"},
    "model": {"модель"},
    "unit": {"ед изм", "единица измерения"},
    "quantity": {"кол во", "количество"},
    "installed_price": {
        "цена оборудования с установкой за единицу руб с ндс",
        "цена с установкой за единицу",
    },
}


def normalize_header(value: Any) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", " ", normalize_text(value).casefold()).strip()


def build_equipment_header_map(
    headers: Iterable[Any],
    source: dict[str, Any],
) -> dict[str, int]:
    matches: dict[str, list[int]] = {field: [] for field in EQUIPMENT_HEADER_ALIASES}
    for index, value in enumerate(headers):
        normalized = normalize_header(value)
        for field, aliases in EQUIPMENT_HEADER_ALIASES.items():
            if normalized in aliases:
                matches[field].append(index)
    missing = [field for field, indices in matches.items() if not indices]
    duplicates = [field for field, indices in matches.items() if len(indices) > 1]
    if missing or duplicates:
        details = []
        if missing:
            details.append("missing columns: " + ", ".join(missing))
        if duplicates:
            details.append("duplicate columns: " + ", ".join(duplicates))
        raise ValueError(
            f"invalid equipment header at {format_source(source, 'header')}: {'; '.join(details)}"
        )
    return {field: indices[0] for field, indices in matches.items()}


def read_tabular_workbook(workbook_path: Path) -> tuple[list[str], dict[str, list[list[Any]]]]:
    if workbook_path.suffix.casefold() == ".xlsx":
        workbook = load_workbook(workbook_path, data_only=True, read_only=True)
        names = list(workbook.sheetnames)
        tables = {
            sheet.title: [list(row) for row in sheet.iter_rows(values_only=True)]
            for sheet in workbook.worksheets
        }
        workbook.close()
        return names, tables
    workbook = xlrd.open_workbook(workbook_path, on_demand=True)
    names = workbook.sheet_names()
    tables = {
        name: [workbook.sheet_by_name(name).row_values(index) for index in range(workbook.sheet_by_name(name).nrows)]
        for name in names
    }
    workbook.release_resources()
    return names, tables


def find_specification_header(
    workbook_path: Path,
    sheet_name: str,
    rows: list[list[Any]],
) -> tuple[int, dict[str, int]] | None:
    recognized = set().union(*EQUIPMENT_HEADER_ALIASES.values())
    for row_index, values in enumerate(rows):
        normalized = [normalize_header(value) for value in values]
        if "код" in normalized and any(value in EQUIPMENT_HEADER_ALIASES["name"] for value in normalized):
            source = source_ref(workbook_path, sheet_name, row_index + 1)
            return row_index, build_equipment_header_map(values, source)
        if len([value for value in normalized if value in recognized]) >= 4:
            source = source_ref(workbook_path, sheet_name, row_index + 1)
            return row_index, build_equipment_header_map(values, source)
    return None


def is_repeated_equipment_header(values: list[Any], columns: dict[str, int]) -> bool:
    return (
        len(values) > columns["code"]
        and len(values) > columns["name"]
        and normalize_header(values[columns["code"]]) in EQUIPMENT_HEADER_ALIASES["code"]
        and normalize_header(values[columns["name"]]) in EQUIPMENT_HEADER_ALIASES["name"]
    )


def read_equipment_rows(workbook_path: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    sheet_names, tables = read_tabular_workbook(workbook_path)
    rows: list[dict[str, Any]] = []
    sheet_counts: dict[str, int] = {}
    for sheet_name in sheet_names:
        if sheet_name in STOCK_SHEETS:
            continue
        sheet_rows = tables[sheet_name]
        header = find_specification_header(workbook_path, sheet_name, sheet_rows)
        if header is None:
            continue
        header_index, columns = header
        count = 0
        for row_index, values in enumerate(sheet_rows[header_index + 1:], header_index + 1):
            if is_repeated_equipment_header(values, columns):
                continue
            source = source_ref(workbook_path, sheet_name, row_index + 1)
            code = normalize_code(values[columns["code"]] if len(values) > columns["code"] else None)
            name = normalize_text(values[columns["name"]] if len(values) > columns["name"] else None)
            if not code or not name:
                continue
            raw_price = values[columns["installed_price"]] if len(values) > columns["installed_price"] else None
            if is_reviewed_non_price_equipment(code, name, raw_price):
                continue
            price = normalize_number(
                raw_price,
                allow_none=True,
                source=source,
                field="installed price",
            )
            if price is None:
                continue
            model = normalize_text(values[columns["model"]] if len(values) > columns["model"] else None)
            rows.append({
                "system": system_for_sheet(sheet_name),
                "systemLabel": SYSTEM_LABELS[system_for_sheet(sheet_name)],
                "code": code,
                "name": name,
                "model": model,
                "unit": normalize_text(values[columns["unit"]] if len(values) > columns["unit"] else None),
                "installedUnitPrice": price,
                "source": source_with_fields(
                    workbook_path,
                    sheet_name,
                    row_index + 1,
                    name=name,
                    model=model,
                ),
            })
            count += 1
        sheet_counts[sheet_name] = count
    return rows, sheet_counts


def deduplicate_equipment(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    items: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (row["system"], row["code"])
        allowed = EQUIPMENT_VARIANT_ALLOWLIST.get(key)
        variant = (row["name"], row["model"])
        current = items.get(key)
        if current is None:
            if allowed and variant not in allowed["variants"]:
                source = row["source"]
                raise ValueError(
                    f"unreviewed equipment variant {key!r} in "
                    f"{source['workbook']} / {source['sheet']} row {source['row']}: name, model"
                )
            item = {key: value for key, value in row.items() if key != "source"}
            if allowed:
                item["name"], item["model"] = allowed["canonical"]
            item["sources"] = [row["source"]]
            items[key] = item
            continue
        commercial_fields = ("name", "model", "unit", "installedUnitPrice")
        conflicts = [field for field in commercial_fields if current[field] != row[field]]
        if allowed and variant in allowed["variants"]:
            conflicts = [field for field in conflicts if field not in ("name", "model")]
        if conflicts:
            first_source = current["sources"][0]
            source = row["source"]
            raise ValueError(
                f"conflicting duplicate equipment key {key!r}: {', '.join(conflicts)}; "
                f"first source {first_source['workbook']} / {first_source['sheet']} "
                f"row {first_source['row']}; conflicting source "
                f"{source['workbook']} / {source['sheet']} row {source['row']}"
            )
        provenance = row["source"]
        if provenance not in current["sources"]:
            current["sources"].append(provenance)
        if not current["model"] and row["model"]:
            current["model"] = row["model"]
    return sorted(items.values(), key=lambda item: (item["system"], item["code"]))


def read_example_control(example_path: Path) -> dict[str, Any]:
    rows, sheet_counts = read_equipment_rows(example_path)
    sheet_names, tables = read_tabular_workbook(example_path)
    selected = []
    for sheet_name in sheet_names:
        if sheet_name in STOCK_SHEETS:
            continue
        sheet_rows = tables[sheet_name]
        header = find_specification_header(example_path, sheet_name, sheet_rows)
        if header is None:
            continue
        header_index, columns = header
        for row_index, values in enumerate(sheet_rows[header_index + 1:], header_index + 1):
            if is_repeated_equipment_header(values, columns):
                continue
            source = source_ref(example_path, sheet_name, row_index + 1)
            code = normalize_code(values[columns["code"]] if len(values) > columns["code"] else None)
            if not code:
                continue
            quantity = normalize_number(
                values[columns["quantity"]] if len(values) > columns["quantity"] else None,
                allow_none=True,
                source=source,
                field="quantity",
            )
            if code and quantity is not None and quantity > 0:
                selected.append({
                    "sheet": sheet_name,
                    "row": row_index + 1,
                    "code": code,
                    "quantity": quantity,
                })
    return {
        "workbook": example_path.name,
        "role": "control-and-provenance-only",
        "specificationRowCount": len(rows),
        "rowsBySheet": sheet_counts,
        "selectedRows": selected,
    }


def read_equipment_template(template_path: Path, example_path: Path) -> dict[str, Any]:
    rows, sheet_counts = read_equipment_rows(template_path)
    return {
        "schemaVersion": 1,
        "sourceWorkbook": template_path.name,
        "excludedSheets": sorted(STOCK_SHEETS.intersection(workbook_sheet_names(template_path))),
        "rowsBySheet": sheet_counts,
        "items": deduplicate_equipment(rows),
        "exampleControl": read_example_control(example_path),
    }


def validate_equipment_variant_allowlist(allowlist: dict[Any, Any]) -> None:
    for key, rule in allowlist.items():
        if rule.get("canonical") not in rule.get("variants", set()):
            raise ValueError(
                f"equipment allowlist key {key!r} has canonical value outside reviewed variants"
            )


def validate_calculator(calculator: dict[str, Any]) -> None:
    required = (
        "b2cTariffs", "b2cTransitions", "b2cRentalTariffs", "b2bTariffs", "options",
        "rentalLogic", "materialLiability", "discounts", "responseTimes", "unresolvedDecisions",
    )
    missing = [key for key in required if key not in calculator]
    if missing:
        raise ValueError(f"calculator catalog is missing sections: {', '.join(missing)}")
    priced_rows = calculator["b2cTariffs"] + calculator["b2cRentalTariffs"] + calculator["b2bTariffs"]
    if not priced_rows or any(not isinstance(row["monthlyPrice"], (int, float)) for row in priced_rows):
        raise ValueError("calculator tariff prices must be numeric")


def validate_equipment(equipment: dict[str, Any]) -> None:
    seen: set[tuple[str, str]] = set()
    for item in equipment["items"]:
        key = (item["system"], item["code"])
        if key in seen:
            raise ValueError(f"duplicate equipment key after normalization: {key!r}")
        seen.add(key)
        if not item["name"] or not isinstance(item["installedUnitPrice"], (int, float)):
            raise ValueError(f"invalid equipment item: {key!r}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def workbook_sheet_names(path: Path) -> list[str]:
    if path.suffix.casefold() == ".xlsx":
        workbook = load_workbook(path, read_only=True)
        names = list(workbook.sheetnames)
        workbook.close()
        return names
    workbook = xlrd.open_workbook(path, on_demand=True)
    names = workbook.sheet_names()
    workbook.release_resources()
    return names


def build_manifest(paths: Iterable[Path]) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "deterministic": True,
        "sources": [
            {
                "basename": path.name,
                "sha256": sha256(path),
                "sizeBytes": path.stat().st_size,
                "sheetNames": workbook_sheet_names(path),
            }
            for path in paths
        ],
    }


def serialize_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def write_catalogs_atomically(
    output_dir: Path,
    calculator: dict[str, Any],
    equipment: dict[str, Any],
    manifest: dict[str, Any],
) -> None:
    payloads = {
        "calculator.json": serialize_json(calculator),
        "equipment.json": serialize_json(equipment),
        "import-manifest.json": serialize_json(manifest),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    temporary: dict[str, Path] = {}
    try:
        for name, payload in payloads.items():
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=output_dir,
                prefix=f".{name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
                temporary[name] = Path(handle.name)
        for name in payloads:
            os.replace(temporary[name], output_dir / name)
            temporary.pop(name)
    finally:
        for path in temporary.values():
            path.unlink(missing_ok=True)


def import_sources(
    reference_path: Path,
    template_path: Path,
    filled_example_path: Path,
    output_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    validate_equipment_variant_allowlist(EQUIPMENT_VARIANT_ALLOWLIST)
    calculator = read_calculator_reference(reference_path)
    equipment = read_equipment_template(template_path, filled_example_path)
    validate_calculator(calculator)
    validate_equipment(equipment)
    manifest = build_manifest([
        reference_path, template_path, filled_example_path
    ])
    write_catalogs_atomically(output_dir, calculator, equipment, manifest)
    return calculator, equipment


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--template", required=True, type=Path)
    parser.add_argument("--example", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    calculator, equipment = import_sources(args.reference, args.template, args.example, args.output)
    summary = {
        "calculatorRows": {
            key: len(calculator[key])
            for key in (
                "b2cTariffs", "b2cTransitions", "b2cRentalTariffs", "b2bTariffs", "options",
                "rentalLogic", "discounts", "responseTimes", "unresolvedDecisions",
            )
        },
        "equipmentRowsBySheet": equipment["rowsBySheet"],
        "equipmentItems": len(equipment["items"]),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
