import { SupportedLocale } from '@studio/common/lib/locale';
import { CheckboxControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from 'src/components/button';
import { isWindowsStore } from 'src/lib/app-globals';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ColorSchemePicker } from 'src/modules/user-settings/components/color-scheme-picker';
import { EditorPicker } from 'src/modules/user-settings/components/editor-picker';
import { LanguagePicker } from 'src/modules/user-settings/components/language-picker';
import { SettingsFormField } from 'src/modules/user-settings/components/settings-form-field';
import { StudioCliToggle } from 'src/modules/user-settings/components/studio-cli-toggle';
import { TerminalPicker } from 'src/modules/user-settings/components/terminal-picker';
import { SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';
import { SiteDirectoryPreferences } from 'src/modules/user-settings/user-settings-types';
import { useAppDispatch, useI18nLocale } from 'src/stores';
import { saveUserLocale } from 'src/stores/i18n-slice';
import {
	useGetColorSchemeQuery,
	useGetSiteDirectoryPreferencesQuery,
	useGetStudioCliIsInstalledQuery,
	useGetUserEditorQuery,
	useGetUserTerminalQuery,
	useSaveColorSchemeMutation,
	useSaveSiteDirectoryPreferencesMutation,
	useSaveStudioCliIsInstalledMutation,
	useSaveUserEditorMutation,
	useSaveUserTerminalMutation,
} from 'src/stores/installed-apps-api';

export const PreferencesTab = ( { onClose }: { onClose: () => void } ) => {
	const { __ } = useI18n();
	const savedLocale = useI18nLocale();
	const dispatch = useAppDispatch();

	const { data: colorScheme } = useGetColorSchemeQuery();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const { data: isCliInstalled } = useGetStudioCliIsInstalledQuery();
	const { data: siteDirectoryPreferences } = useGetSiteDirectoryPreferencesQuery();

	const [ saveColorSchemePreference ] = useSaveColorSchemeMutation();
	const [ saveEditor ] = useSaveUserEditorMutation();
	const [ saveTerminal ] = useSaveUserTerminalMutation();
	const [ saveCliIsInstalled ] = useSaveStudioCliIsInstalledMutation();
	const [ saveSiteDirectoryPreferences ] = useSaveSiteDirectoryPreferencesMutation();

	const [ dirtyColorScheme, setDirtyColorScheme ] = useState< 'system' | 'light' | 'dark' >();
	const [ dirtyLocale, setDirtyLocale ] = useState< SupportedLocale >();
	const [ dirtyEditor, setDirtyEditor ] = useState< SupportedEditor | null >();
	const [ dirtyTerminal, setDirtyTerminal ] = useState< SupportedTerminal >();
	const [ dirtyIsCliInstalled, setDirtyIsCliInstalled ] = useState< boolean >();
	const [ dirtySiteDirectoryPreferences, setDirtySiteDirectoryPreferences ] =
		useState< SiteDirectoryPreferences >();
	const [ siteDirectoryError, setSiteDirectoryError ] = useState( '' );

	const wasSavedRef = useRef( false );
	const dirtyColorSchemeRef = useRef( dirtyColorScheme );
	const savedColorSchemeRef = useRef( colorScheme );

	useEffect( () => {
		dirtyColorSchemeRef.current = dirtyColorScheme;
	}, [ dirtyColorScheme ] );

	useEffect( () => {
		savedColorSchemeRef.current = colorScheme;
	}, [ colorScheme ] );

	// Revert color scheme preview on unmount if not saved (handles Escape, click outside)
	useEffect( () => {
		return () => {
			if ( ! wasSavedRef.current && dirtyColorSchemeRef.current ) {
				void getIpcApi().previewColorScheme( savedColorSchemeRef.current ?? 'light' );
			}
		};
	}, [] );

	const handleColorSchemeChange = useCallback( ( scheme: 'system' | 'light' | 'dark' ) => {
		setDirtyColorScheme( scheme );
		void getIpcApi().previewColorScheme( scheme );
	}, [] );

	const updateSiteDirectoryPreferences = useCallback(
		( update: Partial< SiteDirectoryPreferences > ) => {
			setDirtySiteDirectoryPreferences( ( current ) => ( {
				sitesDirectoryPath:
					update.sitesDirectoryPath ??
					current?.sitesDirectoryPath ??
					siteDirectoryPreferences?.sitesDirectoryPath ??
					'',
				useSiteNameAsFolder:
					update.useSiteNameAsFolder ??
					current?.useSiteNameAsFolder ??
					siteDirectoryPreferences?.useSiteNameAsFolder ??
					false,
			} ) );
		},
		[ siteDirectoryPreferences?.sitesDirectoryPath, siteDirectoryPreferences?.useSiteNameAsFolder ]
	);

	const siteDirectorySelection =
		dirtySiteDirectoryPreferences?.sitesDirectoryPath ??
		siteDirectoryPreferences?.sitesDirectoryPath ??
		'';
	const useSiteNameAsFolderSelection =
		dirtySiteDirectoryPreferences?.useSiteNameAsFolder ??
		siteDirectoryPreferences?.useSiteNameAsFolder ??
		false;

	const hasSiteDirectoryPreferenceChanges =
		dirtySiteDirectoryPreferences !== undefined &&
		( dirtySiteDirectoryPreferences.sitesDirectoryPath !==
			siteDirectoryPreferences?.sitesDirectoryPath ||
			dirtySiteDirectoryPreferences.useSiteNameAsFolder !==
				siteDirectoryPreferences?.useSiteNameAsFolder );

	const handleSelectSiteDirectory = useCallback( async () => {
		const response = await getIpcApi().showOpenFolderDialog(
			__( 'Choose folder for new sites' ),
			siteDirectorySelection
		);

		if ( response?.path ) {
			if ( response.isWordPress ) {
				setSiteDirectoryError(
					__(
						'Please choose a folder that will contain your Studio sites, not an existing WordPress installation.'
					)
				);
				return;
			}
			setSiteDirectoryError( '' );
			updateSiteDirectoryPreferences( { sitesDirectoryPath: response.path } );
		}
	}, [ __, siteDirectorySelection, updateSiteDirectoryPreferences ] );

	const savePreferences = async () => {
		wasSavedRef.current = true;
		if ( dirtyColorScheme ) {
			await saveColorSchemePreference( dirtyColorScheme );
		}
		if ( dirtyLocale ) {
			await dispatch( saveUserLocale( dirtyLocale ) );
		}
		if ( dirtyEditor ) {
			await saveEditor( dirtyEditor );
		}
		if ( dirtyTerminal ) {
			await saveTerminal( dirtyTerminal );
		}
		if ( dirtyIsCliInstalled !== undefined ) {
			await saveCliIsInstalled( dirtyIsCliInstalled );
		}
		if ( hasSiteDirectoryPreferenceChanges && dirtySiteDirectoryPreferences ) {
			await saveSiteDirectoryPreferences( dirtySiteDirectoryPreferences );
		}
		onClose();
	};

	const colorSchemeSelection = dirtyColorScheme ?? colorScheme ?? 'light';
	const localeSelection = dirtyLocale ?? savedLocale ?? 'en';
	const editorSelection = dirtyEditor ?? editor ?? 'vscode';
	const terminalSelection = dirtyTerminal ?? terminal ?? 'terminal';
	const isCliInstalledSelection = dirtyIsCliInstalled ?? isCliInstalled ?? false;

	const hasChanges =
		[
			[ dirtyColorScheme, colorScheme ],
			[ dirtyLocale, savedLocale ],
			[ dirtyEditor, editor ],
			[ dirtyTerminal, terminal ],
			[ dirtyIsCliInstalled, isCliInstalled ],
		].some( ( [ a, b ] ) => a !== undefined && a !== b ) || hasSiteDirectoryPreferenceChanges;

	return (
		<>
			<ColorSchemePicker value={ colorSchemeSelection } onChange={ handleColorSchemeChange } />
			<LanguagePicker value={ localeSelection } onChange={ setDirtyLocale } />
			<SettingsFormField label={ __( 'New site directory' ) }>
				<div className="flex flex-col gap-2">
					<div className="min-h-10 rounded-sm border border-frame-border px-3 py-3 text-sm break-all">
						{ siteDirectorySelection }
					</div>
					<div>
						<Button
							variant="secondary"
							onClick={ handleSelectSiteDirectory }
							data-testid="site-directory-picker-button"
						>
							{ __( 'Choose folder' ) }
						</Button>
					</div>
					<div className="a8c-body-small text-frame-text-secondary">
						{ __(
							'New sites will be created inside this folder. Existing sites stay where they are.'
						) }
					</div>
					{ siteDirectoryError && (
						<div className="text-xs text-red-500" role="alert">
							{ siteDirectoryError }
						</div>
					) }
				</div>
			</SettingsFormField>
			<SettingsFormField label={ __( 'Folder naming' ) }>
				<CheckboxControl
					checked={ useSiteNameAsFolderSelection }
					onChange={ ( value ) => updateSiteDirectoryPreferences( { useSiteNameAsFolder: value } ) }
					label={ __( 'Use site name for new folder names' ) }
					help={ __(
						'Create folders with the current site name, such as LovingHands or Avenue941.'
					) }
				/>
			</SettingsFormField>
			<div className="grid grid-cols-2 gap-3">
				<EditorPicker
					value={ editorSelection }
					onChange={ setDirtyEditor }
					disabled={ editor === undefined }
				/>
				<TerminalPicker value={ terminalSelection } onChange={ setDirtyTerminal } />
			</div>
			{ ! isWindowsStore() && (
				<StudioCliToggle value={ isCliInstalledSelection } onChange={ setDirtyIsCliInstalled } />
			) }
			<div className="mt-auto pt-2 flex justify-end gap-3">
				<Button
					variant="tertiary"
					onClick={ () => onClose() }
					data-testid="preferences-cancel-button"
				>
					{ __( 'Cancel' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ savePreferences }
					disabled={ ! hasChanges }
					data-testid="preferences-save-button"
				>
					{ __( 'Save' ) }
				</Button>
			</div>
		</>
	);
};
