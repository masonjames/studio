import type { RemoteProvider } from 'src/modules/sync/types';

export type RemoteProviderAvailability = 'available' | 'discovery' | 'disabled';

export type RemoteProviderSiteSelector = 'mainwpBridge' | 'wpRemote' | 'none';

export type RemoteProviderDefinition = {
	id: Exclude< RemoteProvider, 'wpcom' >;
	label: string;
	description: string;
	providerLabel: string;
	availability: RemoteProviderAvailability;
	availabilityLabel?: string;
	siteSelector: RemoteProviderSiteSelector;
};

export const EXTERNAL_REMOTE_PROVIDER_DEFINITIONS: RemoteProviderDefinition[] = [
	{
		id: 'wpRemote',
		label: 'WP Remote',
		description:
			'Discovery-only in Studio until Phase 7. Bridge-side WP Remote export validation continues for compatible hosts, but pull stays locked in the shipped picker.',
		providerLabel: 'WP Remote',
		availability: 'discovery',
		availabilityLabel: 'Discovery only',
		siteSelector: 'wpRemote',
	},
	{
		id: 'mainwpBridge',
		label: 'MainWP',
		description: 'Connect through your MainWP-hosted bridge and pull a managed WordPress site.',
		providerLabel: 'MainWP / Bridge',
		availability: 'available',
		siteSelector: 'mainwpBridge',
	},
	{
		id: 'flywheel',
		label: 'Flywheel',
		description:
			'Planned provider support for browsing and pulling sites from Flywheel-managed accounts.',
		providerLabel: 'Flywheel',
		availability: 'discovery',
		availabilityLabel: 'Researching',
		siteSelector: 'none',
	},
	{
		id: 'wpEngine',
		label: 'WP Engine',
		description:
			'Planned provider support for browsing and pulling sites from WP Engine-managed accounts.',
		providerLabel: 'WP Engine',
		availability: 'discovery',
		availabilityLabel: 'Researching',
		siteSelector: 'none',
	},
];

export const getExternalRemoteProviders = () => EXTERNAL_REMOTE_PROVIDER_DEFINITIONS;

export const getExternalRemoteProvider = ( provider: RemoteProvider ) =>
	EXTERNAL_REMOTE_PROVIDER_DEFINITIONS.find( ( definition ) => definition.id === provider );
