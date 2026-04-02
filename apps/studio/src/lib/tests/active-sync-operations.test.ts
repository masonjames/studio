import {
	ACTIVE_SYNC_OPERATIONS,
	hasActivePullOperations,
	hasUploadingPushOperations,
	pullRequiresLocalCompletion,
} from 'src/lib/active-sync-operations';

describe( 'active sync operation helpers', () => {
	beforeEach( () => {
		ACTIVE_SYNC_OPERATIONS.clear();
	} );

	it( 'treats in-progress, downloading, and importing pulls as requiring local completion', () => {
		expect( pullRequiresLocalCompletion( 'in-progress' ) ).toBe( true );
		expect( pullRequiresLocalCompletion( 'downloading' ) ).toBe( true );
		expect( pullRequiresLocalCompletion( 'importing' ) ).toBe( true );
		expect( pullRequiresLocalCompletion( 'finished' ) ).toBe( false );
		expect( pullRequiresLocalCompletion( 'failed' ) ).toBe( false );
		expect( pullRequiresLocalCompletion( undefined ) ).toBe( false );
	} );

	it( 'detects active pull operations from the in-memory registry', () => {
		ACTIVE_SYNC_OPERATIONS.set( 'pull-1', {
			key: 'importing',
			progress: 80,
			message: 'Importing backup…',
		} );

		expect( hasActivePullOperations() ).toBe( true );
		expect( hasUploadingPushOperations() ).toBe( false );
	} );

	it( 'does not treat remote-safe push finalization as an active pull', () => {
		ACTIVE_SYNC_OPERATIONS.set( 'push-1', {
			key: 'finishing',
			progress: 99,
			message: 'Almost there…',
		} );

		expect( hasActivePullOperations() ).toBe( false );
		expect( hasUploadingPushOperations() ).toBe( false );
	} );

	it( 'still detects uploading push operations', () => {
		ACTIVE_SYNC_OPERATIONS.set( 'push-1', {
			key: 'uploading',
			progress: 40,
			message: 'Uploading site…',
		} );

		expect( hasUploadingPushOperations() ).toBe( true );
		expect( hasActivePullOperations() ).toBe( false );
	} );
} );
