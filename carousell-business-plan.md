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

### Research VAs (up to 7 at launch, scalable to 30+)
- Coded RVA001, RVA002, etc.
- Each has a **custom daily target** set in the Config tab (default 20/day, adjustable per VA for full-time/part-time)
- Fully isolated — each has their own form URL, Telegram chat, and Google Drive folder
- No VA knows other VAs or listers exist
- Never touch Carousell directly
- Submission form does not display the calculated sell price on confirmation — researchers only see the source cost they enter

**Approved categories:** Home Organisation, Beauty Tools, Pet Accessories, Fitness, Kitchen Gadgets, Car Accessories, Bathroom, Phone/Tablet, Travel, Craft/DIY Supplies

### Lister VAs (3 full-time)
- Coded LVA001, LVA002, LVA003
- Target: ~140 listings/day each
- Only people with Carousell login access
- Work from a self-serve queue page — no access to master Google Sheet
- Must fix any quality issues in a submission themselves before posting (e.g. source images from the Drive link, clean cover image with cleanup.pictures)
- Submit completed listings (Carousell URL only) through queue page
- Must flag any submission that required fixing, with a specific reason — flags increment the researcher's rejection count and are used by Quinn to track quality and make firing decisions

### Owner (Quinn)
- ~15–20 min/day active management
- Reviews nightly email alert only — no manual daily monitoring of individual submissions
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
| J | Status | Pending / Done |
| K | Carousell URL | Entered by lister on completion |
| L | Date Posted | Auto on completion |
| M | Notes | Lister flag reason (if any) |

**Config tab** (owner-managed):
| Column | Field |
|--------|-------|
| A | VA Code |
| B | Role (Researcher / Lister) |
| C | Daily Target |
| D | Status (Active / Inactive) |
| E | Rejection Count (auto-incremented) |
| F | Contact (Telegram handle) |

A `Rest Day` cell in the Config tab controls which day of the week all time-based triggers skip. Default: Sunday. All scripts read this value rather than hardcoding the rest day — changing it propagates to all triggers automatically.

**ResearcherTrials tab:** Stores all researcher trial submissions for manual scoring. Columns: trial code, timestamp, product titles, Shopee links, Drive folders, score per product (0–10), average score, pass/fail. Trial expiry is enforced at form submission time using a Trials config range that maps each trial code to its issue date — submissions are hard-rejected if the code is more than 7 days old.

**ListerTrials tab:** Stores all lister trial submissions. Columns: trial code, timestamp, Carousell URLs submitted, pass/fail. Same 7-day expiry enforcement applies.

**Archive tab:** Auto-populated by nightly script. Stores Done rows older than 24 hours. Runs every night (skips rest day).

---

### Google Apps Script (single deployment)

All logic lives in one Apps Script web app. All endpoints use GET to avoid CORS issues with Netlify-hosted pages.

**Account note:** Use a **Google Workspace account** (not free Gmail) for the business Gmail. Workspace gives a professional email address, better Drive storage, and higher Apps Script quotas — though at current scale (2 alert emails per day to Quinn) the free Gmail quota is not the concern.

**Netlify deployment note:** Each new VA hire requires a manual template duplicate, one constant edit, and a Netlify drag-deploy (app.netlify.com/drop). A deployment shell script can optionally automate this: given a VA code as input, it copies the correct template, updates the constant, and deploys via `netlify deploy` CLI — reducing each new hire to a single command. The shell script is not required at launch; manual drag-deploy is acceptable for up to 10 hires.

#### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `?action=submit` | GET | Researcher form submission |
| `?action=progress&va=RVA001&date=...` | GET | VA daily submission count |
| `?action=queue&lister=LVA001` | GET | Lister task queue |
| `?action=complete` | GET | Lister marks task done — sets Status to Done, writes Date Posted and Carousell URL |
| `?action=flag` | GET | Lister flags a bad submission — increments that RVA's Rejection Count in Config, writes reason to Notes column. Does not change task status; lister must still fix and complete the listing. |
| `?action=dashboard` | GET | Live queue depth, VA status counts, and capacity overview for owner dashboard |

#### Auto-Assignment Logic
On each researcher submission:
1. Read active listers from Config tab
2. Count pending tasks per lister in Submissions tab
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
- Script increments that RVA's Rejection Count in Config tab (column E) — cumulative running total
- Flag reason written to Notes column (M) of the flagged row
- Task status is not changed — lister must still fix and complete the listing
- Weekly summary computes weekly rejection count by counting flagged rows in Submissions/Archive for the past 7 days (not by reading column E directly, which is a lifetime total)
- Rejection counts are used by Quinn in the weekly summary to identify underperforming researchers for warnings or dismissal

