// ============================================================
// CAROUSELL BUSINESS MASTER SHEET — Apps Script Backend
// Single file deployment — paste entire contents into Apps Script editor
// ============================================================
//
// SETUP STEPS (do these once, in order):
//   1. Paste this file into Apps Script editor (Extensions > Apps Script)
//   2. Fill in CONFIG BLOCK below (Sheet ID, email, lister codes)
//   3. Save (Ctrl+S)
//   4. Run setupAll() once from the function dropdown — grants permissions + installs all triggers
//   5. Deploy as Web App (Deploy > New Deployment > Web App)
//      - Execute as: Me
//      - Who has access: Anyone
//   6. Copy the Web App URL — paste it into your HTML tools later
//
// SHEET TABS REQUIRED:
//   Submissions | Config | Dashboard | Archive
//   (setupAll will create headers automatically if tabs are blank)
//
// ============================================================
// CONFIG BLOCK — edit these before running setupAll()
// ============================================================

const CONFIG = {
  SPREADSHEET_ID  : "PASTE_YOUR_SPREADSHEET_ID_HERE",  // From sheet URL: /d/SPREADSHEET_ID/edit
  ALERT_EMAIL     : "PASTE_YOUR_EMAIL_HERE",            // Nightly alert + weekly summary recipient
  TIMEZONE        : "Asia/Singapore",
  LISTER_CODES    : ["LVA001", "LVA002", "LVA003"],    // Must match Config tab exactly
};

// ============================================================
// COLUMN INDICES — 1-based. Do not change unless restructuring the sheet.
// ============================================================

// Submissions tab columns
const S = {
  TIMESTAMP    : 1,   // A
  VA_CODE      : 2,   // B
  TITLE        : 3,   // C
  DESCRIPTION  : 4,   // D
  SHOPEE_LINK  : 5,   // E
  SOURCE_COST  : 6,   // F
  DRIVE_FOLDER : 7,   // G
  SELL_PRICE   : 8,   // H
  LISTER       : 9,   // I
  STATUS       : 10,  // J
  CAROUSELL_URL: 11,  // K
  DATE_POSTED  : 12,  // L
  NOTES        : 13,  // M
};
const S_TOTAL_COLS = 13;

// Config tab columns
const C = {
  CODE   : 1,  // A
  ROLE   : 2,  // B
  TARGET : 3,  // C
  STATUS : 4,  // D
  REJ_CT : 5,  // E — Rejection Count (auto-incremented by flag endpoint)
};

// ============================================================
// SHEET TAB NAMES
// ============================================================

const TAB = {
  SUBMISSIONS : "Submissions",
  CONFIG      : "Config",
  DASHBOARD   : "Dashboard",
  ARCHIVE     : "Archive",
};

// ============================================================
// WEB APP ENTRY POINT
// All endpoints use GET to avoid CORS issues with Netlify-hosted pages
// ============================================================

