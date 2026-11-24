# Builds the final vaccination-centres template (and, given a source sheet, a cleaned copy in the same layout).
#   python3 _t/make_vacc_template.py template.xlsx
#   python3 _t/make_vacc_template.py clean.xlsx source.xlsx
import sys, re
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule

HEAD = ["centre_name","district","town","uc","address","latitude","longitude","google_maps_link","opening_time","closing_time",
        "friday_opening_time","friday_closing_time","days_open","vaccines_or_age_groups","centre_phone","centre_type","source_note","last_verified_date","vaccines_offered","service_fee"]
EXAMPLE = ["Example row: delete me","Karachi Central","North Nazimabad","Sir Syed-1","Block B, near the main road",24.9371,67.0415,"",
           "09:00","14:00","09:00","12:30","Mon-Sat","Routine EPI vaccines, 0 to 5 years","","Government health centre","District health office list","2026-11-24","Government",""]
LAST = 1001  # rows 2..1001 are validated (the importer takes 1,000 centres per file)
WIDTH = [34,18,18,22,34,12,12,38,12,12,14,14,12,38,16,24,40,16,16,12]
NOTE = {
 "centre_name":"Required. Name people know the centre by.",
 "district":"Recommended. e.g. Karachi Central.",
 "town":"Town (tehsil). Needs town or UC.",
 "uc":"Union council, e.g. Hyderi-7. Shown first on the card.",
 "address":"Optional: street, block, landmark.",
 "latitude":"Number, e.g. 24.9371. Latitude + longitude OR the Maps link is required.",
 "longitude":"Number, e.g. 67.0415.",
 "google_maps_link":"Optional. Used only if latitude/longitude are empty.",
 "opening_time":"24-hour HH:MM, e.g. 09:00",
 "closing_time":"24-hour HH:MM, e.g. 14:00",
 "friday_opening_time":"Only if Friday differs. HH:MM",
 "friday_closing_time":"Only if Friday differs. HH:MM",
 "days_open":"Mon-Sat, Mon-Fri, Mon-Sun or Daily (or a list: Mon, Wed, Fri)",
 "vaccines_or_age_groups":"Optional. Separate with commas.",
 "centre_phone":"Optional. Leave empty if none.",
 "centre_type":"Optional, e.g. Government health centre.",
 "source_note":"Where the information came from.",
 "last_verified_date":"yyyy-mm-dd, the day it was last confirmed.",
 "vaccines_offered":"Required. Government (government vaccine), Private (private vaccines only) or Both (government vaccine and private vaccines).",
 "service_fee":"Yes only if the centre charges a small service fee on top of the government vaccine. Otherwise leave empty or No; nothing is shown.",
}

