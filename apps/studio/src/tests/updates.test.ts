import { beforeEach, describe, expect, it, vi } from 'vitest';

const setFeedURL = vi.fn();
const checkForUpdates = vi.fn();
const on = vi.fn();

async function loadUpdatesModule( releaseConfig: {
	updaterBaseUrl: string | null;
	autoUpdatesEnabled: boolean;
} ) {
	vi.resetModules();
	setFeedURL.mockReset();
	checkForUpdates.mockReset();
	on.mockReset();

	vi.doMock( 'electron', () => ( {
		app: {
			getVersion: vi.fn( () => '1.7.7' ),
			isPackaged: true,
			getPath: vi.fn( () => '/Applications/Studio.app' ),
			isInApplicationsFolder: vi.fn( () => true ),
		},
		autoUpdater: {
			setFeedURL,
			checkForUpdates,
			on,
			getFeedURL: vi.fn( () => '' ),
			quitAndInstall: vi.fn(),
		},
		dialog: {
			showMessageBox: vi.fn(),
		},
	} ) );
	vi.doMock( 'src/release-config', () => ( {
		default: releaseConfig,
	} ) );
	vi.doMock( 'src/main-window', () => ( {
		getMainWindow: vi.fn(),
	} ) );

	return import( 'src/updates' );
}

describe( 'updates release config', () => {
	beforeEach( () => {
		process.env.NODE_ENV = 'production';
	} );

	it( 'disables updater setup when auto updates are disabled in release config', async () => {
		const updates = await loadUpdatesModule( {
			updaterBaseUrl: null,
			autoUpdatesEnabled: false,
		} );

		updates.setupUpdates();

		expect( updates.getAutoUpdaterState() ).toBe( 'done' );
		expect( setFeedURL ).not.toHaveBeenCalled();
		expect( checkForUpdates ).not.toHaveBeenCalled();
	} );

	it( 'uses the configured updater base url when one is provided', async () => {
		const updates = await loadUpdatesModule( {
			updaterBaseUrl: 'https://updates.masonjames.com/studio',
			autoUpdatesEnabled: true,
		} );

		updates.setupUpdates();

		expect( setFeedURL ).toHaveBeenCalledTimes( 1 );
		expect( setFeedURL ).toHaveBeenCalledWith( {
			url: `https://updates.masonjames.com/studio?platform=${ process.platform }&studioArch=${ process.arch }&version=1.7.7`,
		} );
		expect( checkForUpdates ).toHaveBeenCalledTimes( 1 );
	} );
} );
