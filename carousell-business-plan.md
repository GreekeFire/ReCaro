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
- Submit completed listings (Carousell URL only) through queue page
- Can flag bad researcher submissions with a reason

### Owner (Quinn)
- ~15–20 min/day active management (down from 30–60 min)
- Reviews flagged submissions and nightly alert only — no manual daily monitoring
- Handles VA hiring, warnings, and dismissals based on weekly performance summary
- Manually overrides lister assignment only when needed (e.g. lister is sick)

---

## Tech Stack

### Google Sheet — "Carousell Business Master Sheet"

**Submissions tab** (13 columns):
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
| I | Assigned Lister | Auto-assigned by Apps Script (lowest workload) |
| J | Status | Pending / In Progress / Done / Flagged — auto-set to In Progress when lister opens a task |
| K | Carousell URL | Entered by lister on completion |
| L | Date Posted | Auto on completion |
| M | Notes | Lister flag reason or QC notes |

**Config tab** (owner-managed):
| Column | Field |
|--------|-------|
| A | VA Code |
| B | Role (Researcher / Lister) |
| C | Daily Target |
| D | Status (Active / Inactive) |
| E | Rejection Count (auto-incremented) |

**Dashboard tab:** Script-generated. Apps Script calculates daily submissions and completions per VA vs their Config target, then writes a formatted table with green/red status indicators. Refreshes hourly via time trigger. Sunday is a rest day — all targets show as N/A.

**Archive tab:** Auto-populated by weekly script. Stores completed rows older than 7 days.

---

### Google Apps Script (single deployment)

All logic lives in one Apps Script web app. All endpoints use GET to avoid CORS issues with Netlify-hosted pages.

**Quota note:** Google imposes daily limits on Apps Script — email sends are capped at 100/day on free Gmail. Use a **Google Workspace account** (not free Gmail) for the business Gmail to get higher limits before launch. At 200 submissions/day this limit would otherwise be hit.

**Netlify deployment note:** Each new VA hire requires a manual template duplicate, one constant edit, and a Netlify drag-deploy. Acceptable at current scale. If hiring volume increases significantly, consider scripting this step.

#### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `?action=submit` | GET | Researcher form submission |
| `?action=progress&va=RVA001&date=...` | GET | VA daily submission count |
| `?action=queue&lister=LVA001` | GET | Lister task queue |
| `?action=start` | GET | Lister opens a task — auto-sets status to In Progress |
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

**No active listers:** If no active listers exist in Config, the submission is hard-rejected with the error "No active listers available — contact Quinn." Nothing is written to the sheet. Quinn receives an immediate email alert.

#### Submission QC (runs at submission time)
Hard-reject — bad submissions are never written to the sheet. Checks:
- Title under 190 or over 225 characters
- Description under 100 characters
- Source cost is zero, blank, or non-numeric
- Shopee URL does not start with `https://shopee.sg/`
- Drive folder link doesn't contain `drive.google.com`
- Shopee URL already exists in Submissions OR Archive tab (duplicate detection)

#### Lister Completion Validation
When lister submits a completed listing:
- Lister code validated against Config tab — inactive or unknown codes are rejected
- Carousell URL must start with `https://www.carousell.sg/` — rejected with error if not
- On valid submission: status → Done, Date Posted → today, URL written to sheet
- Listed price is not stored — listers are expected to list at the provided sell price or they are replaced

#### Rejection Counter
When a lister flags a submission:
- Status → Flagged
- Script increments that RVA's Rejection Count in Config tab
- Included in weekly summary

