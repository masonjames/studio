import { useI18n } from '@wordpress/react-i18n';
import BridgeSiteSelector from '../bridge/site-selector';
import type { SyncSite } from 'src/modules/sync/types';

interface MainwpBridgeSiteSelectorProps {
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
}

export default function MainwpBridgeSiteSelector( {
	selectedRemoteSite,
	setSelectedRemoteSite,
}: MainwpBridgeSiteSelectorProps ) {
	const { __ } = useI18n();

	return (
		<BridgeSiteSelector
			provider="mainwpBridge"
			selectedRemoteSite={ selectedRemoteSite }
			setSelectedRemoteSite={ setSelectedRemoteSite }
			copy={ {
				heading: __( 'Pull from MainWP' ),
				description: __(
					'Connect a MainWP-hosted bridge account, choose a managed WordPress site, and pull it into Studio.'
				),
				emptyAccounts: __( 'Save a bridge account to list your remotely managed sites.' ),
				addHeading: __( 'Add MainWP bridge account' ),
				editHeading: __( 'Edit MainWP bridge account' ),
				labelPlaceholder: __( 'Production MainWP bridge' ),
				routeSupportWarning: __(
					'This bridge is reachable, but backup inventory/export support is not enabled yet. Pulling from it is currently unavailable.'
				),
			} }
		/>
	);
}
