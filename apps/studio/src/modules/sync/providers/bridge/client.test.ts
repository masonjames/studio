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

	it( 'rejects site payloads that do not match the selected provider', async () => {
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
							provider: 'flywheel',
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

		await expect( listBridgeSites( mainwpAccount ) ).rejects.toThrow(
			'The bridge returned site "site-1" for provider "flywheel" while "mainwpBridge" was expected.'
		);
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
} );
