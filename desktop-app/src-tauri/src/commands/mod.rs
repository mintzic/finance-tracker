mod accounts;
mod app;
mod budgets;
mod categories;
mod files;
mod goals;
mod imports;
mod ledger;
mod maintenance;
mod overview;
mod profiles;
pub(crate) mod shared;
mod subscriptions;
#[cfg(test)]
mod tests;
mod transactions;
pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        app::greeting,
        overview::dashboard,
        profiles::profiles,
        profiles::create_profile,
        profiles::update_profile,
        profiles::switch_profile,
        accounts::save_account,
        accounts::adjust_account,
        accounts::delete_account,
        transactions::save_transaction,
        transactions::delete_transaction,
        budgets::save_budget,
        budgets::delete_budget,
        categories::save_category,
        categories::delete_category,
        subscriptions::save_subscription,
        goals::save_goal,
        goals::add_contribution,
        goals::delete_contribution,
        maintenance::reset_workspace,
        maintenance::seed_demo,
        files::upload_cover,
        files::remove_cover,
        files::position_cover,
        imports::preview_import,
        imports::commit_import,
        files::asset,
        imports::export_csv,
        imports::import_legacy
    ]
}
