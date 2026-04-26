// ============================================================
// TRIAL TASK BACKEND — add this as a new file in the same Apps Script project
// File name: Code-trials.gs
//
// ALSO add these lines to Code.gs:
//
//   In doGet() switch block, add:
//     case "trialresearcher": return respond(handleTrialResearcher(e.parameter));
//     case "triallister":     return respond(handleTrialLister(e.parameter));
//
//   In setupAll(), add one line after setupSheetHeaders():
//     setupTrialSheetHeaders();
//
//   In onOpen() menu, add:
//     .addItem("Setup Trial Sheet Headers", "setupTrialSheetHeaders")
// ============================================================

const TRIAL_TAB = {
  RESEARCHER : "ResearcherTrials",
  LISTER     : "ListerTrials",
};

// ResearcherTrials tab columns
const RT = {
  TIMESTAMP    : 1,   // A
  TRIAL_CODE   : 2,   // B
  PRODUCT_NUM  : 3,   // C
  TITLE        : 4,   // D
  DESCRIPTION  : 5,   // E
  SHOPEE_LINK  : 6,   // F
  SOURCE_COST  : 7,   // G
  DRIVE_FOLDER : 8,   // H
  SELL_PRICE   : 9,   // I — auto-calculated
  QC_FLAGS     : 10,  // J — auto QC result (PASS or list of failures)
  SCORE        : 11,  // K — manual scoring by Quinn (leave blank, fill after review)
  NOTES        : 12,  // L — manual notes
};
const RT_TOTAL_COLS = 12;

// ListerTrials tab columns
const LT = {
  TIMESTAMP        : 1,  // A
  TRIAL_CODE       : 2,  // B
  PRODUCT_NUM      : 3,  // C
  GIVEN_TITLE      : 4,  // D — exact title Quinn asked them to use
  GIVEN_SELL_PRICE : 5,  // E — exact sell price Quinn specified
  SUBMITTED_URL    : 6,  // F — candidate's Carousell listing URL
  URL_VALID        : 7,  // G — auto-validated
  SCORE            : 8,  // H — manual scoring by Quinn
  NOTES            : 9,  // I — manual notes
};
const LT_TOTAL_COLS = 9;

// ============================================================
// ENDPOINT: ?action=trialResearcher
// Called by trial-researcher.html
// Writes one row per product to the ResearcherTrials tab
// ============================================================

function handleTrialResearcher(p) {
  const trialCode = trim(p.trialCode || "").toUpperCase();
  if (!trialCode) return { ok: false, error: "Missing trial code. Enter the code Quinn sent you." };

  const ss         = getSpreadsheet();
  const trialSheet = getOrCreateSheet(ss, TRIAL_TAB.RESEARCHER);
  if (trialSheet.getLastRow() === 0) setupTrialSheetHeaders();

  const rows = [];

  for (let i = 1; i <= 5; i++) {
    const title       = trim(p[`title${i}`]       || "");
    const description = trim(p[`description${i}`] || "");
    const shopeeLink  = trim(p[`shopeeLink${i}`]  || "");
    const sourceCost  = parseFloat(p[`sourceCost${i}`]);
    const driveFolder = trim(p[`driveFolder${i}`] || "");

    // Skip fully blank product slots (shouldn't happen after client validation)
    if (!title && !description && !shopeeLink && isNaN(sourceCost) && !driveFolder) continue;

    // QC checks — mirrors the main submission QC
    const flags = [];
    if (!title)                                         flags.push("Title missing");
    else if (title.length < 20)                         flags.push("Title too short (<20 chars)");
    else if (title.length > 80)                         flags.push("Title too long (>80 chars)");
    if (!description)                                   flags.push("Description missing");
    else if (description.length < 100)                  flags.push("Description too short (<100 chars)");
    if (!shopeeLink)                                    flags.push("Shopee link missing");
    if (isNaN(sourceCost) || sourceCost <= 0)           flags.push("Source cost invalid");
    if (!driveFolder)                                   flags.push("Drive folder missing");
    else if (!driveFolder.includes("drive.google.com")) flags.push("Drive link not a Google Drive URL");

    const sellPrice = (!isNaN(sourceCost) && sourceCost > 0) ? calcSellPrice(sourceCost) : "";

    const row = new Array(RT_TOTAL_COLS).fill("");
    row[RT.TIMESTAMP    - 1] = new Date();
    row[RT.TRIAL_CODE   - 1] = trialCode;
    row[RT.PRODUCT_NUM  - 1] = i;
    row[RT.TITLE        - 1] = title;
    row[RT.DESCRIPTION  - 1] = description;
    row[RT.SHOPEE_LINK  - 1] = shopeeLink;
    row[RT.SOURCE_COST  - 1] = isNaN(sourceCost) ? "" : sourceCost;
    row[RT.DRIVE_FOLDER - 1] = driveFolder;
    row[RT.SELL_PRICE   - 1] = sellPrice;
    row[RT.QC_FLAGS     - 1] = flags.length ? flags.join(" | ") : "PASS";
    rows.push(row);
  }

  if (!rows.length) return { ok: false, error: "No products submitted." };

  trialSheet.getRange(trialSheet.getLastRow() + 1, 1, rows.length, RT_TOTAL_COLS).setValues(rows);

  return {
    ok        : true,
    trialCode : trialCode,
    submitted : rows.length,
    message   : `${rows.length} product(s) submitted for trial ${trialCode}. Quinn will review and contact you within 24 hours.`,
  };
}

