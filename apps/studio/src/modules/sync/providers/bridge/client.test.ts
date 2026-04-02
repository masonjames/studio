/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listBridgeSites, testBridgeAccountConnection } from './client';
import type { RemoteProviderAccount, TestRemoteProviderAccountInput } from 'src/modules/sync/types';

vi.mock( 'electron', () => ( {
	app: {
		getPath: vi.fn( () => '/tmp' ),
	},
} ) );

const fetchMock = vi.fn();

const mainwpAccount: RemoteProviderAccount = {
	id: 'account-1',
	provider: 'mainwpBridge',
	label: 'Primary bridge',
	bridgeUrl: 'https://bridge.example.com',
	tokenMode: 'single',
	readToken: 'read-token',
	mutateToken: 'read-token',
	supportedProviders: [ 'mainwpBridge' ],
	createdAt: '2026-03-31T00:00:00.000Z',
	updatedAt: '2026-03-31T00:00:00.000Z',
};

const wpRemoteAccount: RemoteProviderAccount = {
	...mainwpAccount,
	id: 'account-2',
	provider: 'wpRemote',
	label: 'WP Remote bridge',
	supportedProviders: [ 'wpRemote' ],
};

function jsonResponse( body: unknown, status = 200 ) {
	return new Response( JSON.stringify( body ), {
		status,
		headers: {
			'content-type': 'application/json',
		},
	} );
}

