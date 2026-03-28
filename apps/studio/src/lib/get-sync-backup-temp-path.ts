import crypto from 'node:crypto';
import { app } from 'electron';
import nodePath from 'path';

function toSafeBackupId( operationId: string ) {
	return crypto.createHash( 'sha256' ).update( operationId ).digest( 'hex' ).slice( 0, 24 );
}

export function getSyncBackupTempPath( operationId: string ) {
	const tmpDir = nodePath.join( app.getPath( 'temp' ), 'wp-studio-backups' );
	return nodePath.join( tmpDir, `site-${ toSafeBackupId( operationId ) }-backup.tar.gz` );
}
