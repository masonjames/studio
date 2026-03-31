import { z } from 'zod';

const bridgeBackedRemoteProviderSchema = z.enum( [
	'mainwpBridge',
	'wpRemote',
	'flywheel',
	'wpEngine',
] );

export const bridgeProviderSupportSchema = z
	.object( {
		mainwpBridge: z.boolean().default( false ),
		wpRemote: z.boolean().default( false ),
		flywheel: z.boolean().default( false ),
		wpEngine: z.boolean().default( false ),
	} )
	.partial();

export const bridgeRouteSupportSchema = z
	.object( {
		backupInventory: z.boolean().default( false ),
		backupDetail: z.boolean().default( false ),
		export: z.boolean().default( false ),
		restore: z.boolean().default( false ),
	} )
	.partial();

export const bridgeHealthResponseSchema = z
	.object( {
		ok: z.boolean(),
		providerSupport: bridgeProviderSupportSchema.optional(),
		routeSupport: bridgeRouteSupportSchema.optional(),
	} )
	.passthrough();

export const bridgeSiteCapabilitiesSchema = z
	.object( {
		pull: z.boolean().default( false ),
		push: z.boolean().default( false ),
		backupCreate: z.boolean().optional(),
		backupsRead: z.boolean().optional(),
		importCreate: z.boolean().optional(),
		restoreCreate: z.boolean().optional(),
	} )
	.passthrough();

export const publicBridgeSiteSchema = z
	.object( {
		id: z.string().min( 1 ),
		provider: bridgeBackedRemoteProviderSchema.optional(),
		name: z.string().min( 1 ),
		activeUrl: z.string().url(),
		urls: z.array( z.string().url() ).default( [] ),
		capabilities: bridgeSiteCapabilitiesSchema,
		metadata: z
			.object( {
				sourceRepo: z.string().optional(),
				image: z.string().optional(),
				notes: z.string().optional(),
			} )
			.optional(),
	} )
	.passthrough();

export const bridgeSitesResponseSchema = z.object( {
	sites: z.array( publicBridgeSiteSchema ),
} );

export const bridgeBackupManifestSchema = z
	.object( {
		id: z.string().min( 1 ),
		siteId: z.string().optional(),
		site_id: z.string().optional(),
		sourceJobId: z.string().min( 1 ),
		createdAt: z.string(),
		sizeBytes: z.number().optional(),
		status: z.string().optional(),
	} )
	.passthrough();

export const bridgeBackupsResponseSchema = z.object( {
	backups: z.array( bridgeBackupManifestSchema ),
} );

export const bridgeJobSchema = z
	.object( {
		id: z.string().uuid(),
		siteId: z.string().optional(),
		site_id: z.string().optional(),
		type: z.enum( [ 'backup', 'export', 'import', 'restore' ] ).optional(),
		status: z.enum( [ 'queued', 'running', 'completed', 'failed' ] ),
		progress: z
			.object( {
				percent: z.number().optional(),
				message: z.string().optional(),
			} )
			.optional(),
		artifactAvailable: z.boolean().optional(),
		artifact: z
			.object( {
				sizeBytes: z.number().optional(),
				fileName: z.string().optional(),
				contentType: z.string().optional(),
			} )
			.partial()
			.optional(),
		error: z
			.object( {
				code: z.string(),
				message: z.string(),
			} )
			.optional(),
	} )
	.passthrough();

export const bridgeJobResponseSchema = z.object( {
	job: bridgeJobSchema,
} );

export type BridgeHealthResponse = z.infer< typeof bridgeHealthResponseSchema >;
export type PublicBridgeSite = z.infer< typeof publicBridgeSiteSchema >;
export type BridgeBackupManifest = z.infer< typeof bridgeBackupManifestSchema >;
export type BridgeJob = z.infer< typeof bridgeJobSchema >;