def build(path, rows):
    wb = Workbook(); ws = wb.active; ws.title = "Centres"
    ws.append(HEAD + ["check (not imported)"])
    hfill = PatternFill("solid", fgColor="0F766E"); gfill = PatternFill("solid", fgColor="E7EFEC")
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF"); c.fill = hfill; c.alignment = Alignment(wrap_text=True, vertical="center")
    ws["U1"].fill = PatternFill("solid", fgColor="64748B")
    for r in rows: ws.append(r)
    for i, w in enumerate(WIDTH + [26]): ws.column_dimensions[chr(65 + i)].width = w
    ws.row_dimensions[1].height = 32
    ws.freeze_panes = "B2"
    ws.auto_filter.ref = f"A1:U{max(ws.max_row, 2)}"
    text_cols = "IJKL"
    for r in range(2, LAST + 1):
        for col in text_cols: ws[f"{col}{r}"].number_format = "@"
        ws[f"R{r}"].number_format = "@"
        ws[f"U{r}"] = (f'=IF(COUNTA(A{r}:T{r})=0,"",IF(TRIM(A{r})="","Name missing",IF(AND(F{r}="",G{r}="",H{r}=""),"Location missing",'
                       f'IF(AND(TRIM(B{r})="",TRIM(C{r})="",TRIM(D{r})=""),"Town, UC or district missing",'
                       f'IF(TRIM(S{r})="","Vaccines offered missing",'
                       f'IF(AND(OR(I{r}<>"",J{r}<>""),M{r}=""),"Days open missing",IF(AND(OR(I{r}<>"",J{r}<>""),OR(I{r}="",J{r}="")),"Opening or closing time missing","OK")))))))')
        ws[f"U{r}"].font = Font(color="64748B")
    if rows and str(rows[0][0]).lower().startswith("example"):
        for c in ws[2]: c.font = Font(italic=True, color="777777"); c.fill = gfill
    # input rules
    def dv(**k):
        d = DataValidation(allow_blank=True, showErrorMessage=True, **k); ws.add_data_validation(d); return d
    d = dv(type="decimal", operator="between", formula1="23", formula2="29", errorTitle="Latitude", error="Latitude for Sindh is a number between 23 and 29, e.g. 24.9371"); d.add(f"F2:F{LAST}")
    d = dv(type="decimal", operator="between", formula1="66", formula2="71.5", errorTitle="Longitude", error="Longitude for Sindh is a number between 66 and 71.5, e.g. 67.0415"); d.add(f"G2:G{LAST}")
    d = dv(type="list", formula1='"Mon-Sat,Mon-Fri,Mon-Sun,Daily"', errorStyle="warning", errorTitle="Days open", error="Use Mon-Sat, Mon-Fri, Mon-Sun or Daily (or a list like Mon, Wed, Fri). Keep this value?"); d.add(f"M2:M{LAST}")
    for col in text_cols:
        d = dv(type="custom", formula1=f'OR({col}2="",ISNUMBER(TIMEVALUE({col}2)),AND(ISNUMBER({col}2),{col}2>=0,{col}2<1))', errorStyle="warning", errorTitle="Time", error="Write the time as HH:MM in 24-hour style, e.g. 09:00 or 14:00. Keep this value?"); d.add(f"{col}2:{col}{LAST}")
    d = dv(type="custom", formula1='OR(R2="",ISNUMBER(DATEVALUE(R2)),ISNUMBER(R2))', errorStyle="warning", errorTitle="Date", error="Write the date as yyyy-mm-dd, e.g. 2026-11-24. Keep this value?"); d.add(f"R2:R{LAST}")
    d = dv(type="list", formula1='"Government,Private,Both"', errorTitle="Vaccines offered", error="Choose Government, Private or Both."); d.add(f"S2:S{LAST}")
    d = dv(type="list", formula1='"Yes,No"', errorStyle="warning", errorTitle="Service fee", error="Choose Yes or No (or leave empty). Keep this value?"); d.add(f"T2:T{LAST}")
    red = PatternFill("solid", bgColor="FECACA"); amber = PatternFill("solid", bgColor="FDE68A")
    ws.conditional_formatting.add(f"A2:A{LAST}", FormulaRule(formula=['AND(COUNTA($A2:$T2)>0,TRIM($A2)="")'], fill=red))
    ws.conditional_formatting.add(f"S2:S{LAST}", FormulaRule(formula=['AND(TRIM($A2)<>"",TRIM($S2)="")'], fill=red))
    ws.conditional_formatting.add(f"F2:H{LAST}", FormulaRule(formula=['AND(TRIM($A2)<>"",$F2="",$G2="",$H2="")'], fill=red))
    ws.conditional_formatting.add(f"I2:M{LAST}", FormulaRule(formula=['AND(TRIM($A2)<>"",OR($I2<>"",$J2<>""),OR($I2="",$J2="",$M2=""))'], fill=amber))
    ws.conditional_formatting.add(f"U2:U{LAST}", FormulaRule(formula=['AND($U2<>"",$U2<>"OK")'], font=Font(bold=True, color="B91C1C")))
    ws.conditional_formatting.add(f"U2:U{LAST}", FormulaRule(formula=['$U2="OK"'], font=Font(color="15803D")))
    # instructions
    ins = wb.create_sheet("How to fill")
    ins.column_dimensions["A"].width = 26; ins.column_dimensions["B"].width = 100
    ins.append(["Family Medic Locator: vaccination centres sheet"]); ins["A1"].font = Font(bold=True, size=14)
    ins.append(["Keep the header row exactly as it is. One row per centre. Delete the grey example row. Do not add columns in the middle."])
    ins.append(["Column U (grey) is only a helper that says OK or what is missing. It is not imported."])
    ins.append([])
    ins.append(["Column", "What to write"])
    for c in ins[5]: c.font = Font(bold=True)
    for h in HEAD: ins.append([h, NOTE[h]]); ins.cell(row=ins.max_row, column=1).font = Font(bold=True)
    ins.append([])
    for line in [
        "Every centre needs: a name, a location (latitude and longitude, or a Google Maps link) and a town, UC or district.",
        "vaccines_offered decides where a centre appears: Government and Both centres are in the first list parents see; Private and Both centres are in the 'Private vaccines' filter.",
        "Hours show only when opening_time, closing_time and days_open are all filled. Friday columns are optional: fill them only if Friday has different times.",
        "A day not listed in days_open shows as closed (for Mon-Sat that is Sunday).",
        "Uploading the same centre again (same name, same place) updates it instead of adding a copy. Rows with no usable location are skipped and reported.",
        "Never write 'government approved' unless your source says so; use source_note to say where the list came from.",
    ]: ins.append(["", line])
    wb.save(path)

def clean_cell(v):
    if isinstance(v, str):
        v = re.sub(r"\s+", " ", v).strip()
        return v or None
    return v

if __name__ == "__main__":
    out = sys.argv[1]
    if len(sys.argv) > 2:
        ws = load_workbook(sys.argv[2]).active
        rows = list(ws.iter_rows(values_only=True)); src = [str(h).strip() for h in rows[0]]
        assert src[:18] == HEAD[:18], src
        data = [[clean_cell(v) for v in r[:18]] for r in rows[1:] if any(v not in (None, "") for v in r)]
        if len(src) == 18:   # older sheet: every centre gives the government vaccine
            data = [r + ["Government", None] for r in data]
        build(out, data)
    else:
        build(out, [EXAMPLE])
