# Carousell Reselling Business — Full Operational Plan

## Overview

Retail arbitrage reselling on Carousell Singapore. Products sourced from Shopee Singapore (filtered: Shipped from SG + Next Day Delivery), resold on Carousell with a markup. The system is designed to be nearly fully autonomous — Quinn monitors via alerts and dashboards rather than manually managing daily operations.

**Pricing formula:** `CEILING(MAX(cost × 1.5, cost + 20), 5)`
**Example:** $12 cost → MAX($18, $32) = $32 → rounded to $35

---

## Account Strategy

### Business Gmail
A dedicated Gmail account separate from Quinn's personal email.
- Carousell account registered to this email
- All Google Sheets, Drive, Apps Script owned by this account
- 2FA codes and Carousell notifications go here only
- Acts as a firewall — if Carousell bans the account, personal life is unaffected

### Existing 1,200 Listings Audit
Quinn has ~1,200 existing listings on Carousell, some good and some needing fixing. These must be audited and corrected before full operations begin.

**Audit process:**
1. Export or manually review all active listings
2. Check each listing against the QC checklist (title length, description quality, correct category, price alignment with formula)
3. Fix or delist bad listings before researcher/lister VAs go live — bad listings undermine account health and trust score
4. Prioritise fixing any listings with wrong pricing first (revenue impact)
5. Aim to complete audit in Phase 1 before any new listings go live

---

## Team Structure

### Research VAs (part-time, 8–10 to start, scalable to 30+)
- Coded RVA001, RVA002, etc.
- Each has a **custom daily target** set in the Config tab (default 20/day, adjustable per VA for full-time/part-time)
- Fully isolated — each has their own form URL, Telegram chat, and Google Drive folder
- No VA knows other VAs or listers exist
- Never touch Carousell directly

**Approved categories:** Home Organisation, Beauty Tools, Pet Accessories, Fitness, Kitchen Gadgets, Car Accessories, Bathroom, Phone/Tablet, Travel, Craft/DIY Supplies

### Lister VAs (3 full-time)
- Coded LVA001, LVA002, LVA003
- Target: ~140 listings/day each
- Only people with Carousell login access
- Work from a self-serve queue page — no access to master Google Sheet
- Submit completed listings (Carousell URL + listed price) through queue page
- Can flag bad researcher submissions with a reason

### Owner (Quinn)
- ~15–20 min/day active management (down from 30–60 min)
- Reviews flagged submissions and nightly alert only — no manual daily monitoring
- Handles VA hiring, warnings, and dismissals based on weekly performance summary
- Manually overrides lister assignment only when needed (e.g. lister is sick)

---

## Tech Stack

### Google Sheet — "Carousell Business Master Sheet"

**Submissions tab** (14 columns):
| Column | Field | Notes |
|--------|-------|-------|
| A | Timestamp | Auto |
| B | VA Code | From form |
| C | Product Title | From form |
| D | Product Description | From form |
| E | Shopee Link | From form |
| F | Source Cost | From form |
| G | Drive Folder | From form |
| H | Sell Price | Auto-calculated by Apps Script |
| I | Assigned Lister | Auto-assigned by Apps Script (round-robin) |
| J | Status | Pending / In Progress / Done / Flagged |
| K | Carousell URL | Entered by lister on completion |
| L | Date Posted | Auto on completion |
| M | Notes | Lister flag reason or QC notes |
| N | Listed Price | Entered by lister on completion |
| O | QC Flag | Auto-populated by submission QC checks |

**Config tab** (owner-managed):
| Column | Field |
|--------|-------|
| A | VA Code |
| B | Role (Researcher / Lister) |
| C | Daily Target |
| D | Status (Active / Inactive) |
| E | Rejection Count (auto-incremented) |

**Dashboard tab:** COUNTIFS tracking daily submissions and completions per VA vs their Config target. Green/red status indicators.

**Archive tab:** Auto-populated by weekly script. Stores completed rows older than 7 days.

---

### Google Apps Script (single deployment)

All logic lives in one Apps Script web app. All endpoints use GET to avoid CORS issues with Netlify-hosted pages.

#### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `?action=submit` | GET | Researcher form submission |
| `?action=progress&va=RVA001&date=...` | GET | VA daily submission count |
| `?action=queue&lister=LVA001` | GET | Lister task queue |
| `?action=complete` | GET | Lister marks task done |
| `?action=flag` | GET | Lister flags bad submission |
| `?action=dashboard` | GET | Daily stats for all VAs |

#### Auto-Assignment Logic
On each researcher submission:
1. Read active listers from Config tab
2. Count pending/in-progress tasks per lister in Submissions tab
3. Assign to lister with lowest current workload
4. Write lister code to column I automatically
5. Quinn can manually override column I at any time

#### Submission QC Flags (runs at submission time)
Writes to column O. Flags:
- Title under 20 or over 80 characters
- Description under 100 characters
- Source cost is zero, blank, or non-numeric
- Drive folder link doesn't contain `drive.google.com`
- Shopee URL already exists in Submissions OR Archive tab (duplicate detection)

#### Lister Completion Validation
When lister submits a completed listing:
- Carousell URL must start with `https://www.carousell.sg/` — rejected with error if not
- Listed price must be numeric and greater than zero
- On valid submission: status → Done, Date Posted → today, URL and price written to sheet

#### Rejection Counter
When a lister flags a submission:
- Status → Flagged
- Script increments that RVA's Rejection Count in Config tab
- Included in weekly summary

#### Auto-Archive
- Time trigger: runs every Sunday night
- Moves all "Done" rows older than 7 days to Archive tab
- Clears those rows from Submissions tab

#### Daily Performance Alert
- Time trigger: runs every day at 9pm SGT
- Sends Telegram message (via bot) or email to Quinn containing:
  - Each active RVA: submissions today vs target (✅ or ❌)
  - Any RVA with zero submissions flagged at the top
  - Each active LVA: completions today vs 140 target (✅ or ❌)
  - Any Carousell URL submissions that failed validation

#### Weekly Performance Summary
- Runs every Sunday night alongside auto-archive
- Sends Quinn:
  - Rejection count per RVA for the week
  - RVAs with 3+ rejections highlighted as needing review
  - Total listings posted for the week across all listers

---

### Netlify-Hosted HTML Tools

All files have the Apps Script URL baked in. No editing needed — rename to index.html, put in a folder, drag to app.netlify.com/drop.

| File | Purpose | Who Uses It |
|------|---------|-------------|
| `va-form-RVA001.html` to `RVA030.html` | Individual submission forms, VA code hardcoded | Researcher VAs |
| `va-form-TEMPLATE.html` | Template for new VA codes beyond RVA030 | Owner |
| `va-progress-tracker.html` | Select VA code + date, see submission count vs target | Researcher VAs |
| `lister-queue.html?lister=LVA001` | Self-serve task queue with full submission details | Lister VAs |
| `listing-price-calculator.html` | Enter source cost, get sell price with rule shown | All VAs |
| `researcher-sop.html` | Interactive SOP with copy-paste AI prompts | Researcher VAs |

---

## Researcher VA Workflow

1. Browse Shopee.sg with filters: Shipped from SG + Next Day Delivery
2. Find product in an approved category, check all variants, note highest price as source cost
3. Save 5–10 product images; clean cover image with cleanup.pictures if background is cluttered
4. Create Google Drive folder named `[VA Code] - [Product Name]`, upload images, set sharing to "Anyone with the link"
5. Copy Shopee product description → use AI prompt in SOP to generate Carousell description
6. Use AI prompt in SOP to generate Carousell title from description
7. Submit through personal form: title, description, Shopee link, source cost, Drive folder link
8. Apps Script auto-calculates sell price, assigns lister, and writes to sheet

---

## Lister VA Workflow

1. Open queue page at `lister-queue.html?lister=LVA00X`
2. Click a pending task to expand: title, description, source cost, sell price, margin, Shopee link, Drive folder
3. Review submission quality (title, description, images, price)
4. Download images from Drive folder
5. Post to Carousell using provided title, description, sell price, and images
6. Enter Carousell URL (must be `https://www.carousell.sg/...`) and listed price, click Submit
7. If submission quality is bad, click Flag and describe the issue — this feeds back to Quinn's weekly report

