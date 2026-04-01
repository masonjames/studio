import { useI18n } from '@wordpress/react-i18n';
import BridgeSiteSelector from '../bridge/site-selector';
import type { SyncSite } from 'src/modules/sync/types';

interface WpRemoteSiteSelectorProps {
	selectedRemoteSite?: SyncSite;
	setSelectedRemoteSite: ( site?: SyncSite ) => void;
}

export default function WpRemoteSiteSelector( {
	selectedRemoteSite,
	setSelectedRemoteSite,
}: WpRemoteSiteSelectorProps ) {
	const { __ } = useI18n();

	return (
		<BridgeSiteSelector
			provider="wpRemote"
			selectedRemoteSite={ selectedRemoteSite }
			setSelectedRemoteSite={ setSelectedRemoteSite }
			copy={ {
				heading: __( 'Browse WP Remote sites' ),
				description: __(
					'Connect a bridge that has validated WP Remote registrations, then browse the discovered sites available to Studio.'
				),
				emptyAccounts: __(
					'Save a bridge account that advertises WP Remote support to browse your bridge-managed registrations.'
				),
				addHeading: __( 'Add WP Remote bridge account' ),
				editHeading: __( 'Edit WP Remote bridge account' ),
				labelPlaceholder: __( 'Production WP Remote bridge' ),
				routeSupportWarning: __(
					'This bridge can list WP Remote sites, but Studio keeps WP Remote discovery-only until Phase 7 while bridge export verification continues for compatible hosts.'
				),
			} }
		/>
	);
}
