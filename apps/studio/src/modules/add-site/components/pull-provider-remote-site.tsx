import { Notice, __experimentalVStack as VStack } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import MainwpBridgeSiteSelector from 'src/modules/sync/providers/mainwp-bridge/site-selector';
import {
	getExternalRemoteProvider,
	type RemoteProviderSiteSelector,
} from 'src/modules/sync/providers/registry';
import type { RemoteProvider, SyncSite } from 'src/modules/sync/types';

interface PullProviderRemoteSiteProps {
	selectedProvider?: RemoteProvider;
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
}

const PROVIDER_SITE_SELECTORS: Partial<
	Record<
		RemoteProviderSiteSelector,
		( props: {
			selectedRemoteSite?: SyncSite;
			setSelectedRemoteSite: ( site?: SyncSite ) => void;
		} ) => JSX.Element
	>
> = {
	mainwpBridge: MainwpBridgeSiteSelector,
};

export default function PullProviderRemoteSite( {
	selectedProvider,
	selectedRemoteSite,
	setSelectedRemoteSite,
}: PullProviderRemoteSiteProps ) {
	const { __ } = useI18n();
	const providerDefinition = selectedProvider
		? getExternalRemoteProvider( selectedProvider )
		: undefined;
	const ProviderSiteSelector = providerDefinition
		? PROVIDER_SITE_SELECTORS[ providerDefinition.siteSelector ]
		: undefined;

	if ( ProviderSiteSelector ) {
		return (
			<ProviderSiteSelector
				selectedRemoteSite={ selectedRemoteSite }
				setSelectedRemoteSite={ setSelectedRemoteSite }
			/>
		);
	}

	return (
		<VStack className="w-full max-w-[720px] mx-auto" alignment="top" spacing={ 4 }>
			<Notice status="warning" isDismissible={ false }>
				{ __(
					'This provider is not ready in Studio yet. Go back and choose a provider that is marked available to continue.'
				) }
			</Notice>
		</VStack>
	);
}
