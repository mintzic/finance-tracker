import { invoke } from '@tauri-apps/api/core';
import type { ActionResult, DashboardData, NativeAsset, SettingsData, SerializedForm } from './types';

export const bridge = {
  dashboard: (params: Record<string, string>) => invoke<DashboardData>('dashboard', { params }),
  saveAccount: (form: SerializedForm) => invoke<ActionResult>('save_account', { form }),
  adjustAccount: (form: SerializedForm) => invoke<ActionResult>('adjust_account', { form }),
  deleteAccount: (form: SerializedForm) => invoke<ActionResult>('delete_account', { form }),
  saveTransaction: (form: SerializedForm) => invoke<ActionResult>('save_transaction', { form }),
  deleteTransaction: (form: SerializedForm) => invoke<ActionResult>('delete_transaction', { form }),
  saveBudget: (form: SerializedForm) => invoke<ActionResult>('save_budget', { form }),
  deleteBudget: (form: SerializedForm) => invoke<ActionResult>('delete_budget', { form }),
  saveCategory: (form: SerializedForm) => invoke<ActionResult>('save_category', { form }),
  deleteCategory: (form: SerializedForm) => invoke<ActionResult>('delete_category', { form }),
  saveSubscription: (form: SerializedForm) => invoke<ActionResult>('save_subscription', { form }),
  saveGoal: (form: SerializedForm) => invoke<ActionResult>('save_goal', { form }),
  addContribution: (form: SerializedForm) => invoke<ActionResult>('add_contribution', { form }),
  deleteContribution: (form: SerializedForm) => invoke<ActionResult>('delete_contribution', { form }),
  previewImport: (form: SerializedForm) => invoke<ActionResult>('preview_import', { form }),
  commitImport: (form: SerializedForm) => invoke<ActionResult>('commit_import', { form }),
  uploadCover: async (file: File) => invoke<ActionResult>('upload_cover', new Uint8Array(await file.arrayBuffer())),
  removeCover: (form: SerializedForm) => invoke<ActionResult>('remove_cover', { form }),
  positionCover: (form: SerializedForm) => invoke<ActionResult>('position_cover', { form }),
  resetLedger: (form: SerializedForm) => invoke<ActionResult>('reset_ledger', { form }),
  seedDemo: (form: SerializedForm) => invoke<ActionResult>('seed_demo', { form }),
  settings: () => invoke<SettingsData>('settings', {}),
  updateProfile: (form: SerializedForm) => invoke<SettingsData>('update_profile', { form }),
  createLedger: (form: SerializedForm) => invoke<SettingsData>('create_ledger', { form }),
  updateLedger: (form: SerializedForm) => invoke<SettingsData>('update_ledger', { form }),
  switchLedger: (form: SerializedForm) => invoke<SettingsData>('switch_ledger', { form }),
  deleteLedger: (form: SerializedForm) => invoke<SettingsData>('delete_ledger', { form }),
  receiptPreview: (id: string) => invoke<ArrayBuffer>('receipt_preview', { id }),
  asset: (kind: 'receipt' | 'cover', id: string) => invoke<NativeAsset>('asset', { kind, id }),
  exportCsv: () => invoke<string>('export_csv', {}),
  exportBackup: () => invoke<unknown>('export_backup', {}),
  restoreBackup: (backup: unknown, confirmation: string) => invoke<ActionResult>('restore_backup', { backup, confirmation }),
  exportTableCsv: (table: 'transactions' | 'accounts' | 'categories' | 'budgets' | 'subscriptions' | 'goals' | 'contributions') =>
    invoke<string>('export_table_csv', { table }),
  importLegacy: (source: string, confirmation: string) => invoke<ActionResult>('import_legacy', { source, confirmation }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Unable to complete the request. Please try again.';
}

export async function serializeForm(data: FormData): Promise<SerializedForm> {
  const form: SerializedForm = {};
  let size = 0;
  const fields: [string, FormDataEntryValue][] = [];
  data.forEach((value, key) => {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.size;

    const unlimited = key === 'receipt' || key === 'csv' || key === 'file';

    if (!unlimited) {
      size += bytes;
    }

    if (!unlimited && typeof value !== 'string' && bytes > 5 * 1024 * 1024) {
      throw new Error('File must be no larger than 5 MB.');
    }

    fields.push([key, value]);
  });

  if (size > 6 * 1024 * 1024) {
    throw new Error('Request exceeds 6 MB.');
  }

  for (const [key, value] of fields) {
    form[key] =
      typeof value === 'string'
        ? value
        : {
            name: value.name,
            mime: value.type,
            bytes: Array.from(new Uint8Array(await value.arrayBuffer())),
          };
  }
  return form;
}
