import { invoke } from '@tauri-apps/api/core';
import type { ActionResult, DashboardData, NativeAsset, ProfilesData, SerializedForm } from './types';

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
  uploadCover: (form: SerializedForm) => invoke<ActionResult>('upload_cover', { form }),
  removeCover: (form: SerializedForm) => invoke<ActionResult>('remove_cover', { form }),
  positionCover: (form: SerializedForm) => invoke<ActionResult>('position_cover', { form }),
  resetWorkspace: (form: SerializedForm) => invoke<ActionResult>('reset_workspace', { form }),
  seedDemo: (form: SerializedForm) => invoke<ActionResult>('seed_demo', { form }),
  profiles: () => invoke<ProfilesData>('profiles', {}),
  createProfile: (form: SerializedForm) => invoke<ActionResult>('create_profile', { form }),
  updateProfile: (form: SerializedForm) => invoke<ActionResult>('update_profile', { form }),
  switchProfile: (form: SerializedForm) => invoke<ActionResult>('switch_profile', { form }),
  asset: (kind: 'receipt' | 'cover', id: string) => invoke<NativeAsset>('asset', { kind, id }),
  exportCsv: () => invoke<string>('export_csv', {}),
  importLegacy: (source: string, confirmation: string) => invoke<ActionResult>('import_legacy', { source, confirmation }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {return error.message;}

  if (typeof error === 'string') {return error;}

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {return error.message;}

  return 'Unable to complete the request. Please try again.';
}

export async function serializeForm(data: FormData): Promise<SerializedForm> {
  const form: SerializedForm = {};
  let size = 0;
  const fields: [string, FormDataEntryValue][] = [];
  data.forEach((value, key) => {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.size;
    size += bytes;
    const csv = key === 'csv' || key === 'file';

    if (csv && bytes > 1024 * 1024) {throw new Error('CSV must be at most 1 MB.');}

    if (typeof value !== 'string' && bytes > 5 * 1024 * 1024) {
      throw new Error('File must be no larger than 5 MB.');
    }

    fields.push([key, value]);
  });

  if (size > 6 * 1024 * 1024) {throw new Error('Request exceeds 6 MB.');}

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
