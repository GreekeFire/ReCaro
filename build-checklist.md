# Build Checklist — Carousell Business System

---

## COMPONENT 1 — ACCOUNTS & ACCESS

- [ ] **[BLOCKER] [OWNER INPUT]** Create a Google Workspace account (paid tier) using a new dedicated business email address — do not use a personal Gmail. All subsequent assets are owned by this account. Workspace is recommended for a professional email address and better Drive storage, not for email quota (the system sends Quinn at most 2 emails per day).
- [ ] **[BLOCKER] [OWNER INPUT]** Register a Carousell account using the business Gmail. Enable 2FA — 2FA codes must go to business Gmail only, not a personal number or email.
- [ ] Create a Netlify account logged in under the business Gmail (or a dedicated owner account).
- [ ] **[OPTIONAL]** Install Netlify CLI if you plan to use the deployment shell script: `npm install -g netlify-cli`, then run `netlify login`. Not required at launch — manual drag-deploy at app.netlify.com/drop is fine for up to 10 VA hires.

---

## COMPONENT 2 — GOOGLE SHEET

- [ ] **[BLOCKER]** Create a new Google Sheet owned by the business Gmail. Name it exactly: `Carousell Business Master Sheet`.
- [ ] Create five tabs in this order: `Submissions`, `Config`, `ResearcherTrials`, `ListerTrials`, `Archive`.

### Submissions Tab
- [ ] Add header row with exactly 13 columns in order:
  `A=Timestamp, B=VA Code, C=Product Title, D=Product Description, E=Shopee Link, F=Source Cost, G=Drive Folder, H=Sell Price, I=Assigned Lister, J=Status, K=Carousell URL, L=Date Posted, M=Notes`
- [ ] Freeze row 1 as header.
- [ ] Column H (Sell Price) and Column I (Assigned Lister) — leave blank; these are written by Apps Script only, not manually.
- [ ] Column J (Status) — valid values are `Pending` and `Done` only. No other statuses.

### Config Tab
- [ ] Add header row with 6 columns:
  `A=VA Code, B=Role, C=Daily Target, D=Status, E=Rejection Count, F=Contact`
- [ ] Column B valid values: `Researcher` or `Lister`
- [ ] Column D valid values: `Active` or `Inactive`
- [ ] **[OWNER INPUT]** In a clearly labelled cell outside the main table (e.g. cell H1), add a `Rest Day` cell. Set value to `Sunday`. Label cell G1 as `Rest Day →` for clarity. This cell is read by all time triggers — changing it here propagates everywhere.
- [ ] Name that cell using the Name Box (top-left): call it `RestDay` so scripts can reference it by name.
- [ ] **[OWNER INPUT]** Add initial rows for LVA001, LVA002, LVA003 with Role=Lister, daily target=140, Status=Active, and their Telegram handles.
- [ ] Add placeholder rows for RVA001–RVA007 with Role=Researcher, daily target=20, Status=Inactive (activate as VAs are hired).

### ResearcherTrials Tab
- [ ] Add header row:
  `Trial Code, Timestamp, Title 1, Shopee Link 1, Drive Folder 1, Title 2, Shopee Link 2, Drive Folder 2, Title 3, Shopee Link 3, Drive Folder 3, Title 4, Shopee Link 4, Drive Folder 4, Title 5, Shopee Link 5, Drive Folder 5, Score 1, Score 2, Score 3, Score 4, Score 5, Average Score, Pass/Fail`
- [ ] Freeze row 1 as header.

### ListerTrials Tab
- [ ] Add header row:
  `Trial Code, Timestamp, Carousell URL 1, Carousell URL 2, Carousell URL 3, Pass/Fail`
- [ ] Freeze row 1 as header.

### Archive Tab
- [ ] Add the same 13-column header as Submissions tab. Rows are moved here by script — no other setup needed.

### Trials Config Tab
- [ ] Create a new sheet tab named `TrialsConfig`.
- [ ] Add header row: `Trial Code, Issue Date, Role (Researcher/Lister), Used`
- [ ] **[OWNER INPUT]** This tab is manually updated each time a trial code is issued to a candidate. The Apps Script reads it to enforce the 7-day expiry on trial form submissions.

---

## COMPONENT 3 — GOOGLE APPS SCRIPT

