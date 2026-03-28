import type { RemoteProvider } from 'src/modules/sync/types';

export type RemoteProviderDefinition = {
	id: RemoteProvider;
	label: string;
	description: string;
	providerLabel: string;
	available: boolean;
	availabilityLabel?: string;
};

export const EXTERNAL_REMOTE_PROVIDER_DEFINITIONS: RemoteProviderDefinition[] = [
	{
		id: 'mainwpBridge',
		label: 'MainWP',
		description: 'Connect through your MainWP-hosted bridge and pull a managed WordPress site.',
		providerLabel: 'MainWP / Bridge',
		available: true,
	},
	{
		id: 'hetzner',
		label: 'Hetzner',
		description: 'Use a Hetzner-backed hosting inventory from the same external-host workflow.',
		providerLabel: 'Hetzner',
		available: false,
		availabilityLabel: 'Coming soon',
	},
	{
		id: 'digitalocean',
		label: 'DigitalOcean',
		description: 'Connect DigitalOcean-hosted WordPress sites through the external-host provider layer.',
		providerLabel: 'DigitalOcean',
		available: false,
		availabilityLabel: 'Coming soon',
	},
];

export const getExternalRemoteProviders = () => EXTERNAL_REMOTE_PROVIDER_DEFINITIONS;

export const getExternalRemoteProvider = ( provider: RemoteProvider ) =>
	EXTERNAL_REMOTE_PROVIDER_DEFINITIONS.find( definition => definition.id === provider );
