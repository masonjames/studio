import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { once } from 'node:events';
import { createInterface } from 'readline';

export type SqlLineTransform = ( line: string ) => string | null;

export async function rewriteSqlFileInPlace(
	filePath: string,
	transform: SqlLineTransform
): Promise< void > {
	const tempOutputPath = path.join(
		path.dirname( filePath ),
		`${ path.basename( filePath ) }.${ randomUUID() }.tmp`
	);
	const readStream = fs.createReadStream( filePath, 'utf8' );
	const writeStream = fs.createWriteStream( tempOutputPath, 'utf8' );
	const rl = createInterface( {
		input: readStream,
		crlfDelay: Infinity,
	} );

	const streamErrorPromise = new Promise< never >( ( _, reject ) => {
		const handleError = ( error: Error ) => reject( error );
		readStream.once( 'error', handleError );
		writeStream.once( 'error', handleError );
	} );

	try {
		await Promise.race( [
			(async () => {
				for await ( const line of rl ) {
					const transformedLine = transform( line );
					if ( transformedLine === null ) {
						continue;
					}

					if ( ! writeStream.write( `${ transformedLine }\n` ) ) {
						await once( writeStream, 'drain' );
					}
				}

				writeStream.end();
				await once( writeStream, 'finish' );
			})(),
			streamErrorPromise,
		] );

		await fs.promises.rename( tempOutputPath, filePath );
	} catch ( error ) {
		readStream.destroy();
		writeStream.destroy();
		await fs.promises.rm( tempOutputPath, { force: true } );
		throw error;
	} finally {
		rl.close();
	}
}