- [ ] **[BLOCKER]** Open the business Gmail Google Sheet → Extensions → Apps Script. This creates the bound script project.
- [ ] Rename the project to `Carousell Business Script`.
- [ ] Delete the default empty `myFunction` before writing anything.

### Global Constants (top of script)
- [ ] Define the spreadsheet ID as a constant (copy from the Sheet URL).
- [ ] Define tab name constants: `SUBMISSIONS_TAB`, `CONFIG_TAB`, `ARCHIVE_TAB`, `RESEARCHER_TRIALS_TAB`, `LISTER_TRIALS_TAB`, `TRIALS_CONFIG_TAB`.
- [ ] Define column index constants for Submissions (A=0 through M=12) and Config (A=0 through F=5) to avoid magic numbers throughout the script.

### Helper Functions (build these first — endpoints depend on them)
- [ ] **`getRestDay()`** — reads the named range `RestDay` from Config tab, returns the day name (e.g. "Sunday"). All trigger functions call this before executing.
- [ ] **`isRestDay()`** — returns true if today matches the rest day.
- [ ] **`getSellPrice(cost)`** — implements `CEILING(MAX(cost * 1.5, cost + 20), 5)`. Unit test: input 12 → expect 35.
- [ ] **`getActiveListers()`** — reads Config tab, returns array of VA codes where Role=Lister and Status=Active.
- [ ] **`getListerWorkload(listerCode)`** — counts rows in Submissions tab where Assigned Lister = listerCode and Status = Pending.
- [ ] **`assignLister()`** — calls `getActiveListers()`, calls `getListerWorkload()` for each, returns the code with the lowest count. Returns null if none active.
- [ ] **`isDuplicateShopeeURL(url)`** — checks Submissions tab AND Archive tab for existing row with matching Shopee URL. Returns true if found.
- [ ] **`isDuplicateTrialSubmission(trialCode, url, role)`** — checks ResearcherTrials or ListerTrials tab for matching trial code + URL combo. Returns true if duplicate.
- [ ] **`isTrialExpired(trialCode)`** — reads TrialsConfig tab, finds the trial code's issue date, returns true if today minus issue date > 7 days.
- [ ] **`getVARejectionCount(vaCode)`** — reads Config tab, finds the row with matching VA code, returns value in column E.
- [ ] **`incrementRejectionCount(vaCode)`** — finds VA row in Config, increments column E by 1.

### Endpoint: `?action=submit`
- [ ] Parse params: `va`, `title`, `description`, `shopeeUrl`, `cost`, `driveFolder`
- [ ] QC checks in this order — return exact error string on fail, write nothing to sheet:
  - [ ] Title length: 190–225 characters
  - [ ] Description length: 100+ characters
  - [ ] Cost: numeric, not zero, not blank
  - [ ] Shopee URL: starts with `https://shopee.sg/`
  - [ ] Drive folder: contains `drive.google.com`
  - [ ] Duplicate Shopee URL: call `isDuplicateShopeeURL(shopeeUrl)`
- [ ] If all checks pass:
  - [ ] Calculate sell price: `getSellPrice(cost)`
  - [ ] Assign lister: `assignLister()` — if null, send immediate alert email to Quinn, return error to VA
  - [ ] Write row to Submissions tab: timestamp, va code, title, description, shopee URL, cost, drive folder, sell price, assigned lister, status="Pending", blank URL, blank date, blank notes
- [ ] Return `{success: true}` on success or `{success: false, error: "..."}` on any failure

### Endpoint: `?action=progress`
- [ ] Parse params: `va`, `date`
- [ ] Count rows in Submissions tab where column B = va code and column A date matches the given date
- [ ] Return `{count: N, target: T}` where T is read from Config tab for that VA

### Endpoint: `?action=queue`
- [ ] Parse params: `lister`
- [ ] Validate lister code is Active in Config — return error if not
- [ ] Read all Submissions rows where column I = lister code and column J = "Pending"
- [ ] Return per task: row number, title, description, sell price, Shopee link, Drive folder — **do NOT return source cost or any margin calculation**
- [ ] Return JSON array of task objects

### Endpoint: `?action=complete`
- [ ] Parse params: `lister`, `row`, `url`
- [ ] Validate lister code exists and is Active in Config — return error if not
- [ ] Validate Carousell URL starts with `https://www.carousell.sg/` — return error if not
- [ ] Write to the specified row: column J → "Done", column K → url, column L → today's date
- [ ] Return `{success: true}` or `{success: false, error: "..."}`

