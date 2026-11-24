# Upload sheet for hospitals that offer private vaccines (AKU medical centres, Ziauddin North Nazimabad).
# Facts come only from the hospitals' own web pages (read 2026-11-24). Map pins are NOT included: paste a Google Maps link in
# column H (or latitude/longitude) before uploading, otherwise the upload skips the row and says so.
import sys, importlib.util
from openpyxl import load_workbook
from openpyxl.styles import PatternFill, Font, Alignment
spec = importlib.util.spec_from_file_location("mk", __file__.replace("make_private_vaccine_sheet.py", "make_vacc_template.py"))
mk = importlib.util.module_from_spec(spec); spec.loader.exec_module(mk)
D = "2026-11-24"
def row(name, district, town, uc, addr, o, c, days, phone, ctype, src):
    return [name, district, town, uc, addr, None, None, None, o, c, None, None, days, None, phone, ctype, src, D, "Private", None]
ROWS = [
  row("Dr. Ziauddin Hospital, North Nazimabad", "Karachi Central", "North Nazimabad", None, None, "09:00", "21:00", "Daily", "021-36648237 ext 544/545", "Private hospital vaccination centre", "Ziauddin Hospital website, vaccination centre page"),
  row("AKU Medical Centre, Gulshan-e-Iqbal", "Karachi East", "Gulshan-e-Iqbal", "Block 10-A", "Workers Cooperative Society, Plot-05, Ground Floor, Main Rashid Minhas Road, Block 10-A", "09:00", "17:00", "Mon-Sat", "021 111 911 911", "Private medical centre vaccination service", "Aga Khan University Hospital website, Medical Centres page"),
  row("AKU Medical Centre, Malir (Darakhshan)", "Karachi Malir", "Malir", "Darakhshan Housing Society", "Plot 16/423, Darakhshan Housing Society, Kala-board", "09:00", "17:00", "Mon-Sat", "021 111 911 911", "Private medical centre vaccination service", "Aga Khan University Hospital website, Medical Centres page"),
  row("AKU Medical Centre, Korangi", "Karachi Korangi", "Korangi", "Sector 35-C", "Plot SL-1 & L-1, Sector 35-C, Korangi No. 3 1/2, near PSO Petrol Pump", "09:00", "16:00", "Mon-Sat", "021 111 911 911", "Private medical centre vaccination service", "Aga Khan University Hospital website, Medical Centres page"),
  row("AKU Medical Centre, Clifton", "Karachi South", "Clifton", "Scheme 5", "Near Indus Valley School of Art and Architecture, Off Shara-e-Saadi, St. 11, Block 2, Scheme 5", None, None, None, "021 111 911 911", "Private medical centre vaccination service", "Aga Khan University Hospital website, Medical Centres page"),
]
out = sys.argv[1]
mk.build(out, ROWS)
wb = load_workbook(out); ws = wb["Centres"]
yel = PatternFill("solid", fgColor="FFF3B0")
for r in range(2, 2 + len(ROWS)):
    for col in "FGH": ws[f"{col}{r}"].fill = yel
ws["H1"].comment = None
n = wb.create_sheet("Needs your confirmation", 1)
n.column_dimensions["A"].width = 34; n.column_dimensions["B"].width = 110
n.append(["What to do before uploading"]); n["A1"].font = Font(bold=True, size=14)
for t in [
  ["1. Map pins", "Yellow cells (latitude, longitude, Google Maps link) are empty on purpose: I could not read exact locations from a permitted source and did not guess. Paste a Google Maps link for each hospital in column H (or latitude and longitude in F and G). Rows without a pin are skipped and reported."],
  ["2. AKU hours", "The AKU Medical Centres page lists vaccination hours per centre (Gulshan, Malir 9 am to 5 pm, Korangi 9 am to 4 pm, all Monday to Saturday), but the page text is jumbled and the address-to-hours pairing is my reading. Please check against the AKU page or by phone (021 111 911 911). Clifton lists the vaccination service with no vaccination hours, so its hours are empty."],
  ["3. Ziauddin", "Only the North Nazimabad campus is described as having a vaccination centre (daily, 9 am to 9 pm, no appointment). The page gives no street address; fill the address if you have it."],
  ["4. Vaccines", "No page gave a vaccine list for these centres, so the Vaccines column is empty. Add what each offers (for example typhoid, HPV, flu) if you want tags on the cards."],
  ["5. AKU main hospital", "The AKU pages I could read do not list vaccination at the Stadium Road hospital itself, so it is not included. Add it if you know it offers walk-in vaccination."],
  [],
  ["Not in the upload sheet: Hamdard", "Naimat Begum Hamdard University Hospital (Block 3, Nazimabad, behind Eid Gah Ground) lists 'Vaccination' among its services on a third-party directory (Healthwire) with no days, hours or vaccines. Hamdard University Hospital at Taj Medical Complex, M.A. Jinnah Road, has no vaccination service mentioned. Please confirm with Hamdard which campus offers vaccination, and its days and hours, then add a row."],
]: n.append(t)
for r in n.iter_rows(min_row=2):
    for c in r: c.alignment = Alignment(wrap_text=True, vertical="top")
    r[0].font = Font(bold=True)
wb.save(out)
