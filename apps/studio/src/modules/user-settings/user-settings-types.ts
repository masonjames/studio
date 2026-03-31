export interface SiteDirectoryPreferences {
	sitesDirectoryPath: string;
	useSiteNameAsFolder: boolean;
}

export type UserSettingsTabName = 'general' | 'skills' | 'account' | 'mcp';
export type UserSettingsTab = {
	name: UserSettingsTabName;
	title: string;
};
