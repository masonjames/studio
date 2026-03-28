import { Notice, __experimentalVStack as VStack } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import MainwpBridgeSiteSelector from 'src/modules/sync/providers/mainwp-bridge/site-selector';
import type { RemoteProvider, SyncSite } from 'src/modules/sync/types';

interface PullProviderRemoteSiteProps {
	selectedProvider?: RemoteProvider;
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
}

export default function PullProviderRemoteSite( {
	selectedProvider,
	selectedRemoteSite,
	setSelectedRemoteSite,
}: PullProviderRemoteSiteProps ) {
	const { __ } = useI18n();

	if ( selectedProvider === 'mainwpBridge' ) {
		return (
			<MainwpBridgeSiteSelector
				selectedRemoteSite={ selectedRemoteSite }
				setSelectedRemoteSite={ setSelectedRemoteSite }
			/>
		);
	}

	return (
		<VStack className="w-full max-w-[720px] mx-auto" alignment="top" spacing={ 4 }>
			<Notice status="warning" isDismissible={ false }>
				{ __(
					'This provider is not available yet. Please choose MainWP for the current bridge-backed workflow.'
				) }
			</Notice>
		</VStack>
	);
}
