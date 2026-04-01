import type { RemoteProvider, SyncSite } from 'src/modules/sync/types';

const STUDIO_PULL_ACTIVATION_MESSAGES: Partial< Record< RemoteProvider, string > > = {
	wpRemote: 'WP Remote site pulls are not available in Studio until Phase 7.',
};

export function getStudioPullActivationMessage(
	provider: RemoteProvider | undefined | null
): string | undefined {
	if ( ! provider ) {
		return undefined;
	}

	return STUDIO_PULL_ACTIVATION_MESSAGES[ provider ];
}

export function isStudioPullActivatedForProvider(
	provider: RemoteProvider | undefined | null
): boolean {
	return ! getStudioPullActivationMessage( provider );
}

export function getStudioPullCapability(
	provider: RemoteProvider | undefined | null,
	providerCanPull: boolean
): boolean {
	return providerCanPull && isStudioPullActivatedForProvider( provider );
}

export function canStudioPullSite(
	site: Pick< SyncSite, 'provider' | 'capabilities' > | undefined | null
): boolean {
	return Boolean( site && getStudioPullCapability( site.provider, site.capabilities.pull ) );
}

export function canStudioCreateSiteFromRemotePull(
	site: Pick< SyncSite, 'provider' | 'syncSupport' | 'capabilities' > | undefined | null
): boolean {
	return Boolean( site && site.syncSupport === 'syncable' && canStudioPullSite( site ) );
}

export function assertStudioPullActivatedForProvider(
	provider: RemoteProvider | undefined | null
): void {
	const message = getStudioPullActivationMessage( provider );
	if ( message ) {
		throw new Error( message );
	}
}