#### Rebalancer Scope
The rebalancer (triggered when a lister's Config status changes, or run manually) only redistributes **Pending** tasks. Done tasks are never touched.

#### Auto-Archive
- Time trigger: runs every night
- Moves all "Done" rows older than 24 hours to Archive tab
- Clears those rows from Submissions tab
- Skips rest day (reads `Rest Day` cell from Config tab)

#### Mid-Day Lister Alert
- Time trigger: runs every weekday at 2pm SGT (skips rest day)
- Sends email to Quinn if any active lister has completed fewer than 25% of their assigned pending queue by 2pm
- Purpose: early warning to intervene before end of day if a lister is inactive, slow, or absent

#### Daily Performance Alert
- Time trigger: runs every day at 9pm SGT (skips rest day)
- Sends email to Quinn containing:
  - Each active RVA: submissions today vs target (✅ or ❌)
  - Any RVA with zero submissions flagged at the top
  - Each active LVA: completions today vs assigned pending queue (✅ or ❌)
  - Any lister with pending tasks but under 25% completion flagged at the top
  - Total pending queue depth + days of capacity remaining at current lister count
  - Queue overflow warning if pending queue exceeds 2× daily lister capacity
  - Any Carousell URL submissions that failed format validation
  - Summary of all new flags raised today: researcher VA code, lister who flagged, and reason — for quality tracking reference only, no action required on individual submissions
  - Spot-check Carousell URLs from today's completed listings — weighted: at least 1 URL per active lister, with additional draws from listers in their first 14 days or with recent flags (5 URLs total)

#### Weekly Performance Summary
- Runs every Saturday evening
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
| `listing-price-calculator.html` | Enter source cost, get sell price with rule shown | Owner only |
| `owner-dashboard.html` | Live queue depth, VA status, capacity overview — Quinn only. Deploy to a non-guessable Netlify URL and do not share. | Owner |
| `trial-researcher.html` | 5-product paid trial submission form for researcher candidates | Candidates |
| `trial-lister.html` | 3-listing paid trial submission form for lister candidates | Candidates |

**SOPs are maintained as Google Docs or Notion pages** owned by the business Gmail. Links are shared with VAs during onboarding. Maintaining SOPs as documents rather than Netlify HTML files means content updates are instant with no deploy step. The researcher SOP includes AI prompt templates for generating titles and descriptions. VA forms include a live daily progress tracker (submissions today vs target) — no separate progress tool needed. VA forms and lister queue pages are created on demand per hire, not pre-deployed. All HTML files share a single `SCRIPT_URL` constant — update one value to redeploy.

---

## Researcher VA Workflow

1. Browse Shopee.sg with filters: Shipped from SG + Next Day Delivery
2. Find product in an approved category, check all variants, note highest price as source cost
3. Save 5–10 product images; clean cover image with cleanup.pictures if it has a watermark, brand logo, or promotional text visible
4. Create Google Drive folder named `[VA Code] - [Product Name]`, upload images, set sharing to "Anyone with the link"
5. Copy Shopee product description → use AI prompt in SOP to generate Carousell description
6. Use AI prompt in SOP to generate Carousell title from description
7. Submit through personal form: title, description, Shopee link, source cost, Drive folder link

---

## Lister VA Workflow

1. Open your personal queue page (URL provided during onboarding)
2. Click a pending task to expand: title, description, sell price, Shopee link, Drive folder
3. Review submission quality (title, description, images, price)
4. Download images from Drive folder
5. If submission quality has issues (missing or unclean images, weak description): fix it yourself — source images from the Drive link, clean the cover image with cleanup.pictures, or improve the description as needed
6. Post to Carousell using the provided title, description, sell price, and images
7. Enter Carousell URL (must be `https://www.carousell.sg/...`) and click Submit
8. If you had to fix any quality issue: also flag the submission with a specific reason describing what was wrong — this feeds into Quinn's researcher quality tracking

---

## QC Routine (Owner — ~15 min/day)

1. Read nightly email alert
2. Review the flag summary in the email — for researcher quality awareness only, no action needed on individual submissions (listers have already fixed and posted them)
3. Spot-check the weighted Carousell URL sample included in the email
4. Action any operational red flags: queue overflow, lister inactivity, URL format failures
5. If a queue overflow warning is present: follow the Queue Overflow Response procedure

**Weekly (Saturday evening, ~20 min):**
1. Review weekly performance summary email
2. Message any RVA with 3+ rejections with specific feedback (use canned warning template)
3. Message any RVA or LVA who missed target 3+ days that week
4. Update Config tab if any VA statuses change (inactive, new hire, target change)

---

## Queue Overflow Response

Triggered when the pending queue exceeds 2× daily lister capacity (flagged in nightly email).

1. Message all active researchers via Telegram to pause submissions for 24 hours
2. Monitor the following night's alert — if queue is still growing, extend the pause
3. If queue remains critical for 3+ consecutive days: activate a backup lister if available, or begin lister hiring immediately
4. Resume researcher submissions only once queue drops below 1× daily lister capacity
5. If a queue overflow coincides with a lister absence, treat it as critical from day one — skip step 2 and move immediately to step 3

---

## Hiring & Onboarding

### Researcher VA Hiring Process
1. Post job listing (Telegram groups, freelance platforms)
2. Create a trial code for the candidate (format: `TRIAL-[initials]-[DDMM]`, e.g. `TRIAL-JS-2804`), send it to them along with the `trial-researcher.html` URL
3. Trial submissions older than 7 days from the code issue date are hard-rejected automatically by the form — the form checks the issue date at submission time against a Trials config range in the sheet. Expired submissions are never written to the tab.
4. Review submissions in the ResearcherTrials tab — score manually (0–10 per product). **Pass = average ≥ 7/10 across all 5 products, with no single product below 5/10**
5. If pass: assign next available RVA code from Config tab, set status to Active
6. Create their VA form from `va-form-TEMPLATE.html` — update `VA_CODE` at the top, deploy to Netlify (or run the deployment shell script)
7. Send canned Telegram onboarding message with their form URL and SOP link

### Canned Onboarding Message Template (Researcher)
```
Hi [Name]! Welcome aboard 👋

Here are your links — save them:

📋 Your submission form: [RVA00X form URL]
📖 How to do the job (read this first): [SOP URL]

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
3. Trial submissions older than 7 days from the code issue date are hard-rejected automatically by the form
4. Review submissions in the ListerTrials tab — check URL validity, title accuracy, and price accuracy. **Pass = all 3 listings posted correctly with valid URLs, correct titles, and correct prices**
5. During a 2-day supervised period, have the lister use the actual Carousell account. Ask them to send each Carousell URL via Telegram immediately after posting so Quinn can spot-check in real time
6. If satisfactory: create their queue page from `lister-queue-TEMPLATE.html` — update `LISTER_CODE`, deploy to Netlify (or run the deployment shell script)
7. Add to Config tab as Active, share queue URL and Carousell credentials via Telegram only — never email or form

**Note on trial deduplication:** Duplicate submissions using the same trial code and the same Shopee URL (researcher) or Carousell URL (lister) are auto-rejected at submission time. Candidates who submit different products with the same trial code will land additional entries in the tab — check for this during manual review.

---

## Account Safety Rules

- Listers are the **only** people with Carousell login access
- Credentials shared via Telegram only, never written in any sheet or doc
- Carousell account registered to business Gmail, not personal
- 2FA enabled on Carousell account; codes go to business Gmail only
- If account is flagged or banned: immediately revoke lister access, investigate, create new account on business Gmail if needed
- No VA ever knows another VA's identity or contact

### Lister Offboarding Checklist
When a lister is dismissed or leaves, complete these steps immediately and in this order:

1. Change the Carousell account password
2. Send the new password to all remaining active listers via Telegram
3. Set the departing lister's Config status to Inactive
4. Trigger the rebalancer to redistribute their Pending tasks to active listers
5. Confirm no active sessions remain on the Carousell account (check active sessions in account settings)
6. Do not inform the departing lister in advance — change credentials before or simultaneously with the dismissal message

---

## Existing Listings (1,200 Audit Plan)

Manual pre-launch task. Must be complete before listers go live — mixing audited and unaudited stock creates QC confusion.

Fix in this order: wrong price first (revenue impact), then wrong category, bad title, bad description, missing images, discontinued/OOS products. Delist anything that can't be fixed cleanly.

---

## Scaling Plan

| Stage | Researchers | Daily Submissions | Daily Listings |
|-------|-------------|-------------------|----------------|
| Launch | Up to 7 RVAs | ~140/day | ~140/day (1 lister) |
| Growth | 15–20 RVAs | 300–400/day | ~280/day (2 listers) |
| Scale | 25–30 RVAs | 500–600/day | ~420/day (3 listers) |

Lister capacity is the bottleneck — add listers before adding researchers beyond what existing listers can process. Each lister handles ~140 listings/day. If the submission queue exceeds 2 days of lister capacity, pause researcher hiring until the queue clears.

---

## Daily Time Budget (Target)

| Task | Time | When |
|------|------|------|
| Check mid-day lister alert email | 2 min | 2pm |
| Read nightly email alert + spot-checks | 5 min | 9pm |
| Action red flags (queue overflow, lister inactivity) | 5 min | 9pm |
| Ad hoc VA messages | 5 min | Any time |
| **Total** | **~15–20 min/day** | |

Weekly addition: ~20 min Saturday evening for performance review, warning messages, and Config updates.