---

## QC Routine (Owner — ~15 min/day)

1. Open Submissions tab, filter by column O (QC Flag) — review flagged rows only
2. Check flagged rows: decide to keep, edit, or mark for researcher to redo
3. Review any lister flags (Status = Flagged) and assess whether to warn the researcher
4. Spot-check 5–10 random "Done" listings on Carousell (price correct? title/description quality? right category?)
5. Read nightly Telegram alert — action any red flags

**Weekly (Sunday, ~20 min):**
1. Review weekly performance summary
2. Message any RVA with 3+ rejections with specific feedback
3. Message any RVA or LVA who missed target 3+ days that week
4. Update Config tab if any VA statuses change (inactive, new hire, target change)

---

## Hiring & Onboarding

### Researcher VA Hiring Process
1. Post job listing (Telegram groups, freelance platforms)
2. Send shortlisted candidates the Paid Trial Task (5-product screening assignment)
3. Score using the Paid Trial Scoring Sheet — auto-calculates pass/fail
4. If pass: assign next available RVA code from Config tab, set status to Active
5. Send canned Telegram onboarding message with their form link, SOP link, calculator link, and Drive folder link
6. Pre-deployed RVA forms (RVA001–RVA030) mean zero deployment time per hire

### Canned Onboarding Message Template (Researcher)
```
Hi [Name]! Welcome aboard 👋

Here are your links — save them:

📋 Your submission form: [RVA00X form URL]
📖 How to do the job (read this first): [SOP URL]
💰 Price calculator: [calculator URL]

Your daily target is [X] products. Submit by end of day.
I'll message you here if I have any feedback.

Any questions, ask me here. Good luck!
```

### Lister VA Hiring Process
1. Post job listing specifying Carousell experience preferred
2. Trial period: 2 days supervised (Quinn spot-checks every listing)
3. If satisfactory: add to Config tab as Active, share queue URL and Carousell credentials via Telegram
4. Credentials shared via Telegram only — never email or form

---

## Account Safety Rules

- Listers are the **only** people with Carousell login access
- Credentials shared via Telegram only, never written in any sheet or doc
- Carousell account registered to business Gmail, not personal
- 2FA enabled on Carousell account; codes go to business Gmail only
- If account is flagged or banned: immediately revoke lister access, investigate, create new account on business Gmail if needed
- No VA ever knows another VA's identity or contact

---

## Existing Listings (1,200 Audit Plan)

Before going live with the new system, Quinn must audit and resolve all existing listings:

**Priority order:**
1. **Wrong price** — recalculate using formula and relist or edit immediately
2. **Wrong category** — fix in Carousell listing editor
3. **Bad title** — too short, keyword-stuffed, or unclear; rewrite using AI prompt
4. **Bad description** — too short or copied verbatim from Shopee; rewrite
5. **Missing or poor images** — delist if unfixable, or source new images
6. **Discontinued / out of stock on Shopee** — delist

Target: audit complete before listers start posting new listings. Mixing audited and unaudited stock creates confusion in QC.

---

## Scaling Plan

| Stage | Researchers | Daily Submissions | Daily Listings |
|-------|-------------|-------------------|----------------|
| Launch | 8–10 RVAs | 160–200/day | ~140/day (1 lister) |
| Growth | 15–20 RVAs | 300–400/day | ~280/day (2 listers) |
| Scale | 25–30 RVAs | 500–600/day | ~420/day (3 listers) |

Lister capacity is the bottleneck — add listers before adding researchers beyond what existing listers can process. Each lister handles ~140 listings/day. If the submission queue exceeds 2 days of lister capacity, pause researcher hiring until the queue clears.

---

## Daily Time Budget (Target)

| Task | Time |
|------|------|
| Review QC-flagged submissions | 5 min |
| Handle lister flags or URL rejections | 5 min |
| Read nightly Telegram alert | 2 min |
| Ad hoc VA messages | 5 min |
| **Total** | **~15–20 min/day** |

Weekly addition: ~20 min Sunday for performance review and Config updates.
