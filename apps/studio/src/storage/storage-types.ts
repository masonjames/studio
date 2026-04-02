import { StatsMetric } from 'src/lib/bump-stats';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import type {
	PersistedProviderPullRecord,
	RemoteProviderAccount,
	SyncSite,
} from 'src/modules/sync/types';
import type { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';

export interface WindowBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	isFullScreen?: boolean;
}

export interface AppdataSiteData {
	themeDetails?: SiteDetails[ 'themeDetails' ];
	sortOrder?: number;
}

export interface UserData {
	version: 2;
	siteMetadata: Record< string, AppdataSiteData >;
	devToolsOpen?: boolean;
	windowBounds?: WindowBounds;
	onboardingCompleted?: boolean;
	lastBumpStats?: Record< string, Partial< Record< StatsMetric, number > > >;
	promptWindowsSpeedUpResult?: PromptWindowsSpeedUpResult;
	connectedRemoteSites?: SyncSite[];
	connectedWpcomSites?: { [ userId: number ]: SyncSite[] };
	remoteProviderAccounts?: RemoteProviderAccount[];
	providerPullOperations?: Record< string, PersistedProviderPullRecord >;
	sentryUserId?: string;
	lastSeenVersion?: string;
	preferredTerminal?: SupportedTerminal;
	preferredEditor?: SupportedEditor;
	colorScheme?: 'system' | 'light' | 'dark';
	sitesDirectoryPath?: string;
	useSiteNameAsFolder?: boolean;
	betaFeatures?: BetaFeatures;
	stopSitesOnQuit?: boolean;
}

export interface PromptWindowsSpeedUpResult {
	response: 'yes' | 'no';
	appVersion: string;
	dontAskAgain: boolean;
}

export const EMPTY_USER_DATA: UserData = {
	version: 2,
	siteMetadata: {},
	connectedRemoteSites: [],
	remoteProviderAccounts: [],
	providerPullOperations: {},
};
