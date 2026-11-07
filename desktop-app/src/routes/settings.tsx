import { Link, useLoaderData, type ActionFunctionArgs } from 'react-router';
import { bridge, serializeForm, errorMessage } from '@/lib/bridge';
import { SettingsForms } from '@/components/user-settings';

export function loader() {
  return bridge.settings();
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const form = await serializeForm(await request.formData());
    switch (form.intent) {
      case 'update_profile':
        await bridge.updateProfile(form);
        return { message: 'Profile saved.' };
      case 'create_ledger':
        await bridge.createLedger(form);
        return { message: 'Ledger created.' };
      case 'update_ledger':
        await bridge.updateLedger(form);
        return { message: 'Ledger renamed.' };
      case 'switch_ledger':
        await bridge.switchLedger(form);
        return { message: 'Active ledger changed.' };
      case 'delete_ledger': {
        const result = await bridge.deleteLedger(form);
        return { message: 'Ledger deleted.', warning: result.warning };
      }
      case 'import_legacy':
        return await bridge.importLegacy(String(form.source || ''), String(form.confirmation || ''));
      default:
        return { error: 'Unknown settings action.' };
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export default function Settings() {
  const settings = useLoaderData<typeof loader>();
  return (
    <main className="profile-page">
      <h1>Settings</h1>
      <p>
        Active ledger:{' '}
        <strong>
          {settings.ledger.name} · {settings.ledger.currency}
        </strong>
      </p>
      <SettingsForms settings={settings} />
      <Link to="/" className="text-button">
        Back to ledger
      </Link>
    </main>
  );
}
