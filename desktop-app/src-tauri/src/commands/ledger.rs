use super::shared::*;
pub(super) fn parse_entry(c: &Connection, f: &Value) -> R<Value> {
    let kind = text(f, "kind", 200)?;
    if !["income", "expense", "transfer"].contains(&kind.as_str()) {
        return Err("Invalid transaction type.".into());
    }
    let wallet = text(f, "wallet_id", 200)?;
    let w = record(c, "wallets", &wallet)?;
    let id = field(f, "id");
    let old = if id.is_empty() {
        Value::Null
    } else {
        record(c, "entries", id)?
    };
    if w["archived"] == 1 && old["wallet_id"] != wallet {
        return Err("Choose an active account.".into());
    }
    let dest = if kind == "transfer" {
        let d = text(f, "destination_id", 200)?;
        let w = record(c, "wallets", &d)?;
        if w["archived"] == 1 && old["destination_id"] != d {
            return Err("Choose an active destination.".into());
        }
        if d == wallet {
            return Err("Transfer accounts must be different.".into());
        }
        Some(d)
    } else {
        None
    };
    let cat = if kind == "transfer" {
        "Transfer".into()
    } else {
        let s = text(f, "category", 80)?;
        category(c, &kind, &s)?;
        s
    };
    let notes = field(f, "notes").trim();
    if notes.encode_utf16().count() > 2000 {
        return Err("Notes are limited to 2,000 characters.".into());
    }
    let d = text(f, "date", 200)?;
    date(&d)?;
    Ok(
        json!({"id":if id.is_empty(){uid()}else{id.to_string()},"kind":kind,"date":d,"description":text(f,"description",200)?,"amount":positive(f)?,"walletId":wallet,"destinationId":dest,"category":cat,"notes":notes}),
    )
}
pub(super) fn write_entry(c: &Connection, v: &Value, update: bool) -> R<()> {
    let dest = v["destinationId"].as_str();
    let p = params![
        field(v, "kind"),
        field(v, "date"),
        field(v, "description"),
        v["amount"].as_i64().ok_or("Invalid amount.")?,
        field(v, "walletId"),
        dest,
        field(v, "category"),
        field(v, "notes"),
        field(v, "id")
    ];
    exec(
        c,
        if update {
            "UPDATE entries SET kind=?,date=?,description=?,amount=?,wallet_id=?,destination_id=?,category=?,notes=?,fingerprint=NULL WHERE id=?"
        } else {
            "INSERT INTO entries(kind,date,description,amount,wallet_id,destination_id,category,notes,id) VALUES (?,?,?,?,?,?,?,?,?)"
        },
        p,
    )?;
    Ok(())
}
pub(super) fn balances(c: &Connection, through: &str) -> R<Vec<Value>> {
    query(
        c,
        "SELECT w.*,w.opening+COALESCE((SELECT SUM(CASE WHEN e.kind='income' THEN e.amount ELSE -e.amount END) FROM entries e WHERE e.wallet_id=w.id AND e.date<=?1),0)+COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.destination_id=w.id AND e.date<=?1),0) balance FROM wallets w ORDER BY w.archived,w.name",
        [through],
    )
}
pub(super) fn next_billing(due: &str, recurrence: &str, anchor: &str) -> R<String> {
    let d = date(due)?;
    let a = date(anchor)?;
    let next = match recurrence {
        "weekly" => d
            .checked_add_signed(Duration::days(7))
            .ok_or("Enter a valid date.")?,
        "monthly" | "yearly" => {
            let (y, m) = if recurrence == "yearly" {
                (d.year() + 1, a.month())
            } else if d.month() == 12 {
                (d.year() + 1, 1)
            } else {
                (d.year(), d.month() + 1)
            };
            let mut day = a.day();
            loop {
                if let Some(n) = NaiveDate::from_ymd_opt(y, m, day) {
                    break n;
                }
                day -= 1;
                if day == 0 {
                    return Err("Enter a valid date.".into());
                }
            }
        }
        _ => return Err("Invalid recurrence.".into()),
    };
    let s = next.to_string();
    date(&s)?;
    Ok(s)
}
pub(super) fn deduct(c: &Connection, through: &str) -> R<usize> {
    date(through)?;
    let rows = query(
        c,
        "SELECT s.* FROM subscriptions s JOIN wallets w ON w.id=s.wallet_id WHERE s.status='active' AND w.archived=0 AND s.next_due<=? ORDER BY s.next_due,s.id",
        [through],
    )?;
    let mut count = 0;
    for s in rows {
        let anchor = s["billing_anchor"]
            .as_str()
            .unwrap_or(field(&s, "next_due"));
        let mut due = field(&s, "next_due").to_string();
        while due.as_str() <= through {
            let next = next_billing(&due, field(&s, "recurrence"), anchor)?;
            if one(
                c,
                "SELECT 1 FROM subscription_charges WHERE subscription_id=? AND due_date=?",
                params![field(&s, "id"), due],
            )?
            .is_null()
            {
                let id = uid();
                exec(
                    c,
                    "INSERT INTO entries(id,kind,date,description,amount,wallet_id,category,notes) VALUES (?,'expense',?,?,?,?,?,?)",
                    params![
                        id,
                        due,
                        field(&s, "name"),
                        s["amount"].as_i64(),
                        field(&s, "wallet_id"),
                        field(&s, "category"),
                        format!(
                            "Automatic subscription payment ({}).",
                            field(&s, "recurrence")
                        )
                    ],
                )?;
                exec(
                    c,
                    "INSERT INTO subscription_charges(subscription_id,due_date,entry_id) VALUES (?,?,?)",
                    params![field(&s, "id"), due, id],
                )?;
                count += 1;
            }
            due = next;
        }
        exec(
            c,
            "UPDATE subscriptions SET next_due=?,billing_anchor=? WHERE id=?",
            params![due, anchor, field(&s, "id")],
        )?;
    }
    Ok(count)
}