// ============================================================
// ENDPOINT: ?action=trialLister
// Called by trial-lister.html
// Writes one row per product to the ListerTrials tab
// ============================================================

function handleTrialLister(p) {
  const trialCode = trim(p.trialCode || "").toUpperCase();
  if (!trialCode) return { ok: false, error: "Missing trial code. Enter the code Quinn sent you." };

  const ss         = getSpreadsheet();
  const trialSheet = getOrCreateSheet(ss, TRIAL_TAB.LISTER);
  if (trialSheet.getLastRow() === 0) setupTrialSheetHeaders();

  const rows  = [];
  const errors = [];

  for (let i = 1; i <= 3; i++) {
    const givenTitle = trim(p[`givenTitle${i}`]   || "");
    const givenPrice = parseFloat(p[`givenPrice${i}`]);
    const submitted  = trim(p[`carousellUrl${i}`] || "");

    if (!submitted) continue;

    const urlValid = submitted.startsWith("https://www.carousell.sg/")
      ? "VALID"
      : "INVALID — must start with https://www.carousell.sg/";

    if (!submitted.startsWith("https://www.carousell.sg/"))
      errors.push(`Product ${i}: invalid URL`);

    const row = new Array(LT_TOTAL_COLS).fill("");
    row[LT.TIMESTAMP        - 1] = new Date();
    row[LT.TRIAL_CODE       - 1] = trialCode;
    row[LT.PRODUCT_NUM      - 1] = i;
    row[LT.GIVEN_TITLE      - 1] = givenTitle;
    row[LT.GIVEN_SELL_PRICE - 1] = isNaN(givenPrice) ? "" : givenPrice;
    row[LT.SUBMITTED_URL    - 1] = submitted;
    row[LT.URL_VALID        - 1] = urlValid;
    rows.push(row);
  }

  if (!rows.length) return { ok: false, error: "No Carousell URLs submitted." };

  trialSheet.getRange(trialSheet.getLastRow() + 1, 1, rows.length, LT_TOTAL_COLS).setValues(rows);

  if (errors.length) {
    return {
      ok      : false,
      partial : true,
      message : `Saved, but ${errors.join("; ")}. URLs must start with https://www.carousell.sg/`,
    };
  }

  return {
    ok        : true,
    trialCode : trialCode,
    submitted : rows.length,
    message   : `${rows.length} listing(s) submitted for trial ${trialCode}. Quinn will review your listings and contact you. Please delist the items from your Carousell account once contacted.`,
  };
}

// ============================================================
// SHEET SETUP — called by setupAll() in Code.gs
// ============================================================

function setupTrialSheetHeaders() {
  const ss = getSpreadsheet();

  const rtSheet = getOrCreateSheet(ss, TRIAL_TAB.RESEARCHER);
  if (rtSheet.getLastRow() === 0) {
    rtSheet.appendRow([
      "Timestamp", "Trial Code", "Product #", "Title", "Description",
      "Shopee Link", "Source Cost", "Drive Folder", "Sell Price", "Auto QC", "Score (0–10)", "Notes"
    ]);
    rtSheet.getRange(1, 1, 1, RT_TOTAL_COLS)
      .setBackground("#1e4d2b").setFontColor("#ffffff").setFontWeight("bold");
    rtSheet.setFrozenRows(1);
    rtSheet.setColumnWidth(5, 320);  // Description
    rtSheet.setColumnWidth(10, 200); // QC Flags
  }

  const ltSheet = getOrCreateSheet(ss, TRIAL_TAB.LISTER);
  if (ltSheet.getLastRow() === 0) {
    ltSheet.appendRow([
      "Timestamp", "Trial Code", "Product #", "Given Title", "Given Sell Price",
      "Submitted URL", "URL Valid", "Score (0–10)", "Notes"
    ]);
    ltSheet.getRange(1, 1, 1, LT_TOTAL_COLS)
      .setBackground("#1a2a4a").setFontColor("#ffffff").setFontWeight("bold");
    ltSheet.setFrozenRows(1);
    ltSheet.setColumnWidth(4, 260); // Given Title
    ltSheet.setColumnWidth(6, 300); // Submitted URL
  }
}