### Endpoint: `?action=flag`
- [ ] Parse params: `lister`, `row`, `reason`
- [ ] Read column B (VA code) from the specified row
- [ ] Call `incrementRejectionCount(vaCode)`
- [ ] Write reason to column M of that row
- [ ] Do NOT change column J (Status) — task stays Pending
- [ ] Return `{success: true}`

### Endpoint: `?action=dashboard`
- [ ] Count all rows in Submissions where Status = Pending → `pendingCount`
- [ ] Count all rows in Submissions where Date Posted = today → `completedToday`
- [ ] Read active lister count and active researcher count from Config
- [ ] Calculate `dailyCapacity = active listers × 140`
- [ ] Calculate `daysRemaining = dailyCapacity > 0 ? pendingCount / dailyCapacity : null`
- [ ] Set `overflowWarning = pendingCount > 2 * dailyCapacity`
- [ ] Return all values as JSON

### `doGet(e)` Router
- [ ] Write a single `doGet(e)` function that reads `e.parameter.action` and routes to the correct handler
- [ ] Wrap all handlers in try/catch — return `{success: false, error: e.toString()}` on any unhandled exception
- [ ] Return all responses as `ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON)`

### Rebalancer Function
- [ ] Write `rebalanceTasks(inactiveListerCode)`:
  - [ ] Read all Pending rows in Submissions where Assigned Lister = inactiveListerCode
  - [ ] For each row, call `assignLister()` and update column I with the new assignment
  - [ ] Skip Done rows — never touch them

### Time Trigger: Nightly Archive
- [ ] Write `archiveCompletedRows()`:
  - [ ] Call `isRestDay()` — if true, return immediately
  - [ ] Read all rows in Submissions where Status = Done and Date Posted is more than 24 hours ago
  - [ ] Append each row to Archive tab
  - [ ] Delete matched rows from Submissions tab (delete from bottom up to preserve row indices)
- [ ] Add trigger: time-driven → day timer → between 11pm–midnight → function: `archiveCompletedRows`

### Time Trigger: Mid-Day Lister Alert
- [ ] Write `midDayListerAlert()`:
  - [ ] Call `isRestDay()` — if true, return immediately
  - [ ] For each Active lister: count their Pending tasks, count their Done tasks posted today
  - [ ] If any lister's completions today < 25% of their pending count: include in alert
  - [ ] If any listers are under threshold: send email to business Gmail with list of names and counts
- [ ] Add trigger: time-driven → hour timer → between 2pm–3pm SGT → function: `midDayListerAlert`

### Time Trigger: Daily Performance Alert
- [ ] Write `dailyPerformanceAlert()`:
  - [ ] Call `isRestDay()` — if true, return immediately
  - [ ] Build email body with all required sections:
    - [ ] RVA section: for each Active researcher, submissions today vs Config target. Flag zero-submission RVAs at top.
    - [ ] LVA section: for each Active lister, completions today vs assigned Pending queue. Flag under-25% listers at top.
    - [ ] Queue section: total Pending count, days of capacity remaining
    - [ ] Overflow warning: if pending > 2× daily capacity, include bold warning
    - [ ] Format failures: any Carousell URLs that failed format validation today
    - [ ] Flag summary: all rows where column M was written today — list researcher VA code, lister who flagged, reason
    - [ ] Spot-check URLs: at least 1 Done URL per Active lister from today. Extra draws from listers in first 14 days or with recent flags. Cap total at 5 URLs.
  - [ ] Send email to business Gmail
- [ ] Add trigger: time-driven → day timer → between 9pm–10pm SGT → function: `dailyPerformanceAlert`

### Time Trigger: Weekly Performance Summary
- [ ] Write `weeklyPerformanceSummary()`:
  - [ ] Check if today is Saturday — if not, return immediately
  - [ ] For each Active RVA:
    - [ ] Count flagged rows (column M non-empty) in Submissions AND Archive where VA code matches and Date Posted is within past 7 days → weekly rejection count
    - [ ] Count total submissions in past 7 days
    - [ ] Calculate rejection rate (only show if 10+ submissions that week)
    - [ ] Flag any RVA with 3+ rejections or >15% rate
    - [ ] Flag any RVA with zero submissions for 3+ consecutive days
  - [ ] For each Active LVA: total completions for week, daily average
  - [ ] Total listings posted this week across all listers
  - [ ] Send email to business Gmail