function doGet(e) {
  const action = (e.parameter.action || "").toLowerCase();

  try {
    switch (action) {
      case "submit":    return respond(handleSubmit(e.parameter));
      case "progress":  return respond(handleProgress(e.parameter));
      case "queue":     return respond(handleQueue(e.parameter));
      case "complete":  return respond(handleComplete(e.parameter));
      case "flag":      return respond(handleFlag(e.parameter));
      case "dashboard":        return respond(handleDashboardData());
      case "trialresearcher":  return respond(handleTrialResearcher(e.parameter));
      case "triallister":      return respond(handleTrialLister(e.parameter));
      default:                 return respond({ ok: false, error: "Unknown action: " + action });
    }
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ENDPOINT: ?action=submit
// Called by researcher VA submission form
// Required params: vaCode, title, description, shopeeLink, sourceCost, driveFolder
// ============================================================

function handleSubmit(p) {
  const vaCode      = trim(p.vaCode      || p.va_code      || "");
  const title       = trim(p.title       || "");
  const description = trim(p.description || "");
  const shopeeLink  = trim(p.shopeeLink  || p.shopee_link  || "");
  const sourceCost  = parseFloat(p.sourceCost || p.source_cost);
  const driveFolder = trim(p.driveFolder || p.drive_folder || "");

  // Field validation
  const missing = [];
  if (!vaCode)                                 missing.push("vaCode");
  if (!title)                                  missing.push("title");
  if (!description)                            missing.push("description");
  if (!shopeeLink)                             missing.push("shopeeLink");
  if (isNaN(sourceCost) || sourceCost <= 0)    missing.push("sourceCost (must be a positive number)");
  if (!driveFolder)                            missing.push("driveFolder");
  if (missing.length) return { ok: false, error: "Missing or invalid fields: " + missing.join(", ") };

  const ss       = getSpreadsheet();
  const subSheet = ss.getSheetByName(TAB.SUBMISSIONS);
  const arcSheet = ss.getSheetByName(TAB.ARCHIVE);

  // ── QC checks — hard reject, row is never written if any fail ──
  const flags = [];
  if (title.length < 190)                        flags.push("Title too short (<190 chars)");
  if (title.length > 225)                        flags.push("Title too long (>225 chars)");
  if (description.length < 100)                  flags.push("Description too short (<100 chars)");
  if (!driveFolder.includes("drive.google.com")) flags.push("Drive folder link invalid — must be a Google Drive link");
  if (checkDuplicateShopeeUrl(shopeeLink, subSheet, arcSheet)) flags.push("Duplicate Shopee URL — this product has already been submitted");

  // Return errors immediately — nothing is written to the sheet
  if (flags.length) return { ok: false, error: flags.join(" | "), qcFlags: flags };

  // ── Pricing ──────────────────────────────────────────────
  const sellPrice      = calcSellPrice(sourceCost);
  const assignedLister = assignLister(subSheet, ss.getSheetByName(TAB.CONFIG));

  // ── Append row ───────────────────────────────────────────
  const newRow = new Array(S_TOTAL_COLS).fill("");
  newRow[S.TIMESTAMP    - 1] = new Date();
  newRow[S.VA_CODE      - 1] = vaCode.toUpperCase();
  newRow[S.TITLE        - 1] = title;
  newRow[S.DESCRIPTION  - 1] = description;
  newRow[S.SHOPEE_LINK  - 1] = shopeeLink;
  newRow[S.SOURCE_COST  - 1] = sourceCost;
  newRow[S.DRIVE_FOLDER - 1] = driveFolder;
  newRow[S.SELL_PRICE   - 1] = sellPrice;
  newRow[S.LISTER       - 1] = assignedLister;
  newRow[S.STATUS       - 1] = "Pending";

  subSheet.appendRow(newRow);

  return {
    ok        : true,
    sellPrice : sellPrice,
    lister    : assignedLister,
  };
}

// Pricing formula: CEILING(MAX(cost × 1.5, cost + 20), 5)
function calcSellPrice(cost) {
  return Math.ceil(Math.max(cost * 1.5, cost + 20) / 5) * 5;
}

// Duplicate Shopee URL check — searches Submissions + Archive tabs
function checkDuplicateShopeeUrl(url, subSheet, arcSheet) {
  const target = url.trim().toLowerCase();
  for (const sheet of [subSheet, arcSheet]) {
    if (!sheet || sheet.getLastRow() < 2) continue;
    const links = sheet.getRange(2, S.SHOPEE_LINK, sheet.getLastRow() - 1, 1).getValues().flat();
    if (links.some(l => String(l).trim().toLowerCase() === target)) return true;
  }
  return false;
}

// Lister auto-assignment — assigns to lister with lowest current Pending/In Progress workload
function assignLister(subSheet, configSheet) {
  const configData    = getConfigData(configSheet);
  const activeListers = configData.filter(r =>
    norm(r[C.ROLE - 1]) === "lister" && norm(r[C.STATUS - 1]) === "active"
  );
  if (!activeListers.length) return "";

  const workload = {};
  activeListers.forEach(l => { workload[trim(l[C.CODE - 1]).toUpperCase()] = 0; });

  const lastRow = subSheet.getLastRow();
  if (lastRow >= 2) {
    const statuses = subSheet.getRange(2, S.STATUS, lastRow - 1, 1).getValues().flat();
    const listers  = subSheet.getRange(2, S.LISTER, lastRow - 1, 1).getValues().flat();
    statuses.forEach((status, i) => {
      const s = norm(status);
      if (s !== "pending" && s !== "in progress") return;
      const code = trim(listers[i]).toUpperCase();
      if (code in workload) workload[code]++;
    });
  }

  let minCount = Infinity, picked = "";
  for (const [code, count] of Object.entries(workload)) {
    if (count < minCount) { minCount = count; picked = code; }
  }
  return picked;
}

// ============================================================
// ENDPOINT: ?action=progress&va=RVA001&date=2025-04-21
// Returns a researcher VA's submission count vs their target for a given date
// ============================================================

function handleProgress(p) {
  const vaCode = trim(p.va || p.vaCode || "").toUpperCase();
  if (!vaCode) return { ok: false, error: "Missing va parameter" };

  const ss          = getSpreadsheet();
  const subSheet    = ss.getSheetByName(TAB.SUBMISSIONS);
  const configSheet = ss.getSheetByName(TAB.CONFIG);

  const targetDateStr = p.date
    ? Utilities.formatDate(new Date(p.date), CONFIG.TIMEZONE, "yyyy-MM-dd")
    : Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");

  // Get target from Config
  const configData = getConfigData(configSheet);
  const vaRow      = configData.find(r => trim(r[C.CODE - 1]).toUpperCase() === vaCode);
  const target     = vaRow ? (Number(vaRow[C.TARGET - 1]) || 0) : 0;

  // Count submissions for this VA on the target date
  let count = 0;
  const lastRow = subSheet.getLastRow();
  if (lastRow >= 2) {
    const codes      = subSheet.getRange(2, S.VA_CODE,   lastRow - 1, 1).getValues().flat();
    const timestamps = subSheet.getRange(2, S.TIMESTAMP, lastRow - 1, 1).getValues().flat();
    codes.forEach((code, i) => {
      if (trim(code).toUpperCase() !== vaCode) return;
      const ts = timestamps[i];
      if (!ts) return;
      if (Utilities.formatDate(new Date(ts), CONFIG.TIMEZONE, "yyyy-MM-dd") === targetDateStr) count++;
    });
  }

  return {
    ok       : true,
    vaCode   : vaCode,
    date     : targetDateStr,
    submitted: count,
    target   : target,
    met      : count >= target,
  };
}

// ============================================================
// ENDPOINT: ?action=queue&lister=LVA001
// Returns all Pending / In Progress tasks assigned to a lister
// ============================================================

function handleQueue(p) {
  const listerCode = trim(p.lister || "").toUpperCase();
  if (!listerCode) return { ok: false, error: "Missing lister parameter" };

  const ss          = getSpreadsheet();
  const configSheet = ss.getSheetByName(TAB.CONFIG);
  const configData  = getConfigData(configSheet);
  const isValid     = configData.some(r =>
    trim(r[C.CODE - 1]).toUpperCase() === listerCode &&
    norm(r[C.ROLE - 1]) === "lister" &&
    norm(r[C.STATUS - 1]) === "active"
  );
  if (!isValid) return { ok: false, error: "Lister code not recognised or inactive: " + listerCode };

  const subSheet = ss.getSheetByName(TAB.SUBMISSIONS);
  const lastRow  = subSheet.getLastRow();
  if (lastRow < 2) return { ok: true, tasks: [] };

  const data  = subSheet.getRange(2, 1, lastRow - 1, S_TOTAL_COLS).getValues();
  const tasks = [];

  data.forEach((row, i) => {
    if (trim(row[S.LISTER - 1]).toUpperCase() !== listerCode) return;
    const status = norm(row[S.STATUS - 1]);
    if (status !== "pending" && status !== "in progress") return;

    tasks.push({
      rowIndex    : i + 2,
      vaCode      : row[S.VA_CODE      - 1],
      title       : row[S.TITLE        - 1],
      description : row[S.DESCRIPTION  - 1],
      shopeeLink  : row[S.SHOPEE_LINK  - 1],
      sourceCost  : row[S.SOURCE_COST  - 1],
      sellPrice   : row[S.SELL_PRICE   - 1],
      driveFolder : row[S.DRIVE_FOLDER - 1],
      status      : row[S.STATUS       - 1],
      timestamp   : row[S.TIMESTAMP    - 1]
        ? Utilities.formatDate(new Date(row[S.TIMESTAMP - 1]), CONFIG.TIMEZONE, "dd MMM yyyy, HH:mm")
        : "",
    });
  });

  return { ok: true, lister: listerCode, tasks: tasks };
}

// ============================================================
// ENDPOINT: ?action=complete&rowIndex=5&lister=LVA001&carousellUrl=https://www.carousell.sg/p/...
// Lister marks a task as done
// ============================================================

function handleComplete(p) {
  const rowIndex     = parseInt(p.rowIndex);
  const listerCode   = trim(p.lister || "").toUpperCase();
  const carousellUrl = trim(p.carousellUrl || p.carousell_url || "");

  if (isNaN(rowIndex) || rowIndex < 2)
    return { ok: false, error: "Invalid rowIndex" };
  if (!listerCode)
    return { ok: false, error: "Missing lister" };
  if (!carousellUrl.startsWith("https://www.carousell.sg/"))
    return { ok: false, error: "Carousell URL must start with https://www.carousell.sg/" };

  const subSheet = getSpreadsheet().getSheetByName(TAB.SUBMISSIONS);
  const rowData  = subSheet.getRange(rowIndex, 1, 1, S_TOTAL_COLS).getValues()[0];
  const rowLister = trim(rowData[S.LISTER - 1]).toUpperCase();
  const rowStatus = norm(rowData[S.STATUS - 1]);

  if (rowLister !== listerCode)
    return { ok: false, error: "This task is not assigned to " + listerCode };
  if (rowStatus === "done")
    return { ok: false, error: "Task already marked as done" };
  if (rowStatus === "flagged")
    return { ok: false, error: "Task is flagged — cannot complete a flagged submission" };

  const today = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  subSheet.getRange(rowIndex, S.STATUS       ).setValue("Done");
  subSheet.getRange(rowIndex, S.CAROUSELL_URL).setValue(carousellUrl);
  subSheet.getRange(rowIndex, S.DATE_POSTED  ).setValue(today);

  return { ok: true, message: "Listing marked as done." };
}

// ============================================================
// ENDPOINT: ?action=flag&rowIndex=5&lister=LVA001&reason=...
// Lister flags a bad researcher submission
// ============================================================

function handleFlag(p) {
  const rowIndex   = parseInt(p.rowIndex);
  const listerCode = trim(p.lister || "").toUpperCase();
  const reason     = trim(p.reason || "");

  if (isNaN(rowIndex) || rowIndex < 2) return { ok: false, error: "Invalid rowIndex" };
  if (!listerCode)                      return { ok: false, error: "Missing lister" };
  if (!reason)                          return { ok: false, error: "Missing reason for flag" };

  const ss          = getSpreadsheet();
  const subSheet    = ss.getSheetByName(TAB.SUBMISSIONS);
  const configSheet = ss.getSheetByName(TAB.CONFIG);

  const rowData   = subSheet.getRange(rowIndex, 1, 1, S_TOTAL_COLS).getValues()[0];
  const rowLister = trim(rowData[S.LISTER - 1]).toUpperCase();
  const rowStatus = norm(rowData[S.STATUS - 1]);
  const vaCode    = trim(rowData[S.VA_CODE - 1]).toUpperCase();

  if (rowLister !== listerCode)
    return { ok: false, error: "This task is not assigned to " + listerCode };
  if (rowStatus === "done")
    return { ok: false, error: "Cannot flag a completed task" };

  subSheet.getRange(rowIndex, S.STATUS).setValue("Flagged");
  subSheet.getRange(rowIndex, S.NOTES ).setValue(reason);

  incrementRejectionCount(configSheet, vaCode);

  return { ok: true, message: "Submission flagged. Researcher " + vaCode + " rejection count incremented." };
}

function incrementRejectionCount(configSheet, vaCode) {
  const lastRow = configSheet.getLastRow();
  if (lastRow < 2) return;
  const codes = configSheet.getRange(2, C.CODE, lastRow - 1, 1).getValues().flat();
  const idx   = codes.findIndex(c => trim(c).toUpperCase() === vaCode);
  if (idx === -1) return;
  const sheetRow = idx + 2;
  const current  = parseInt(configSheet.getRange(sheetRow, C.REJ_CT).getValue()) || 0;
  configSheet.getRange(sheetRow, C.REJ_CT).setValue(current + 1);
}

// ============================================================
// ENDPOINT: ?action=dashboard
// Returns today's stats as JSON — used by external HTML dashboard tools
// ============================================================

function handleDashboardData() {
  const ss          = getSpreadsheet();
  const subSheet    = ss.getSheetByName(TAB.SUBMISSIONS);
  const configSheet = ss.getSheetByName(TAB.CONFIG);
  const todayStr    = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");
  const isSunday    = new Date().getDay() === 0;

  const configData  = getConfigData(configSheet);
  const researchers = configData.filter(r => norm(r[C.ROLE-1]) === "researcher" && norm(r[C.STATUS-1]) === "active");
  const listers     = configData.filter(r => norm(r[C.ROLE-1]) === "lister"     && norm(r[C.STATUS-1]) === "active");

  const lastRow = subSheet.getLastRow();
  const rvaSubmissions = {}, lvaCompletions = {}, lvaTargets = {};

  if (lastRow >= 2) {
    const timestamps  = subSheet.getRange(2, S.TIMESTAMP,   lastRow-1, 1).getValues().flat();
    const vaCodes     = subSheet.getRange(2, S.VA_CODE,     lastRow-1, 1).getValues().flat();
    const statuses    = subSheet.getRange(2, S.STATUS,      lastRow-1, 1).getValues().flat();
    const listerCols  = subSheet.getRange(2, S.LISTER,      lastRow-1, 1).getValues().flat();
    const datesPosted = subSheet.getRange(2, S.DATE_POSTED, lastRow-1, 1).getValues().flat();

    // RVA: count submissions today
    timestamps.forEach((ts, i) => {
      if (!ts) return;
      if (Utilities.formatDate(new Date(ts), CONFIG.TIMEZONE, "yyyy-MM-dd") !== todayStr) return;
      const code = trim(vaCodes[i]).toUpperCase();
      rvaSubmissions[code] = (rvaSubmissions[code] || 0) + 1;
    });

    // LVA target: count all Pending + In Progress rows currently assigned to each lister
    statuses.forEach((status, i) => {
      const s = norm(status);
      if (s !== "pending" && s !== "in progress") return;
      const lister = trim(listerCols[i]).toUpperCase();
      if (lister) lvaTargets[lister] = (lvaTargets[lister] || 0) + 1;
    });

    // LVA completions: Done rows where Date Posted = today
    statuses.forEach((status, i) => {
      if (norm(status) !== "done") return;
      const dp = datesPosted[i];
      if (!dp) return;
      if (Utilities.formatDate(new Date(dp), CONFIG.TIMEZONE, "yyyy-MM-dd") !== todayStr) return;
      const code = trim(listerCols[i]).toUpperCase();
      lvaCompletions[code] = (lvaCompletions[code] || 0) + 1;
    });
  }

  return {
    ok          : true,
    date        : todayStr,
    isSunday    : isSunday,
    researchers : researchers.map(r => {
      const code   = trim(r[C.CODE-1]).toUpperCase();
      const target = isSunday ? 0 : (Number(r[C.TARGET-1]) || 0);
      const done   = rvaSubmissions[code] || 0;
      const na     = isSunday;
      return { code, target, done, pct: target ? Math.round(done/target*100) : 0, met: done >= target, na };
    }),
    listers     : listers.map(l => {
      const code   = trim(l[C.CODE-1]).toUpperCase();
      const target = isSunday ? 0 : (lvaTargets[code] || 0);
      const done   = isSunday ? 0 : (lvaCompletions[code] || 0);
      const na     = isSunday || lvaTargets[code] === undefined;
      return { code, target, done, pct: target ? Math.round(done/target*100) : 0, met: done >= target, na };
    }),
  };
}

// ============================================================
// DASHBOARD TAB REFRESH
// Writes a formatted visual summary to the Dashboard sheet tab
// Runs on hourly trigger + manually via custom menu
// Owner can type a date into cell B2 to view a past day
// ============================================================

function refreshDashboard() {
  const ss          = getSpreadsheet();
  const dashSheet   = getOrCreateSheet(ss, TAB.DASHBOARD);
  const configSheet = ss.getSheetByName(TAB.CONFIG);
  const subSheet    = ss.getSheetByName(TAB.SUBMISSIONS);
  if (!configSheet || !subSheet) return;

  // Date override: cell B2 — blank = today
  const overrideRaw   = dashSheet.getRange("B2").getValue();
  const targetDate    = (overrideRaw instanceof Date && !isNaN(overrideRaw)) ? overrideRaw : new Date();
  const targetDateStr = Utilities.formatDate(targetDate, CONFIG.TIMEZONE, "yyyy-MM-dd");
  const dateLabel     = Utilities.formatDate(targetDate, CONFIG.TIMEZONE, "dd MMM yyyy (EEE)");

  const configData  = getConfigData(configSheet);
  const researchers = configData.filter(r => norm(r[C.ROLE-1]) === "researcher" && norm(r[C.STATUS-1]) === "active");
  const listers     = configData.filter(r => norm(r[C.ROLE-1]) === "lister"     && norm(r[C.STATUS-1]) === "active");

  const lastRow = subSheet.getLastRow();
  const rvaSubmissions = {}, lvaCompletions = {}, lvaTargets = {};
  const isSunday = targetDate.getDay() === 0;

  if (lastRow >= 2) {
    const timestamps  = subSheet.getRange(2, S.TIMESTAMP,   lastRow-1, 1).getValues().flat();
    const vaCodes     = subSheet.getRange(2, S.VA_CODE,     lastRow-1, 1).getValues().flat();
    const statuses    = subSheet.getRange(2, S.STATUS,      lastRow-1, 1).getValues().flat();
    const listerCols  = subSheet.getRange(2, S.LISTER,      lastRow-1, 1).getValues().flat();
    const datesPosted = subSheet.getRange(2, S.DATE_POSTED, lastRow-1, 1).getValues().flat();

    // RVA submissions on target date
    timestamps.forEach((ts, i) => {
      if (!ts) return;
      if (Utilities.formatDate(new Date(ts), CONFIG.TIMEZONE, "yyyy-MM-dd") !== targetDateStr) return;
      const code = trim(vaCodes[i]).toUpperCase();
      rvaSubmissions[code] = (rvaSubmissions[code] || 0) + 1;
    });

    // LVA target: all Pending + In Progress rows currently assigned to each lister
    // (when viewing today; when viewing a past date this still reflects current queue)
    statuses.forEach((status, i) => {
      const s = norm(status);
      if (s !== "pending" && s !== "in progress") return;
      const lister = trim(listerCols[i]).toUpperCase();
      if (lister) lvaTargets[lister] = (lvaTargets[lister] || 0) + 1;
    });

    // LVA completions: Done rows where Date Posted = target date
    statuses.forEach((status, i) => {
      if (norm(status) !== "done") return;
      const dp = datesPosted[i];
      if (!dp || Utilities.formatDate(new Date(dp), CONFIG.TIMEZONE, "yyyy-MM-dd") !== targetDateStr) return;
      const code = trim(listerCols[i]).toUpperCase();
      lvaCompletions[code] = (lvaCompletions[code] || 0) + 1;
    });
  }

  // Build output array
  const out = [];
  out.push(["CAROUSELL BUSINESS DASHBOARD", "", "", "", ""]);
  out.push(["Date:", dateLabel, "", "← Enter a date in this cell to view a past day, or leave blank for today", ""]);
  out.push(["Refreshed:", Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd MMM yyyy, HH:mm") + " SGT", "", "", ""]);
  out.push(["", "", "", "", ""]);

  // RVA section
  out.push(["RESEARCHER VAs", "", "", "", ""]);
  out.push(["VA Code", "Daily Target", "Submitted Today", "% of Target", "Status"]);
  let rTotT = 0, rTotD = 0;
  researchers.forEach(r => {
    const code = trim(r[C.CODE-1]).toUpperCase();
    const done = rvaSubmissions[code] || 0;
    if (isSunday) {
      out.push([code, "N/A", done, "N/A", "— Day Off"]);
    } else {
      const target = Number(r[C.TARGET-1]) || 0;
      const pct    = target ? Math.round(done/target*100) : 0;
      const status = done >= target ? "✅ On Track" : done === 0 ? "🔴 No Submissions" : "⚠️ Behind";
      out.push([code, target, done, pct+"%", status]);
      rTotT += target; rTotD += done;
    }
  });
  if (!researchers.length) out.push(["No active researcher VAs in Config.", "", "", "", ""]);
  out.push(isSunday ? ["TOTAL", "N/A", "", "N/A", ""] : ["TOTAL", rTotT, rTotD, (rTotT ? Math.round(rTotD/rTotT*100) : 0)+"%", ""]);
  out.push(["", "", "", "", ""]);

  // LVA section
  out.push(["LISTER VAs", "", "", "", ""]);
  out.push(["VA Code", "Pending Queue", "Completed Today", "% Cleared", "Status"]);
  let lTotT = 0, lTotD = 0;
  listers.forEach(l => {
    const code   = trim(l[C.CODE-1]).toUpperCase();
    const target = isSunday ? 0 : (lvaTargets[code] || 0);
    const done   = isSunday ? 0 : (lvaCompletions[code] || 0);
    if (isSunday) {
      out.push([code, "N/A", "N/A", "N/A", "— Day Off"]);
    } else if (target === 0) {
      out.push([code, "N/A", done, "N/A", "— No Pending"]);
    } else {
      const pct    = Math.round(done/target*100);
      const status = done >= target ? "✅ Cleared" : done === 0 ? "🔴 Not Started" : "⚠️ In Progress";
      out.push([code, target, done, pct+"%", status]);
      lTotT += target; lTotD += done;
    }
  });
  if (!listers.length) out.push(["No active lister VAs in Config.", "", "", "", ""]);
  out.push(isSunday ? ["TOTAL", "N/A", "N/A", "N/A", ""] : ["TOTAL", lTotT || "N/A", lTotD, (lTotT ? Math.round(lTotD/lTotT*100) : 0)+"%", ""]);

  dashSheet.clearContents();
  dashSheet.clearFormats();
  dashSheet.getRange(1, 1, out.length, 5).setValues(out);
  applyDashboardFormatting(dashSheet, researchers.length, listers.length);

  SpreadsheetApp.getActiveSpreadsheet().toast("Dashboard refreshed ✅", "Done", 3);
}

function applyDashboardFormatting(sheet, rvaCount, lvaCount) {
  sheet.setColumnWidth(1, 140); sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 145); sheet.setColumnWidth(4, 105); sheet.setColumnWidth(5, 165);

  sheet.getRange(1,1,1,5).merge()
    .setFontSize(14).setFontWeight("bold").setBackground("#1a1a2e")
    .setFontColor("#ffffff").setHorizontalAlignment("center");
  sheet.getRange(2,1).setFontWeight("bold");
  sheet.getRange(2,2).setFontWeight("bold");
  sheet.getRange(3,1).setFontColor("#888888").setFontStyle("italic");
  sheet.getRange(3,2).setFontColor("#888888").setFontStyle("italic");

  const rSec=5, rHead=6, rDataS=7, rDataE=rDataS+rvaCount-1, rTot=rDataE+1;
  const lSec=rTot+2, lHead=lSec+1, lDataS=lHead+1, lDataE=lDataS+lvaCount-1, lTot=lDataE+1;

  [rSec, lSec].forEach(r => sheet.getRange(r,1,1,5).merge()
    .setBackground("#16213e").setFontColor("#e0e0e0").setFontWeight("bold").setFontSize(11));
  [rHead, lHead].forEach(r => sheet.getRange(r,1,1,5)
    .setBackground("#0f3460").setFontColor("#ffffff").setFontWeight("bold"));

  [[rDataS,rDataE],[lDataS,lDataE]].forEach(([s,e]) => {
    for (let r = s; r <= e; r++) {
      sheet.getRange(r,1,1,5).setBackground(r%2===0 ? "#f8f9fa" : "#ffffff");
      const sc = sheet.getRange(r,5), sv = sc.getValue();
      if (sv.includes("✅"))      sc.setFontColor("#1e8449").setFontWeight("bold");
      else if (sv.includes("🔴")) sc.setFontColor("#c0392b").setFontWeight("bold");
      else if (sv.includes("⚠️"))sc.setFontColor("#d35400").setFontWeight("bold");
    }
  });

  [rTot, lTot].forEach(r => sheet.getRange(r,1,1,5).setBackground("#d5e8d4").setFontWeight("bold"));
  sheet.setFrozenRows(3);
}

// ============================================================
// AUTO-ARCHIVE — runs Sunday 10pm SGT
// Moves Done rows older than 7 days from Submissions to Archive tab
// ============================================================

function autoArchive() {
  const ss       = getSpreadsheet();
  const subSheet = ss.getSheetByName(TAB.SUBMISSIONS);
  const arcSheet = getOrCreateSheet(ss, TAB.ARCHIVE);
  const lastRow  = subSheet.getLastRow();
  if (lastRow < 2) return;

  const cutoff   = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const allData  = subSheet.getRange(2, 1, lastRow - 1, S_TOTAL_COLS).getValues();
  const toArchive = [], toKeep = [];

  allData.forEach(row => {
    const dp = row[S.DATE_POSTED - 1];
    if (norm(row[S.STATUS - 1]) === "done" && dp && new Date(dp) < cutoff) {
      toArchive.push(row);
    } else {
      toKeep.push(row);
    }
  });

  if (!toArchive.length) return;

  const arcLast = arcSheet.getLastRow();
  arcSheet.getRange(arcLast + 1, 1, toArchive.length, S_TOTAL_COLS).setValues(toArchive);
  subSheet.getRange(2, 1, lastRow - 1, S_TOTAL_COLS).clearContent();
  if (toKeep.length) subSheet.getRange(2, 1, toKeep.length, S_TOTAL_COLS).setValues(toKeep);
}

// ============================================================
// REBALANCE LISTER ASSIGNMENTS
// Redistributes all Pending and In Progress rows evenly across
// active listers by workload. Never touches Done or Flagged rows.
// Triggered automatically when a lister's Status changes in Config (onEdit).
// Also available manually from the ⚙️ Carousell Ops menu.
// ============================================================

function rebalanceListerAssignments() {
  const ss          = getSpreadsheet();
  const subSheet    = ss.getSheetByName(TAB.SUBMISSIONS);
  const configSheet = ss.getSheetByName(TAB.CONFIG);
  const lastRow     = subSheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getActiveSpreadsheet().toast("No rows to reassign.", "Rebalance", 4);
    return;
  }

  const configData    = getConfigData(configSheet);
  const activeListers = configData
    .filter(r => norm(r[C.ROLE - 1]) === "lister" && norm(r[C.STATUS - 1]) === "active")
    .map(r => trim(r[C.CODE - 1]).toUpperCase());

  if (!activeListers.length) {
    SpreadsheetApp.getActiveSpreadsheet().toast("No active listers found — nothing reassigned.", "Rebalance", 4);
    return;
  }

  const statuses = subSheet.getRange(2, S.STATUS, lastRow - 1, 1).getValues().flat();

  // Collect sheet row numbers of all unfinished rows
  const unfinishedRows = [];
  statuses.forEach((status, i) => {
    const s = norm(status);
    if (s === "pending" || s === "in progress") unfinishedRows.push(i + 2);
  });

  if (!unfinishedRows.length) {
    SpreadsheetApp.getActiveSpreadsheet().toast("No pending rows to reassign.", "Rebalance", 4);
    return;
  }

  // Workload counter — starts at zero for each active lister
  const workload = {};
  activeListers.forEach(code => { workload[code] = 0; });

  // Assign each row to the lister with the lowest current count
  unfinishedRows.forEach(rowIndex => {
    const picked = Object.entries(workload).reduce((a, b) => a[1] <= b[1] ? a : b)[0];
    subSheet.getRange(rowIndex, S.LISTER).setValue(picked);
    workload[picked]++;
  });

  const summary = Object.entries(workload).map(([k, v]) => `${k}: ${v}`).join(", ");
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `Rebalanced ${unfinishedRows.length} rows — ${summary}`, "Rebalance ✅", 6
  );
}

// onEdit — fires automatically when any cell in Config tab column D (Status) is edited
// Only triggers rebalance if the edited row belongs to a lister
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== TAB.CONFIG) return;
    if (e.range.getColumn() !== C.STATUS) return;
    const role = norm(sheet.getRange(e.range.getRow(), C.ROLE).getValue());
    if (role !== "lister") return;
    rebalanceListerAssignments();
  } catch (err) {
    // Silent fail — onEdit must never throw or it blocks normal sheet editing
  }
}

