# Entry rules: what the program accepts and refuses

Every rule here is enforced in the **main process** ([electron/database.ts](../electron/database.ts)), not just hidden in the screens, so no screen, import or script can bypass it. These rules were tightened in 2.9.0 after 65 bad or odd inputs were fed to every money entry and 32 were wrongly accepted ([AUDIT_2026-11.md](AUDIT_2026-11.md)).

- [1. Amounts](#1-amounts)
- [2. Dates and months](#2-dates-and-months)
- [3. Payments](#3-payments)
- [4. Expenses](#4-expenses)
- [5. Investments and returns](#5-investments-and-returns)
- [6. Members](#6-members)
- [7. Lists from Master Data](#7-lists-from-master-data)
- [8. Text length limits](#8-text-length-limits)
- [9. The two questions the screens ask](#9-the-two-questions-the-screens-ask)
- [10. For developers](#10-for-developers)

---

## 1. Amounts

One checker (`money()`) is used for every amount a person types.

| Input | Result |
|---|---|
| A real number such as `2500`, `"3,000"` | accepted |
| Text (`abc`), empty, `Infinity`, `NaN` | refused: *"… must be a number."* |
| Zero or negative where an amount is required | refused: *"… must be greater than zero."* |
| A late fee below zero | refused: *"Late fee cannot be negative."* (zero is fine) |
| More than **10,000,000,000** | refused: *"… is too large."* |
| More than 2 decimals (`500.555`) | **rounded to the paisa**, then stored |

## 2. Dates and months

| Input | Result |
|---|---|
| A real calendar date: `2026-11-19`, `19/11/2026`, Bangla digits | accepted |
| An **impossible** date (`31/02/2025`, `yesterday`) | **refused**: *"… is not a valid date. Use dd/mm/yyyy."* It used to be silently replaced by today. |
| A **future** payment, expense, purchase or join date | refused: *"… cannot be in the future."* |
| A month such as `2025-13` | not a month: refused everywhere |
| An empty date | the field's default (usually today) |

## 3. Payments

| Rule | Message (shortened) |
|---|---|
| The member must exist and be **Active** | *"…is inactive. Payments can only be recorded for active members."* |
| The month must not be **before the month the member joined** | *"X joined in 2025-03, so a payment cannot be recorded for the earlier month 2025-01."* |
| The month must not be **more than a year ahead** | *"A payment cannot be recorded for …: that is more than a year ahead."* |
| The payment date must not be **before the join date** | *"The payment date is before X joined (…)."* |
| **One payment per member and month.** A second one is refused with `DUPLICATE:` unless the user agrees to **replace** it | see [section 9](#9-the-two-questions-the-screens-ask) |
| The payment method must be one of the active **Payment methods** | [section 7](#7-lists-from-master-data) |
| A settled member's payments cannot be deleted | *"This member has been settled…"* |

A replaced payment is written to the activity log as **replace**, with the old amount and date and the new ones.

## 4. Expenses

Title required (max 200), a category from Master Data, an amount (section 1), a date not in the future (section 2), payee (max 200), receipt reference (max 100), notes (max 2000). An expense **larger than the cash in hand** asks for confirmation ([section 9](#9-the-two-questions-the-screens-ask)).

## 5. Investments and returns

Investment: name required (max 200), a sector from Master Data, invested amount (section 1), estimated value (zero allowed), purchase date not in the future, review date a valid date. An investment **larger than the cash in hand** asks for confirmation. Returns (profit, loss, benefit) must be dated on or after the investment's purchase, not in the future, with a medium (cash, bank, bKash…) and a known type.

## 6. Members

| Field | Rule |
|---|---|
| Name | required, max 200 |
| National ID | required, 10, 13 or 17 digits (Bangla digits and spaces accepted), unique |
| Monthly due | above zero, at most 10 billion |
| Opening balance | not negative |
| Join date | a real date, not in the future |
| Phone | digits only (spaces, `+`, `-`, `(`, `)` and `.` are fine), 5–20 characters |
| Email, designation, notes | max 200, 100, 2000 |

## 7. Lists from Master Data

Payment method, expense category and investment sector must be an **active item** of the matching Master Data list (*Master Data* screen), compared without regard to case. If the owner has emptied a list, that field is free text. Deactivate an item instead of deleting it to stop new entries using it while keeping old records.

## 8. Text length limits

Member name 200 · title 200 · payee 200 · receipt reference 100 · transaction id 100 · note 2000 · location 300 · email 200 · designation 100. A longer text is refused with *"… is too long (at most N characters)."*

## 9. The two questions the screens ask

The main process refuses with a message that starts with a keyword, and the screen turns that into a question and repeats the same call with a flag once the user agrees (`callConfirmed` in [src/services/db.ts](../src/services/db.ts)):

| Message starts with | Question | Flag sent on "yes" |
|---|---|---|
| `DUPLICATE:` | *A payment for 2026-10 is already recorded for X (2,500 on 05/10/2026). Replace the earlier payment with this one? (The earlier amount stays in the activity log.)* | `replace: true` |
| `OVERDRAFT:` | *This expense of 5,000 is more than the cash on hand (1,200). The books will then show negative cash. Record it anyway?* | `allow_overdraft: true` |

Answering **No** changes nothing ("Nothing was changed" / "Nothing was recorded"). Writing negative cash is allowed on purpose, because a fund that is catching up on old records may enter expenses before the collections that paid for them; the accounting health check still reports negative cash.

## 10. For developers

- Helpers live together before `validateMember` in `database.ts`: `money()`, `dateInput()`, `limit()`, `inMaster()`, `guardCash()`, `validateMemberFields()`.
- Anything new that takes money, a date or a list value should use them, and add a case to the entry probe described in [TESTING.md](TESTING.md).
- Tests: `npm run test:db`, `test:audit`, `test:nid`, `test:review`, `test:fuzz` (hundreds of random operations; the books must balance after every step).
- Tests that deliberately spend or invest without funding pass `allow_overdraft: true`; a test that records the same month twice passes `replace: true`.