- [ ] Add trigger: time-driven → week timer → every Saturday → function: `weeklyPerformanceSummary`

### Deploy Apps Script Web App
- [ ] **[BLOCKER]** Click Deploy → New Deployment → Web App
- [ ] Set: Execute as = Me (business Gmail), Who has access = Anyone
- [ ] Copy the deployed web app URL — this is `SCRIPT_URL` used in all HTML files
- [ ] Test: visit `[SCRIPT_URL]?action=dashboard` in a browser — confirm JSON response with no errors

---

## COMPONENT 4 — NETLIFY HTML FILES

- [ ] **[BLOCKER]** Confirm `SCRIPT_URL` from Component 3 is in hand before building any HTML file.
- [ ] Create a local working folder for all HTML files.

### `va-form-TEMPLATE.html` — Researcher Submission Form
- [ ] Set `const SCRIPT_URL = "..."` and `const VA_CODE = "TEMPLATE"` at top
- [ ] Build form with fields: Product Title, Product Description, Shopee Link, Source Cost, Drive Folder Link
- [ ] On page load: fetch `?action=progress&va=VA_CODE&date=TODAY` and display "X submitted today / Y target"
- [ ] On submit: call `?action=submit`, display success message or exact error string from script
- [ ] Confirmation screen must NOT show sell price — show only "Submission received" with the product title
- [ ] Test with VA_CODE = "RVA001" — confirm form submits and QC errors display correctly

### `lister-queue-TEMPLATE.html` — Lister Task Queue
- [ ] Set `const SCRIPT_URL = "..."` and `const LISTER_CODE = "TEMPLATE"` at top
- [ ] On page load: fetch `?action=queue&lister=LISTER_CODE`, render list of Pending tasks
- [ ] Each task card expands to show: Title, Description, Sell Price, Shopee Link (clickable), Drive Folder Link (clickable)
- [ ] **Do not show source cost or margin anywhere on this page**
- [ ] Complete button: Carousell URL text input + submit → calls `?action=complete`, refreshes task list on success
- [ ] Flag button (separate from complete): reason text input + submit → calls `?action=flag`, shows confirmation, does not remove task from queue
- [ ] Test with LISTER_CODE = "LVA001" against a Pending row in the sheet

### `owner-dashboard.html` — Owner Live Dashboard
- [ ] Set `const SCRIPT_URL = "..."` at top
- [ ] On page load and every 60 seconds: fetch `?action=dashboard`, render all fields
- [ ] Display: Pending queue count, Done today, Daily capacity, Days of queue remaining, Active lister count, Active researcher count
- [ ] If `overflowWarning = true`: show a prominent red banner "QUEUE OVERFLOW — follow response procedure"
- [ ] **[OWNER INPUT]** Deploy to Netlify with a non-guessable site name. Do not share this URL with any VA.

### `listing-price-calculator.html` — Owner Price Calculator
- [ ] No `SCRIPT_URL` needed — fully client-side
- [ ] Input: source cost (number field)
- [ ] On input change: calculate and display sell price using `CEILING(MAX(cost * 1.5, cost + 20), 5)`, show formula breakdown
- [ ] For owner use only — do not link in any VA onboarding message

### `trial-researcher.html` — Researcher Trial Form
- [ ] Field 1: Trial Code
- [ ] On trial code entry: validate expiry and duplicate via Apps Script — display error immediately before candidate fills anything else
- [ ] Fields 2–6: five sets of (Product Title, Shopee Link, Drive Folder Link)
- [ ] On submit: re-validate trial code server-side, write to ResearcherTrials tab on pass
- [ ] Show clear success message on pass; exact rejection reason on fail

### `trial-lister.html` — Lister Trial Form
- [ ] Field 1: Trial Code with same expiry/duplicate validation
- [ ] Fields 2–4: three Carousell URL inputs
- [ ] On submit: validate trial code, validate each URL starts with `https://www.carousell.sg/`, write to ListerTrials tab on pass

---

## COMPONENT 5 — SOPs (Google Docs)