// ============================================================
// DAILY EMAIL ALERT — 9pm SGT
// ============================================================

function dailyAlert() {
  const ss          = getSpreadsheet();
  const subSheet    = ss.getSheetByName(TAB.SUBMISSIONS);
  const configSheet = ss.getSheetByName(TAB.CONFIG);
  const todayStr    = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd");

  const configData  = getConfigData(configSheet);
  const researchers = configData.filter(r => norm(r[C.ROLE-1]) === "researcher" && norm(r[C.STATUS-1]) === "active");
  const listers     = configData.filter(r => norm(r[C.ROLE-1]) === "lister"     && norm(r[C.STATUS-1]) === "active");

  const lastRow     = subSheet.getLastRow();
  const isSunday    = new Date().getDay() === 0;
  const rvaSubmissions = {}, lvaCompletions = {}, lvaTargets = {}, urlFailures = [];

  if (lastRow >= 2) {
    const timestamps  = subSheet.getRange(2, S.TIMESTAMP,    lastRow-1, 1).getValues().flat();
    const vaCodes     = subSheet.getRange(2, S.VA_CODE,      lastRow-1, 1).getValues().flat();
    const statuses    = subSheet.getRange(2, S.STATUS,       lastRow-1, 1).getValues().flat();
    const listerCols  = subSheet.getRange(2, S.LISTER,       lastRow-1, 1).getValues().flat();
    const datesPosted = subSheet.getRange(2, S.DATE_POSTED,  lastRow-1, 1).getValues().flat();
    const urls        = subSheet.getRange(2, S.CAROUSELL_URL,lastRow-1, 1).getValues().flat();

    // RVA: submissions today
    timestamps.forEach((ts, i) => {
      if (!ts || Utilities.formatDate(new Date(ts), CONFIG.TIMEZONE, "yyyy-MM-dd") !== todayStr) return;
      const code = trim(vaCodes[i]).toUpperCase();
      rvaSubmissions[code] = (rvaSubmissions[code] || 0) + 1;
    });

    // LVA target: all Pending + In Progress rows currently assigned to each lister
    statuses.forEach((status, i) => {
      const s = norm(status);
      if (s !== "pending" && s !== "in progress") return;
      const lister = trim(listerCols[i]).toUpperCase();
      if (lister) lvaTargets[lister] = (lvaTargets[lister] || 0) + 1;
    });

    // LVA completions + URL validation
    statuses.forEach((status, i) => {
      if (norm(status) !== "done") return;
      const dp = datesPosted[i];
      if (!dp || Utilities.formatDate(new Date(dp), CONFIG.TIMEZONE, "yyyy-MM-dd") !== todayStr) return;
      const code = trim(listerCols[i]).toUpperCase();
      lvaCompletions[code] = (lvaCompletions[code] || 0) + 1;
      const url = trim(urls[i]);
      if (!url.startsWith("https://www.carousell.sg/")) urlFailures.push({ row: i + 2, url: url || "(empty)" });
    });
  }

  const totalRvaToday    = Object.values(rvaSubmissions).reduce((a, b) => a + b, 0);
  const totalLvaTarget   = Object.values(lvaTargets).reduce((a, b) => a + b, 0);
  const totalLvaComplete = Object.values(lvaCompletions).reduce((a, b) => a + b, 0);

  const zeroRVAs = isSunday ? [] : researchers.filter(r => !(rvaSubmissions[trim(r[C.CODE-1]).toUpperCase()]));

  let body = `<h2>📊 Carousell Daily Alert — ${todayStr}</h2>`;
  if (isSunday) {
    body += `<p style="color:#888;">📅 Sunday — RVAs are off today.</p>`;
  } else if (zeroRVAs.length) {
    body += `<p style="color:red;font-weight:bold;">🔴 Zero submissions today: ${zeroRVAs.map(r => trim(r[C.CODE-1]).toUpperCase()).join(", ")}</p>`;
  }

  const table = (rows) => `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
  const tr    = (cells) => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
  const th    = (cells) => `<tr>${cells.map(c => `<th>${c}</th>`).join("")}</tr>`;

  // RVA table
  body += `<h3>Researcher VAs</h3>`;
  if (isSunday) {
    body += `<p style="color:#888;">No targets today (day off).</p>`;
  } else {
    body += table(
      th(["VA Code","Target","Submitted","Status"]) +
      researchers.map(r => {
        const code=trim(r[C.CODE-1]).toUpperCase(), target=Number(r[C.TARGET-1])||0, done=rvaSubmissions[code]||0;
        const color = done>=target ? "#1e8449" : done===0 ? "#c0392b" : "#d35400";
        const label = done>=target ? "✅ On Track" : done===0 ? "🔴 No Submissions" : "⚠️ Behind";
        return tr([code, target, done, `<span style="color:${color};font-weight:bold">${label}</span>`]);
      }).join("")
    );
  }

  // LVA table — target = current pending queue per lister
  body += `<h3>Lister VAs</h3>`;
  if (isSunday) {
    body += `<p style="color:#888;">📅 Sunday — LVAs are off today.</p>`;
  } else {
    body += `<p>Team total: <strong>${totalLvaComplete} completed</strong> out of <strong>${totalLvaTarget} pending</strong></p>`;
    body += table(
      th(["VA Code","Pending Queue","Completed Today","Status"]) +
      listers.map(l => {
        const code=trim(l[C.CODE-1]).toUpperCase(), target=lvaTargets[code]||0, done=lvaCompletions[code]||0;
        if (target === 0) return tr([code, "N/A", done, `<span style="color:#888;">— No Pending</span>`]);
        const color = done>=target ? "#1e8449" : done===0 ? "#c0392b" : "#d35400";
        const label = done>=target ? "✅ Cleared" : done===0 ? "🔴 Not Started" : "⚠️ In Progress";
        return tr([code, target, done, `<span style="color:${color};font-weight:bold">${label}</span>`]);
      }).join("")
    );
  }

  if (urlFailures.length) {
    body += `<h3 style="color:red;">⚠️ Carousell URL Failures (${urlFailures.length})</h3><ul>`;
    urlFailures.forEach(f => { body += `<li>Row ${f.row}: ${f.url}</li>`; });
    body += `</ul>`;
  }

  MailApp.sendEmail({ to: CONFIG.ALERT_EMAIL, subject: `Carousell Daily Alert — ${todayStr}`, htmlBody: body });
}

// ============================================================
// WEEKLY PERFORMANCE SUMMARY — Sunday 9pm SGT
// ============================================================

function weeklySummary() {
  const ss          = getSpreadsheet();
  const subSheet    = ss.getSheetByName(TAB.SUBMISSIONS);
  const configSheet = ss.getSheetByName(TAB.CONFIG);
  const now         = new Date();
  const weekAgo     = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const configData  = getConfigData(configSheet);
  const researchers = configData.filter(r => norm(r[C.ROLE-1]) === "researcher" && norm(r[C.STATUS-1]) === "active");

  const lastRow = subSheet.getLastRow();
  const weeklyRej = {};
  let totalDone = 0;

  if (lastRow >= 2) {
    const timestamps = subSheet.getRange(2, S.TIMESTAMP, lastRow-1, 1).getValues().flat();
    const vaCodes    = subSheet.getRange(2, S.VA_CODE,   lastRow-1, 1).getValues().flat();
    const statuses   = subSheet.getRange(2, S.STATUS,    lastRow-1, 1).getValues().flat();

    timestamps.forEach((ts, i) => {
      if (!ts || new Date(ts) < weekAgo) return;
      const code = trim(vaCodes[i]).toUpperCase();
      const s    = norm(statuses[i]);
      if (s === "flagged") weeklyRej[code] = (weeklyRej[code] || 0) + 1;
      if (s === "done")    totalDone++;
    });
  }

  const dateRange = `${Utilities.formatDate(weekAgo, CONFIG.TIMEZONE, "dd MMM")} – ${Utilities.formatDate(now, CONFIG.TIMEZONE, "dd MMM yyyy")}`;
  const table = (rows) => `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse">${rows}</table>`;
  const tr    = (cells) => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
  const th    = (cells) => `<tr>${cells.map(c => `<th>${c}</th>`).join("")}</tr>`;

  let body = `<h2>📋 Carousell Weekly Summary — ${dateRange}</h2>`;
  body += `<p><strong>Total listings posted this week: ${totalDone}</strong></p>`;

  body += `<h3>Researcher Rejections This Week</h3>`;
  body += table(
    th(["VA Code","Rejections This Week","Flag"]) +
    researchers.map(r => {
      const code = trim(r[C.CODE-1]).toUpperCase(), rej = weeklyRej[code] || 0;
      const flag = rej >= 3 ? `<span style="color:red;font-weight:bold">⚠️ Needs Review</span>` : "";
      return tr([code, rej, flag]);
    }).join("")
  );

  body += `<h3>Cumulative Rejections (all time)</h3>`;
  body += table(
    th(["VA Code","Total Rejections"]) +
    researchers.map(r => {
      const code = trim(r[C.CODE-1]).toUpperCase(), total = Number(r[C.REJ_CT-1]) || 0;
      return tr([code, total]);
    }).join("")
  );

  MailApp.sendEmail({ to: CONFIG.ALERT_EMAIL, subject: `Carousell Weekly Summary — ${dateRange}`, htmlBody: body });
}

