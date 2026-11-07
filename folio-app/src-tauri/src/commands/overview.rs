use super::{ledger::*, shared::*};
const SELECT: &str = "SELECT e.*,w.name account_name,d.name destination_name,r.id receipt_id FROM transactions e JOIN accounts w ON w.id=e.account_id LEFT JOIN accounts d ON d.id=e.destination_account_id LEFT JOIN receipts r ON r.transaction_id=e.id";
/// Parameters are the legacy URL search parameters represented as a JSON object.
pub(super) fn read_dashboard(conn: &mut Connection, p: &Value) -> R<Value> {
    let tx =
        conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
    deduct(&tx, &today())?;
    let v = load(&tx, p)?;
    tx.commit().map_err(err)?;
    Ok(v)
}
fn load(c: &Connection, p: &Value) -> R<Value> {
    let now = today();
    let month = if field(p, "month").is_empty() { &now[..7] } else { field(p, "month") };
    let (start, end) = month_range(month)?;
    let section = if field(p, "view").is_empty() { "dashboard" } else { field(p, "view") };
    if ![
        "dashboard",
        "accounts",
        "income",
        "expenses",
        "transfers",
        "budgets",
        "subscriptions",
        "goals",
        "reports",
        "import",
    ]
    .contains(&section)
    {
        return Err("Not found".into());
    }
    let sum = one(
        c,
        "SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense FROM transactions WHERE date>=? AND date<?",
        params![start, end],
    )?;
    let grouped = |kind: &str| {
        query(
            c,
            "SELECT category,SUM(amount) amount FROM transactions WHERE kind=? AND date>=? AND date<? GROUP BY category ORDER BY amount DESC",
            params![kind, start, end],
        )
    };
    let budgets = query(
        c,
        "SELECT b.*,COALESCE((SELECT SUM(e.amount) FROM transactions e WHERE e.category=b.category AND e.kind='expense' AND e.date>=?1 AND e.date<?2),0) spent FROM budgets b WHERE (b.month=?3 OR (b.all_months=1 AND b.month<=?3)) AND NOT EXISTS(SELECT 1 FROM budgets newer WHERE newer.category=b.category AND newer.month>b.month AND (newer.month=?3 OR (newer.all_months=1 AND newer.month<=?3))) ORDER BY b.category",
        params![start, end, month],
    )?;
    let last = (date(&end)? - Duration::days(1)).to_string();
    let trends = query(
        c,
        "WITH RECURSIVE months(month,n) AS (SELECT strftime('%Y-%m',date(?,'-5 months')),1 UNION ALL SELECT strftime('%Y-%m',date(month||'-01','+1 month')),n+1 FROM months WHERE n<6) SELECT month,COALESCE((SELECT SUM(amount) FROM transactions WHERE kind='income' AND substr(date,1,7)=month),0) income,COALESCE((SELECT SUM(amount) FROM transactions WHERE kind='expense' AND substr(date,1,7)=month),0) expense,COALESCE((SELECT SUM(amount) FROM contributions WHERE substr(date,1,7)=month),0) savings FROM months",
        [&start],
    )?;
    let q = field(p, "q").chars().take(200).collect::<String>();
    let account = field(p, "account");
    let cat = field(p, "category");
    let kind = match section {
        "income" => "income",
        "expenses" => "expense",
        "transfers" => "transfer",
        _ => "",
    };
    let wh = "e.date>=?1 AND e.date<?2 AND (?3='' OR e.kind=?3) AND (?4='' OR instr(lower(e.description||' '||e.notes),lower(?4))>0) AND (?5='' OR e.account_id=?5 OR e.destination_account_id=?5) AND (?6='' OR e.category=?6)";
    let count = one(
        c,
        &format!("SELECT count(*) count FROM transactions e WHERE {wh}"),
        params![start, end, kind, q, account, cat],
    )?["count"]
        .as_i64()
        .unwrap_or(0);
    let raw = p
        .get("page")
        .and_then(Value::as_f64)
        .or_else(|| field(p, "page").parse::<f64>().ok())
        .unwrap_or(1.0);
    let page = if raw.is_finite() { (raw as i64).clamp(1, ((count + 19) / 20).max(1)) } else { 1 };
    let sort = if field(p, "sort").is_empty() { "date" } else { field(p, "sort") };
    let column = match sort {
        "amount" => "e.amount",
        "description" => "e.description",
        _ => "e.date",
    };
    let dir = if field(p, "dir") == "asc" { "ASC" } else { "DESC" };
    let transactions = query(
        c,
        &format!("{SELECT} WHERE {wh} ORDER BY {column} {dir},e.id LIMIT 20 OFFSET ?7"),
        params![start, end, kind, q, account, cat, (page - 1) * 20],
    )?;
    let recent = |k: &str| {
        query(
            c,
            &format!(
                "{SELECT} WHERE e.kind=? AND e.date>=? AND e.date<? ORDER BY e.date DESC,e.rowid DESC LIMIT 5"
            ),
            params![k, start, end],
        )
    };
    let mut result = json!({
        "month":month,"section":section,"categories":query(c,"SELECT * FROM categories ORDER BY kind,name COLLATE NOCASE",[])?,
        "cover":one(c,"SELECT version,position FROM ledger_cover WHERE id=1",[])?,"sum":sum,"spending":grouped("expense")?,"incomeByCategory":grouped("income")?,"budgets":budgets,
        "accounts":balances(c,"9999-12-31")?,"monthBalances":balances(c,&last)?,
        "goals":query(c,"SELECT g.*,COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.goal_id=g.id),0) saved FROM goals g ORDER BY g.target_date",[])?,
        "subscriptions":query(c,"SELECT s.*,w.name account_name FROM subscriptions s JOIN accounts w ON w.id=s.account_id ORDER BY s.next_due",[])?,
        "contributions":query(c,"SELECT c.*,g.name FROM contributions c JOIN goals g ON g.id=c.goal_id ORDER BY c.date DESC LIMIT 100",[])?,
        "trends":trends,"transactions":transactions,"count":count,"page":page,"q":q,"account":account,"category":cat,"sort":sort,"dir":dir.to_lowercase(),
        "recentExpenses":recent("expense")?,"recentIncome":recent("income")?,"recentTransfers":recent("transfer")?
    });
    // JSON.stringify omits the legacy undefined edit property.
    if !field(p, "edit").is_empty() {
        let edit = one(c, "SELECT * FROM transactions WHERE id=?", [field(p, "edit")])?;
        if !edit.is_null() {
            result["edit"] = edit;
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn dashboard(state: NativeState<'_>, params: Value) -> R<Value> {
    let storage = locked(&state)?;
    let mut result = read_dashboard(&mut storage.connection()?, &params)?;
    let settings = storage.settings()?;
    for key in ["profile", "ledger", "ledgers"] {
        result[key] = settings[key].clone();
    }
    Ok(result)
}