describe( 'bridge client provider contract', () => {
	beforeEach( () => {
		fetchMock.mockReset();
		vi.stubGlobal( 'fetch', fetchMock as unknown as typeof fetch );
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'maps bridge sites using the explicit provider from the bridge payload', async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
					providerSupport: {
						mainwpBridge: true,
						wpRemote: false,
						flywheel: false,
						wpEngine: false,
					},
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [
						{
							id: 'site-1',
							provider: 'mainwpBridge',
							name: 'Avenue941',
							activeUrl: 'https://avenue941.com',
							urls: [ 'https://avenue941.com' ],
							capabilities: {
								pull: true,
								backupCreate: true,
								backupsRead: true,
							},
						},
					],
				} )
			);

		const result = await listBridgeSites( mainwpAccount );

		expect( result.health.providerSupport?.mainwpBridge ).toBe( true );
		expect( result.sites ).toEqual( [
			expect.objectContaining( {
				id: 'mainwpBridge:site-1',
				remoteSiteId: 'site-1',
				provider: 'mainwpBridge',
				providerLabel: 'MainWP / Bridge',
				providerAccountId: 'account-1',
				name: 'Avenue941',
				syncSupport: 'syncable',
			} ),
		] );
	} );

	it( 'maps pull-ready WP Remote sites to syncable Studio sites', async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
					providerSupport: {
						mainwpBridge: true,
						wpRemote: true,
						flywheel: false,
						wpEngine: false,
					},
					routeSupport: {
						backupInventory: true,
						export: true,
					},
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [
						{
							id: 'site-2',
							provider: 'wpRemote',
							name: 'Seeded Site',
							activeUrl: 'https://seeded.example.com',
							urls: [ 'https://seeded.example.com' ],
							capabilities: {
								pull: true,
								backupCreate: true,
								backupsRead: true,
							},
						},
					],
				} )
			);

		const result = await listBridgeSites( wpRemoteAccount );

		expect( result.sites ).toEqual( [
			expect.objectContaining( {
				id: 'wpRemote:site-2',
				remoteSiteId: 'site-2',
				provider: 'wpRemote',
				providerLabel: 'WP Remote',
				syncSupport: 'syncable',
				syncDisabledReason: undefined,
				capabilities: expect.objectContaining( {
					pull: true,
					backupCreate: true,
					backupsRead: true,
				} ),
			} ),
		] );
	} );

	it( 'preserves bridge notes as the disabled reason for unsupported WP Remote sites', async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
					providerSupport: {
						mainwpBridge: true,
						wpRemote: true,
						flywheel: false,
						wpEngine: false,
					},
					routeSupport: {
						backupInventory: true,
						export: true,
					},
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [
						{
							id: 'site-3',
							provider: 'wpRemote',
							name: 'Incompatible Site',
							activeUrl: 'https://incompatible.example.com',
							urls: [ 'https://incompatible.example.com' ],
							capabilities: {
								pull: false,
								backupCreate: false,
								backupsRead: false,
							},
							metadata: {
								notes:
									'WP Remote bridge-managed registration. Pull disabled: filesystem canary failed.',
							},
						},
					],
				} )
			);

		const result = await listBridgeSites( wpRemoteAccount );

		expect( result.sites ).toEqual( [
			expect.objectContaining( {
				id: 'wpRemote:site-3',
				provider: 'wpRemote',
				syncSupport: 'unsupported',
				syncDisabledReason:
					'WP Remote bridge-managed registration. Pull disabled: filesystem canary failed.',
				capabilities: expect.objectContaining( {
					pull: false,
				} ),
			} ),
		] );
	} );

	it( 'marks bridge sites unsupported when the account lacks pull routes', async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
					providerSupport: {
						mainwpBridge: true,
						wpRemote: true,
						flywheel: false,
						wpEngine: false,
					},
					routeSupport: {
						backupInventory: true,
						export: false,
					},
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [
						{
							id: 'site-4',
							provider: 'wpRemote',
							name: 'Route Limited Site',
							activeUrl: 'https://route-limited.example.com',
							urls: [ 'https://route-limited.example.com' ],
							capabilities: {
								pull: true,
								backupCreate: true,
								backupsRead: true,
							},
						},
					],
				} )
			);

		const result = await listBridgeSites( wpRemoteAccount );

		expect( result.sites ).toEqual( [
			expect.objectContaining( {
				id: 'wpRemote:site-4',
				provider: 'wpRemote',
				syncSupport: 'unsupported',
				syncDisabledReason:
					'This bridge can list sites, but it does not support the backup and export routes required for pull.',
				capabilities: expect.objectContaining( {
					pull: false,
				} ),
			} ),
		] );
	} );

	it( 'rejects bridge connections when the selected provider is not advertised by healthz', async () => {
		const input: TestRemoteProviderAccountInput = {
			provider: 'wpRemote',
			bridgeUrl: 'https://bridge.example.com',
			readToken: 'read-token',
			mutateToken: 'write-token',
			tokenMode: 'split',
		};

		fetchMock.mockResolvedValueOnce(
			jsonResponse( {
				ok: true,
				providerSupport: {
					mainwpBridge: true,
					wpRemote: false,
					flywheel: false,
					wpEngine: false,
				},
			} )
		);

		await expect( testBridgeAccountConnection( input ) ).rejects.toThrow(
			'This bridge does not advertise support for WP Remote.'
		);
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'rejects WP Remote bridge connections when providerSupport is omitted by healthz', async () => {
		const input: TestRemoteProviderAccountInput = {
			provider: 'wpRemote',
			bridgeUrl: 'https://bridge.example.com',
			readToken: 'read-token',
			mutateToken: 'write-token',
			tokenMode: 'split',
		};

		fetchMock.mockResolvedValueOnce(
			jsonResponse( {
				ok: true,
			} )
		);

		await expect( testBridgeAccountConnection( input ) ).rejects.toThrow(
			'This bridge does not advertise support for WP Remote.'
		);
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'filters site payloads to the selected provider', async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
					providerSupport: {
						mainwpBridge: true,
						wpRemote: true,
						flywheel: false,
						wpEngine: false,
					},
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [
						{
							id: 'site-1',
							provider: 'mainwpBridge',
							name: 'Avenue941 MainWP',
							activeUrl: 'https://avenue941.com',
							urls: [ 'https://avenue941.com' ],
							capabilities: {
								pull: true,
								backupCreate: true,
								backupsRead: true,
							},
						},
						{
							id: 'site-2',
							provider: 'wpRemote',
							name: 'Avenue941 WP Remote',
							activeUrl: 'https://avenue941.com',
							urls: [ 'https://avenue941.com' ],
							capabilities: {
								pull: true,
								backupCreate: true,
								backupsRead: true,
							},
						},
					],
				} )
			);

		const result = await listBridgeSites( wpRemoteAccount );

		expect( result.sites ).toHaveLength( 1 );
		expect( result.sites[ 0 ] ).toMatchObject( {
			id: 'wpRemote:site-2',
			remoteSiteId: 'site-2',
			provider: 'wpRemote',
			name: 'Avenue941 WP Remote',
		} );
	} );

	it( 'keeps MainWP compatibility with older bridge payloads that omit provider', async () => {
		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
					routeSupport: {
						backupInventory: true,
						export: false,
					},
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [
						{
							id: 'site-1',
							name: 'Legacy MainWP Site',
							activeUrl: 'https://legacy.example.com',
							urls: [ 'https://legacy.example.com' ],
							capabilities: {
								pull: true,
								backupCreate: true,
								backupsRead: true,
							},
						},
					],
				} )
			);

		const result = await listBridgeSites( mainwpAccount );

		expect( result.sites[ 0 ] ).toMatchObject( {
			id: 'mainwpBridge:site-1',
			provider: 'mainwpBridge',
			name: 'Legacy MainWP Site',
		} );
	} );

	it( 'keeps MainWP account validation compatible with older bridges that omit providerSupport', async () => {
		const input: TestRemoteProviderAccountInput = {
			provider: 'mainwpBridge',
			bridgeUrl: 'https://bridge.example.com',
			readToken: 'read-token',
			mutateToken: 'write-token',
			tokenMode: 'split',
		};

		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [],
				} )
			);

		await expect( testBridgeAccountConnection( input ) ).resolves.toMatchObject( {
			health: expect.objectContaining( {
				ok: true,
			} ),
		} );
		expect( fetchMock ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'keeps MainWP account validation compatible when providerSupport omits the mainwpBridge key', async () => {
		const input: TestRemoteProviderAccountInput = {
			provider: 'mainwpBridge',
			bridgeUrl: 'https://bridge.example.com',
			readToken: 'read-token',
			mutateToken: 'write-token',
			tokenMode: 'split',
		};

		fetchMock
			.mockResolvedValueOnce(
				jsonResponse( {
					ok: true,
					providerSupport: {
						wpRemote: true,
						flywheel: false,
						wpEngine: false,
					},
				} )
			)
			.mockResolvedValueOnce(
				jsonResponse( {
					sites: [],
				} )
			);

		await expect( testBridgeAccountConnection( input ) ).resolves.toMatchObject( {
			health: expect.objectContaining( {
				ok: true,
				providerSupport: expect.objectContaining( {
					wpRemote: true,
				} ),
			} ),
		} );
		expect( fetchMock ).toHaveBeenCalledTimes( 2 );
	} );
} );