// ============================================================
// ONE-TIME SHEET SETUP
// Writes headers to all 4 tabs. Safe to run on blank or pre-existing sheets.
// Will not overwrite if headers already exist.
// ============================================================

function setupSheetHeaders() {
  const ss = getSpreadsheet();

  const subSheet = getOrCreateSheet(ss, TAB.SUBMISSIONS);
  if (subSheet.getLastRow() === 0) {
    subSheet.appendRow(["Timestamp","VA Code","Product Title","Product Description","Shopee Link","Source Cost","Drive Folder","Sell Price","Assigned Lister","Status","Carousell URL","Date Posted","Notes"]);
    subSheet.getRange(1,1,1,S_TOTAL_COLS).setBackground("#0f3460").setFontColor("#ffffff").setFontWeight("bold");
    subSheet.setFrozenRows(1);
  }

  const configSheet = getOrCreateSheet(ss, TAB.CONFIG);
  if (configSheet.getLastRow() === 0) {
    configSheet.appendRow(["VA Code","Role","Daily Target","Status","Rejection Count"]);
    configSheet.getRange(1,1,1,5).setBackground("#0f3460").setFontColor("#ffffff").setFontWeight("bold");
    configSheet.setFrozenRows(1);
    // Seed lister rows from CONFIG
    CONFIG.LISTER_CODES.forEach(code => configSheet.appendRow([code,"Lister",140,"Active",0]));
  }

  getOrCreateSheet(ss, TAB.DASHBOARD); // Created blank; refreshDashboard() will populate it

  const arcSheet = getOrCreateSheet(ss, TAB.ARCHIVE);
  if (arcSheet.getLastRow() === 0) {
    arcSheet.appendRow(["Timestamp","VA Code","Product Title","Product Description","Shopee Link","Source Cost","Drive Folder","Sell Price","Assigned Lister","Status","Carousell URL","Date Posted","Notes"]);
    arcSheet.getRange(1,1,1,S_TOTAL_COLS).setBackground("#555555").setFontColor("#ffffff").setFontWeight("bold");
    arcSheet.setFrozenRows(1);
  }

  SpreadsheetApp.getActiveSpreadsheet().toast("Sheet headers written ✅", "Setup", 4);
}

