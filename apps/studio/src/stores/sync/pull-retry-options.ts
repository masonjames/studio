import type { PullSiteOptions, SyncBackupState } from './sync-operations-slice';

export function getPullRetryOptions(
	pullState: Pick< SyncBackupState, 'pullOptions' > | undefined | null
): PullSiteOptions {
	if ( ! pullState?.pullOptions ) {
		return { optionsToSync: [ 'all' ] };
	}

	return {
		optionsToSync: [ ...pullState.pullOptions.optionsToSync ],
		include_path_list: pullState.pullOptions.include_path_list
			? [ ...pullState.pullOptions.include_path_list ]
			: undefined,
	};
}
