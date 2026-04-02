import type { RemoteProvider, SyncSite } from 'src/modules/sync/types';

const WP_REMOTE_PULL_DISABLED_FALLBACK =
	'Only WP Remote sites that pass bridge compatibility validation can be pulled into Studio.';
const GENERIC_PULL_DISABLED_FALLBACK = 'This remote site cannot be pulled into Studio yet.';

type PullAvailabilityInput = {
	provider: RemoteProvider | undefined | null;
	providerCanPull: boolean;
	disabledReason?: string | null;
};

function resolveStudioPullDisabledReason(
	provider: RemoteProvider | undefined | null,
	disabledReason?: string | null
): string {
	if ( disabledReason?.trim() ) {
		return disabledReason.trim();
	}

	if ( provider === 'wpRemote' ) {
		return WP_REMOTE_PULL_DISABLED_FALLBACK;
	}

	return GENERIC_PULL_DISABLED_FALLBACK;
}

export function resolveStudioPullAvailability( {
	provider,
	providerCanPull,
	disabledReason,
}: PullAvailabilityInput ) {
	if ( providerCanPull ) {
		return {
			canPull: true,
			disabledReason: undefined,
		};
	}

	return {
		canPull: false,
		disabledReason: resolveStudioPullDisabledReason( provider, disabledReason ),
	};
}

export function getStudioPullDisabledMessage(
	site: Pick< SyncSite, 'provider' | 'syncDisabledReason' > | undefined | null
): string {
	return resolveStudioPullDisabledReason( site?.provider, site?.syncDisabledReason );
}

export function canStudioPullSite(
	site: Pick< SyncSite, 'capabilities' > | undefined | null
): boolean {
	return Boolean( site?.capabilities.pull );
}

export function canStudioCreateSiteFromRemotePull(
	site: Pick< SyncSite, 'syncSupport' | 'capabilities' > | undefined | null
): boolean {
	return Boolean( site && site.syncSupport === 'syncable' && canStudioPullSite( site ) );
}
