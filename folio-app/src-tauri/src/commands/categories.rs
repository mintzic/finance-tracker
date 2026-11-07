use super::shared::*;
pub(super) fn save_category_operation(c: &Connection, f: &Value) -> R<Value> {
    write_category(c, f, false)?;
    Ok(message("Category saved."))
}
#[tauri::command]
pub fn save_category(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, save_category_operation)
}
pub(super) fn delete_category_operation(c: &Connection, f: &Value) -> R<Value> {
    write_category(c, f, true)?;
    Ok(message("Category deleted. Records moved to Other."))
}
#[tauri::command]
pub fn delete_category(state: NativeState<'_>, form: Value) -> R<Value> {
    let storage = locked(&state)?;
    transaction(&mut storage.connection()?, &form, delete_category_operation)
}
fn write_category(c: &Connection, f: &Value, deleting: bool) -> R<()> {
    let id = field(f, "id");
    let old = if id.is_empty() {
        Value::Null
    } else {
        one(c, "SELECT * FROM categories WHERE id=?", [id])?
    };
    if !id.is_empty() && old.is_null() {
        return Err("Category not found.".into());
    }
    if old["name"] == "Other" {
        return Err("Other is reserved as the fallback category.".into());
    }
    let kind = old["kind"].as_str().unwrap_or(field(f, "kind"));
    if !["income", "expense"].contains(&kind) {
        return Err("Choose income or expense.".into());
    }
    let name = if deleting { "Other".to_string() } else { text(f, "name", 80)? };
    if name.eq_ignore_ascii_case("transfer") {
        return Err("Transfer is reserved for transfers.".into());
    }
    if deleting && old.is_null() {
        return Err("Category not found.".into());
    }
    if !deleting
        && !one(
            c,
            "SELECT id FROM categories WHERE kind=? AND name=? COLLATE NOCASE AND id<>?",
            params![kind, name, id],
        )?
        .is_null()
    {
        return Err("A category with this name already exists for this type.".into());
    }
    if !old.is_null() {
        let previous = field(&old, "name");
        exec(
            c,
            "UPDATE transactions SET category=?,fingerprint=NULL WHERE kind=? AND category=?",
            params![name, kind, previous],
        )?;
        if kind == "expense" {
            exec(
                c,
                "UPDATE subscriptions SET category=? WHERE category=?",
                params![name, previous],
            )?;
            for b in query(c, "SELECT * FROM budgets WHERE category=?", [previous])? {
                let target = one(
                    c,
                    "SELECT id,amount FROM budgets WHERE month=? AND category=? AND id<>?",
                    params![field(&b, "month"), name, field(&b, "id")],
                )?;
                if !target.is_null() {
                    let sum = target["amount"].as_i64().unwrap() + b["amount"].as_i64().unwrap();
                    if sum > MAX {
                        return Err("Combined budget exceeds the supported amount.".into());
                    }
                    exec(
                        c,
                        "UPDATE budgets SET amount=? WHERE id=?",
                        params![sum, field(&target, "id")],
                    )?;
                    exec(c, "DELETE FROM budgets WHERE id=?", [field(&b, "id")])?;
                } else {
                    exec(
                        c,
                        "UPDATE budgets SET category=? WHERE id=?",
                        params![name, field(&b, "id")],
                    )?;
                }
            }
        }
        if deleting {
            exec(c, "DELETE FROM categories WHERE id=?", [id])?;
        } else {
            exec(c, "UPDATE categories SET name=? WHERE id=?", params![name, id])?;
        }
    } else {
        exec(c, "INSERT INTO categories(id,kind,name) VALUES (?,?,?)", params![uid(), kind, name])?;
    }
    Ok(())
}