#### Rebalancer Scope
The rebalancer (triggered when a lister's Config status changes, or run manually) only redistributes **Pending** tasks. Tasks already set to **In Progress** are never reassigned — the lister currently working on them keeps them until Done or manually overridden by Quinn.

#### Auto-Archive
- Time trigger: runs every Sunday night
- Moves all "Done" rows older than 7 days to Archive tab
- Clears those rows from Submissions tab

#### Mid-Day Lister Alert
- Time trigger: runs every weekday at 2pm SGT (skips Sunday)
- Sends email to Quinn if any active lister has completed fewer than 25% of their assigned pending queue by 2pm
- Purpose: early warning to intervene before end of day if a lister is inactive, slow, or absent

#### Daily Performance Alert
- Time trigger: runs every day at 9pm SGT (skips Sunday)
- Sends email to Quinn containing:
  - Each active RVA: submissions today vs target (✅ or ❌)
  - Any RVA with zero submissions flagged at the top
  - Each active LVA: completions today vs assigned pending queue (✅ or ❌)
  - Any lister with pending tasks but under 25% completion flagged at the top
  - Total pending queue depth + days of capacity remaining at current lister count
  - Queue overflow warning if pending queue exceeds 2× daily lister capacity
  - Any Carousell URL submissions that failed validation
  - Summary of all new Flagged submissions today: VA code, lister who flagged, and reason — eliminates need to open the sheet for routine flag reviews
  - 5 random Carousell URLs from today's completed listings for spot-checking

#### Weekly Performance Summary
- Runs every Sunday night alongside auto-archive
- Sends Quinn:
  - Rejection count and rejection rate (%) per RVA for the week — rate only shown if RVA has 10+ submissions that week to avoid false alarms from low volume
  - RVAs with 3+ rejections or rejection rate above 15% (min 10 submissions) highlighted as needing review
  - RVAs with zero submissions for 3+ days flagged with a suggested action (warn or deactivate)
  - Total completions per LVA for the week with daily average
  - Total listings posted for the week across all listers

---

### Netlify-Hosted HTML Tools

All files reference a shared `SCRIPT_URL` constant. To deploy any file: update `SCRIPT_URL` if redeploying Apps Script, rename to `index.html`, put in a folder, drag to app.netlify.com/drop. For VA forms, also update `VA_CODE` before deploying.

| File | Purpose | Who Uses It |
|------|---------|-------------|
| `va-form-TEMPLATE.html` | Template — duplicate, set `VA_CODE`, deploy per hire | Owner / Researcher VAs |
| `lister-queue-TEMPLATE.html` | Template — duplicate, set `LISTER_CODE`, deploy per lister | Owner / Lister VAs |
| `listing-price-calculator.html` | Enter source cost, get sell price with rule shown | All VAs |
| `owner-dashboard.html` | Live queue depth, VA status, capacity overview — Quinn only. Deploy to a non-guessable Netlify URL and do not share. | Owner |
| `researcher-sop.html` | Interactive SOP with copy-paste AI prompts | Researcher VAs |
| `lister-sop.html` | Interactive SOP for lister workflow | Lister VAs |
| `trial-researcher.html` | 5-product paid trial submission form for researcher candidates | Candidates |
| `trial-lister.html` | 3-listing paid trial submission form for lister candidates | Candidates |

**Note:** VA forms include a live daily progress tracker (submissions today vs target) — no separate progress tool needed. VA forms and lister queue pages are created on demand per hire, not pre-deployed. All HTML files share a single `SCRIPT_URL` constant — update one value to redeploy.

---

## Researcher VA Workflow

1. Browse Shopee.sg with filters: Shipped from SG + Next Day Delivery
2. Find product in an approved category, check all variants, note highest price as source cost
3. Save 5–10 product images; clean cover image with cleanup.pictures if it has a watermark, brand logo, or promotional text visible
4. Create Google Drive folder named `[VA Code] - [Product Name]`, upload images, set sharing to "Anyone with the link"
5. Copy Shopee product description → use AI prompt in SOP to generate Carousell description
6. Use AI prompt in SOP to generate Carousell title from description
7. Submit through personal form: title, description, Shopee link, source cost, Drive folder link
8. Apps Script auto-calculates sell price, assigns lister, and writes to sheet

---

## Lister VA Workflow

1. Open your personal queue page (URL provided during onboarding)
2. Click a pending task to expand: title, description, source cost, sell price, margin, Shopee link, Drive folder
3. Review submission quality (title, description, images, price)
4. Download images from Drive folder
5. Post to Carousell using provided title, description, sell price, and images
6. Enter Carousell URL (must be `https://www.carousell.sg/...`) and click Submit
7. If submission quality is bad, click Flag and describe the issue — this feeds back to Quinn's weekly report

---

## QC Routine (Owner — ~15 min/day)

1. Read nightly email alert — flagged submissions and spot-check URLs are included, no need to open the sheet for routine reviews
2. For each flagged submission in the email, decide one of three outcomes:
   - **Void** — researcher must redo it; set Status back to Pending and reassign manually
   - **Override** — acceptable despite flag; set Status back to Pending so lister can complete it
   - **Delete** — permanently remove the row from the sheet
3. Spot-check the 5 random Carousell URLs included in the email. If a URL returns 404, note the row in the sheet for review (listing was removed by Carousell)
4. Action any red flags from the alert (queue overflow, lister inactivity, URL failures)

**Weekly (Sunday, ~20 min):**
1. Review weekly performance summary
2. Message any RVA with 3+ rejections with specific feedback
3. Message any RVA or LVA who missed target 3+ days that week
4. Update Config tab if any VA statuses change (inactive, new hire, target change)

---

## Hiring & Onboarding

### Researcher VA Hiring Process
1. Post job listing (Telegram groups, freelance platforms)
2. Create a trial code for the candidate (format: `TRIAL-[initials]-[DDMM]`, e.g. `TRIAL-JS-2804`), send it to them along with the `trial-researcher.html` URL
3. Trial submissions older than 7 days from the code issue date are considered expired — do not review them
4. Review submissions in the ResearcherTrials tab — score manually (0–10 per product). **Pass = average ≥ 7/10 across all 5 products, with no single product below 5/10**
5. If pass: assign next available RVA code from Config tab, set status to Active
6. Create their VA form from `va-form-TEMPLATE.html` — update `VA_CODE` at the top, deploy to Netlify
7. Send canned Telegram onboarding message with their form URL, SOP link, and calculator link

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

### Canned Warning Messages

**RVA — Too many rejections:**
```
Hi [Name], your submissions have been flagged [X] times this week.

Issues found: [list specific reasons from flags]

Please re-read the SOP before submitting again: [SOP URL]
If this continues, I will have to let you go.
```

**RVA — Missing submissions:**
```
Hi [Name], I haven't seen any submissions from you for [X] days.

Your daily target is [X] products. Are you still available?
Please reply today or I will assume you are no longer working with us.
```

**LVA — Slow completions:**
```
Hi [Name], your listing count has been lower than expected this week.

Please let me know if there's an issue. Consistent underperformance will affect your continued engagement.
```

### Lister VA Hiring Process
1. Post job listing specifying Carousell experience preferred
2. Create a trial code for the candidate (format: `TRIAL-[initials]-[DDMM]`), send it to them along with the `trial-lister.html` URL. Give them 3 specific products to list (title, sell price, images) on their own Carousell account
3. Trial submissions older than 7 days from the code issue date are considered expired
4. Review submissions in the ListerTrials tab — check URL validity, title accuracy, and price accuracy. **Pass = all 3 listings posted correctly with valid URLs, correct titles, and correct prices**
5. During a 2-day supervised period, have the lister use the actual Carousell account. Ask them to send each Carousell URL via Telegram immediately after posting so Quinn can spot-check in real time
6. If satisfactory: create their queue page from `lister-queue-TEMPLATE.html` — update `LISTER_CODE`, deploy to Netlify
7. Add to Config tab as Active, share queue URL and Carousell credentials via Telegram only — never email or form

**Note on trial deduplication:** If a candidate submits the trial form more than once with the same trial code, both entries land in the sheet unflagged. Check for duplicate trial codes during review.

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

Manual pre-launch task. Must be complete before listers go live — mixing audited and unaudited stock creates QC confusion.

Fix in this order: wrong price first (revenue impact), then wrong category, bad title, bad description, missing images, discontinued/OOS products. Delist anything that can't be fixed cleanly.

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

| Task | Time | When |
|------|------|------|
| Check mid-day lister alert email | 2 min | 2pm |
| Read nightly email alert + spot-checks | 5 min | 9pm |
| Action flagged submissions and red flags | 5 min | 9pm |
| Ad hoc VA messages | 5 min | Any time |
| **Total** | **~15–20 min/day** | |

Weekly addition: ~20 min Sunday for performance review, warning messages, and Config updates.