// ============================================================
// TRIGGER INSTALLATION — run setupAll() once after pasting
// ============================================================

function setupAll() {
  setupSheetHeaders();
  setupTrialSheetHeaders();

  // Remove existing managed triggers (safe to re-run)
  ScriptApp.getProjectTriggers().forEach(t => {
    if (["refreshDashboard","dailyAlert","weeklySummary","autoArchive"].includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("refreshDashboard").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("dailyAlert").timeBased().everyDays(1).atHour(21).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger("weeklySummary").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(21).inTimezone(CONFIG.TIMEZONE).create();
  ScriptApp.newTrigger("autoArchive").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).inTimezone(CONFIG.TIMEZONE).create();

  SpreadsheetApp.getActiveSpreadsheet().toast("All triggers installed ✅  —  Now deploy as Web App.", "Setup Complete", 6);
}

// ============================================================
// CUSTOM MENU
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("⚙️ Carousell Ops")
    .addItem("Refresh Dashboard",          "refreshDashboard")
    .addItem("Send Daily Alert Now",       "dailyAlert")
    .addItem("Send Weekly Summary Now",    "weeklySummary")
    .addItem("Run Archive Now",            "autoArchive")
    .addItem("Rebalance Lister Assignments", "rebalanceListerAssignments")
    .addSeparator()
    .addItem("Setup Sheet Headers",        "setupSheetHeaders")
    .addItem("Setup Trial Sheet Headers",  "setupTrialSheetHeaders")
    .addItem("Install All Triggers",       "setupAll")
    .addToUi();
}

// ============================================================
// TRIAL TASK BACKEND
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

// ENDPOINT: ?action=trialResearcher
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

    if (!title && !description && !shopeeLink && isNaN(sourceCost) && !driveFolder) continue;

    const flags = [];
    if (!title)                                         flags.push("Title missing");
    else if (title.length < 190)                        flags.push("Title too short (<190 chars)");
    else if (title.length > 225)                        flags.push("Title too long (>225 chars)");
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

// ENDPOINT: ?action=trialLister
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

// ============================================================
// SHARED HELPERS
// ============================================================

function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getConfigData(configSheet) {
  const lastRow = configSheet.getLastRow();
  if (lastRow < 2) return [];
  return configSheet.getRange(2, 1, lastRow - 1, 5).getValues();
}

function trim(val) {
  return String(val === null || val === undefined ? "" : val).trim();
}

function norm(val) {
  return trim(val).toLowerCase();
}
