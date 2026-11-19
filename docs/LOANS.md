# Personal loans

Money the fund lends to its members, repaid month by month. This page describes the lifecycle, the maths, the **lending policy** (new in 2.9.0), how loans reach the books, and what is not built yet.

- [1. Lifecycle](#1-lifecycle)
- [2. Interest methods and the schedule](#2-interest-methods-and-the-schedule)
- [3. Lending policy](#3-lending-policy)
- [4. Exceptions: who approves, and where it is recorded](#4-exceptions-who-approves-and-where-it-is-recorded)
- [5. Repayments, closure, write-off](#5-repayments-closure-write-off)
- [6. Deleting: reasons and limits](#6-deleting-reasons-and-limits)
- [7. How a loan reaches the books](#7-how-a-loan-reaches-the-books)
- [8. Portfolio quality](#8-portfolio-quality)
- [9. Permissions](#9-permissions)
- [10. Not built yet](#10-not-built-yet)
- [11. Tests](#11-tests)

---

## 1. Lifecycle

```
Draft (application)  ->  signed consent paper uploaded  ->  Disbursed (Active)  ->  Closed
                                                                     |
                                                                     +->  Overdue (derived)  ->  Written off
```

1. **Application (draft).** With *Require a signed consent paper* on (the default), a new loan is saved as a **draft** that moves **no money**. The consent paper is generated (English / Bangla, printable), signed by the borrower and the guarantor, and **uploaded** (PDF or image; its SHA-256 is stored).
2. **Disbursement.** Once the paper is uploaded, the draft is disbursed: the loan, its schedule and the cash movement are created **in one transaction**. What is disbursed must equal what was printed on the paper; changing the terms removes the uploaded paper, and it must be signed again.
3. **Without the requirement** (switched off in *Loan policy*), a loan is disbursed as soon as it is saved and is marked consent **Waived**.
4. **Repayments** are recorded as they come in; a loan with no installment left to pay becomes **Closed**.

Loan numbers (`PL-0001`) and draft numbers (`LA-0001`) are never reused, even after a deletion.

**Guarantor.** Every loan needs a guarantor: a **fund member** (active, not the borrower) or an **outsider** (full name, full address, valid National ID, optional phone; an NID that belongs to a member is refused so they are chosen as a member instead).

## 2. Interest methods and the schedule

Computed by pure functions in [electron/loans.ts](../electron/loans.ts), shared by the form's live preview and by the booking, so they cannot disagree.

| Method | Meaning |
|---|---|
| **Reducing balance** | Equal monthly installment (EMI) on the reducing balance: `EMI = P·r / (1 − (1+r)^−n)`, `r = annual% / 12 / 100`. Each month: interest = balance × r, the rest repays principal. |
| **Flat rate** | Interest = `P × annual% × n/12`, spread evenly; principal repaid evenly. The form shows the real cost: a flat 10 % is about 17.8 % a year on the reducing balance. |
| **Interest-free** (Qard-e-Hasan) | `P / n` a month, no interest. |

Rules: the installment is rounded to a whole taka; **the last installment absorbs the rounding**, so `Σ principal = loan amount` and `Σ installments = Σ principal + Σ interest` **exactly**. Due dates fall on the same day each month and are month-end and leap-year safe. A loan date cannot be in the future or before the member joined; the first installment must be after the loan date and within about three months of it. Rate 0–100 %, term 1–120 months.

## 3. Lending policy

Set in **Personal Loans → Loan policy**. These rules are **checked every time a loan is saved** (as a draft and again at disbursement). A value of `0` means "not checked".

| Setting | Default | Rule |
|---|---|---|
| Open loans per member (`loan_max_active`) | **1** | A member may not have more open loans than this |
| No new loan while overdue (`loan_block_overdue`) | **on** | A member with an overdue loan cannot borrow again |
| No new loan after a write-off (`loan_block_written_off`) | **on** | A member who has had a loan written off cannot borrow again |
| Minimum months of membership (`loan_min_member_months`) | 0 | Months between joining and the loan date |
| Most unpaid contribution months (`loan_max_arrears_months`) | 0 | Unpaid months whose due date has passed |
| One loan at most % of the fund (`loan_max_pct_of_fund`) | 0 | Principal against the fund balance at cost |
| Cash that must stay in hand (`loan_cash_reserve`) | 0 | Cash left after the loan must stay at or above this |
| Open loans one member may guarantee (`loan_guarantor_max`) | **2** | Refused outright when the chosen guarantor is at the limit |
| Loan limit × member's savings (`loan_max_multiple`) | 0 | Above the limit a written approval reason is required (any user) |
| Default interest rate / method, suggested penalty | 12 % / reducing / 0 | Pre-fills new loans; the penalty is only a suggestion |

Always enforced, whatever the settings: the member is **Active**, and the fund has the **cash**: a loan may not exceed the lower of the cash in hand on the loan date and today.

## 4. Exceptions: who approves, and where it is recorded

When a loan breaks one or more policy rules:

1. The loan form shows each reason (*"Loan policy: …"*).
2. **An Admin** (or `iqbal_labs`) must type an **approval reason** (at least 5 characters) to go on. For anyone else the loan **cannot be saved**: *"Only an Admin can approve an exception."*
3. The reason is kept: on the loan's notes (*"Policy exception approved by …: <rules broken> Reason: …"*), and an exception approved on a **draft** travels with the draft to the disbursement.

The guarantor limit, the member being active and the cash check are **not** exceptions: they stop the loan.

## 5. Repayments, closure, write-off

- **Installment** payments are applied to the schedule in order, split into principal, interest and (optional) **penalty**. Over-payment is refused. A late fee is suggested from the policy and can be changed.
- **Closure** settles the loan early: the remaining principal plus the interest of the installments already due (less interest already paid). Interest for the days elapsed since the last due date is **not** charged, and a closure note is needed to change the interest.
- **Write-off** (Admin): the unpaid principal becomes a loss shared by the members; the **borrower's own savings absorb it first**, and only what they cannot cover is shared by the others. *Cancel write-off* (Admin) reverses it. Repayments on a written-off loan are refused until it is cancelled.
- A member with a live loan, or who guarantees one, **cannot be settled** (paid out).

## 6. Deleting: reasons and limits

| Action | Who | Needs | Refused when |
|---|---|---|---|
| Delete a loan | **Admin** only | a reason (at least 5 characters) | it has repayments (remove them first, latest first) or it was written off |
| Remove a repayment | users with Loans edit | a reason (at least 5 characters) | it is not the latest repayment, the loan is written off, the borrower has been settled, a settlement came after an interest payment, or removing it would make the fund's **cash negative** |
| Delete a draft | users with Loans edit | none | it has been disbursed |

The reason is written to the **activity log**. Deleting a loan that came from a draft makes that draft **wait again** (its signed paper stays attached); it does not leave the draft pointing at a loan that no longer exists.

## 7. How a loan reaches the books

```
lending      cash  -P         loans receivable  +P            (net worth unchanged)
repayment    cash  +(p+i+f)   receivable -p     income +(i+f)
write-off    receivable -outstanding            loss   -outstanding   (cash unchanged)
```

Interest and penalties are income shared with the members as profit; a write-off is a shared loss. Loan penalties appear in the **Fines** register. The accounting health check verifies each schedule's maths, repayment arithmetic, guarantor completeness, consent files, stale drafts and the cash reconciliation.

## 8. Portfolio quality

Shown on the Loans screen when any loan is overdue, and in the loan summary:

- **Overdue by age:** the open principal of overdue loans in **1–30**, **31–60**, **61–90** and **over 90** days, using the age of each loan's oldest unpaid installment.
- **PAR 30 / 60 / 90 (portfolio at risk):** the share of the money still owed that sits in loans more than 30, 60 or 90 days overdue.
- **Defaulters:** the worst overdue loans, with days late, overdue amount, outstanding principal and the **guarantor**.
- Existing figures: total lent, owed, interest earned and still expected, overdue amount, due in the next 30 days, on-time rate, cash available to lend, share of the fund lent out.

## 9. Permissions

Module **Personal loans** (none / view / edit). Treasurer and Manager have *edit* by default; Auditor has *view*. Write-off and cancelling a write-off need the **Admin** role, as do **deleting a loan** and **approving a policy exception**. Auditors are read-only everywhere, enforced in the main process.

## 10. Not built yet

In priority order, from the 2.9.0 review:
1. **Approval workflow:** statuses Submitted / Approved / Rejected / Cancelled, who decided and why, a second approver above an amount (today an application is a draft until disbursed, and rejecting it deletes the draft).
2. **Printables:** repayment receipt, schedule, borrower statement, and a loans section in the member statement (today only the consent paper is printable).
3. **Penalty engine:** grace period, daily or percentage rate, cap, and a waiver record (today the penalty is a manual flat suggestion).
4. **Recovery after write-off:** a *Recovery* receipt booked as income, a *call on guarantor* record, set-off against savings.
5. **Reschedule / restructure, principal-only prepayment, per-day interest on early closure.**
6. More portfolio reports in *Reports & Export*, and guarantor exposure reporting.

## 11. Tests

`npm run test:loans` ([scripts/loan-test.js](../scripts/loan-test.js)): the schedule maths (every method, rounding, month-ends), the books, repayments, closure, write-off and its cancellation, settlement shares, limit override, drafts and the consent lifecycle, the schema upgrades and backup round trip, **the lending policy** (every rule, Admin versus Treasurer, the preview), **deletion with reasons and the cash check**, and **portfolio ageing and PAR**. Two checks about older drafts and the policy section run only with `BONDHU_ADMIN_PASSWORD` / `BONDHU_SYSTEM_PASSWORD` set; see [TESTING.md](TESTING.md).