- [ ] **[OWNER INPUT]** Create both documents logged in as the business Gmail.

### Researcher SOP
- [ ] Create Google Doc: "Researcher VA — Standard Operating Procedure"
- [ ] Section 1: Approved categories list
- [ ] Section 2: Step-by-step workflow (7 steps)
- [ ] Section 3: AI prompt template — generate Carousell description from Shopee description
- [ ] Section 4: AI prompt template — generate Carousell title (remind VA: title must be 190–225 characters)
- [ ] Section 5: Image rules — 5–10 images, clean cover with cleanup.pictures if watermark/logo/promo text present
- [ ] Section 6: Common rejection reasons and how to avoid them
- [ ] Set sharing: "Anyone with the link can view"
- [ ] Copy shareable link — this is `[SOP URL]` in researcher onboarding messages

### Lister SOP
- [ ] Create Google Doc: "Lister VA — Standard Operating Procedure"
- [ ] Section 1: Step-by-step workflow (8 steps)
- [ ] Section 2: How to fix bad submissions — sourcing images from Drive, using cleanup.pictures, improving short descriptions
- [ ] Section 3: Flagging rules — what counts as flag-worthy, how to write a useful flag reason
- [ ] Section 4: Carousell listing guidelines — required fields, image order, price entry
- [ ] Set sharing: "Anyone with the link can view"
- [ ] Copy shareable link — this is `[SOP URL]` in lister onboarding messages

---

## COMPONENT 6 — DEPLOYMENT SHELL SCRIPT (OPTIONAL)

Skip this component at launch. Manual drag-deploy is sufficient for up to 10 hires. Build this when hiring becomes frequent enough that manual deploys are taking meaningful time.

- [ ] Confirm Netlify CLI is installed and authenticated (from Component 1 optional step)
- [ ] Create file `deploy-va.sh` in the same folder as your HTML templates
- [ ] Script logic:
  - [ ] Accept one argument: VA code (e.g. `RVA003` or `LVA002`)
  - [ ] If argument starts with `RVA`: copy `va-form-TEMPLATE.html`, replace `VA_CODE = "TEMPLATE"` with `VA_CODE = "[ARG]"`
  - [ ] If argument starts with `LVA`: copy `lister-queue-TEMPLATE.html`, replace `LISTER_CODE = "TEMPLATE"` with `LISTER_CODE = "[ARG]"`
  - [ ] Create a subfolder named after the VA code, rename file to `index.html`, place it inside
  - [ ] Run `netlify deploy --prod --dir=[VA_CODE]` and capture the deployed URL
  - [ ] Print the URL to console
  - [ ] Clean up the temp subfolder after deploy
- [ ] Run `chmod +x deploy-va.sh`
- [ ] **[OWNER INPUT]** Test: run `./deploy-va.sh RVA001`, verify the deployed URL loads the correct form with VA_CODE = "RVA001"

---

## FINAL VERIFICATION BEFORE GO-LIVE

- [ ] Test full researcher submission flow end to end: submit via `va-form` → confirm row appears in Submissions tab with correct sell price and lister assignment
- [ ] Test QC rejection: submit with a title under 190 characters → confirm nothing written to sheet, error shown to VA
- [ ] Test lister complete flow: open `lister-queue`, complete a task → confirm row updates to Done with URL and date
- [ ] Test flag flow: flag a submission → confirm rejection count increments in Config, reason in Notes column, row stays Pending
- [ ] Test nightly archive manually: run `archiveCompletedRows()` from Apps Script editor → confirm Done rows move to Archive tab
- [ ] Test daily alert manually: run `dailyPerformanceAlert()` → confirm email arrives at business Gmail with correct data
- [ ] Test weekly summary manually: run `weeklyPerformanceSummary()` → confirm email arrives with correct data
- [ ] Test trial expiry: set a trial code issue date to 8 days ago in TrialsConfig → attempt submission → confirm hard rejection
- [ ] Confirm lister queue shows no source cost or margin for any task
- [ ] Confirm researcher form confirmation screen shows no sell price
- [ ] **[OWNER INPUT]** Add first active lister (LVA001) to Config with Status=Active, Telegram handle, target=140
- [ ] **[OWNER INPUT]** Confirm Carousell credentials are stored nowhere except Quinn's own Telegram — not in any sheet, doc, or form
