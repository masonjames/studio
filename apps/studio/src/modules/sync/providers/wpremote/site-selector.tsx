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
					'Connect a bridge that has validated WP Remote registrations. Only compatibility-validated sites can be pulled into Studio; incompatible or rollout-disabled sites remain browseable.'
				),
				emptyAccounts: __(
					'Save a bridge account that advertises WP Remote support to browse your bridge-managed registrations.'
				),
				addHeading: __( 'Add WP Remote bridge account' ),
				editHeading: __( 'Edit WP Remote bridge account' ),
				labelPlaceholder: __( 'Production WP Remote bridge' ),
				routeSupportWarning: __(
					'This bridge can list WP Remote sites, but it does not support the backup/export routes required for pull.'
				),
				compatibilityWarning: __(
					'Only WP Remote sites that pass bridge compatibility validation can be pulled into Studio. Incompatible or rollout-disabled sites remain browseable but unavailable for pull.'
				),
			} }
		/>
	);
}
