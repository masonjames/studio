import { describe, expect, it, vi } from 'vitest';
import { getPullRetryOptions } from './pull-retry-options';
import type { SyncBackupState } from './sync-operations-slice';

vi.hoisted( () => {
	vi.stubGlobal( 'localStorage', {
		getItem: vi.fn( () => null ),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn(),
	} );
} );

describe( 'getPullRetryOptions', () => {
	it( 'returns the original pull options when a failed pull stored them', () => {
		const pullState = {
			pullOptions: {
				optionsToSync: [ 'database', 'plugins' ],
				include_path_list: [ 'wp-content/plugins/example' ],
			},
		} as Pick< SyncBackupState, 'pullOptions' >;

		expect( getPullRetryOptions( pullState ) ).toEqual( {
			optionsToSync: [ 'database', 'plugins' ],
			include_path_list: [ 'wp-content/plugins/example' ],
		} );
	} );

	it( 'falls back to a full-site pull when no retry options were stored', () => {
		expect( getPullRetryOptions( undefined ) ).toEqual( {
			optionsToSync: [ 'all' ],
		} );
	} );
} );
