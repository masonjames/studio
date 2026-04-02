import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { once } from 'node:events';
import { createInterface } from 'readline';

const DEFAULT_MAX_ROWS_PER_STATEMENT = 500;
const DEFAULT_MAX_BYTES_PER_STATEMENT = 256 * 1024;
const INSERT_HEADER_PATTERN = /^\s*INSERT(?:\s+IGNORE)?\s+INTO\s+.+\s+VALUES\s*$/i;
const UNSUPPORTED_INSERT_PATTERN = /\b(REPLACE\s+INTO|ON\s+DUPLICATE\s+KEY\s+UPDATE|INSERT\s+.+\s+SELECT)\b/i;

export interface InsertBatchingOptions {
	maxRowsPerStatement?: number;
	maxBytesPerStatement?: number;
}

interface BufferedInsertStatement {
	header: string;
	rawLines: string[];
	rows: string[];
	canSplit: boolean;
}

export async function batchJetpackExtendedInsertsInPlace(
	filePath: string,
	options: InsertBatchingOptions = {}
): Promise< void > {
	const maxRowsPerStatement =
		options.maxRowsPerStatement ?? DEFAULT_MAX_ROWS_PER_STATEMENT;
	const maxBytesPerStatement =
		options.maxBytesPerStatement ?? DEFAULT_MAX_BYTES_PER_STATEMENT;
	const tempOutputPath = path.join(
		path.dirname( filePath ),
		`${ path.basename( filePath ) }.${ randomUUID() }.insert-batching.tmp`
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

	const writeChunk = async ( chunk: string ) => {
		if ( ! writeStream.write( chunk ) ) {
			await once( writeStream, 'drain' );
		}
	};

	let currentInsert: BufferedInsertStatement | null = null;

	const flushCurrentInsert = async () => {
		if ( ! currentInsert ) {
			return;
		}

		await writeChunk(
			rewriteBufferedInsertStatement(
				currentInsert,
				maxRowsPerStatement,
				maxBytesPerStatement
			)
		);
		currentInsert = null;
	};

	try {
		await Promise.race( [
			(async () => {
				for await ( const line of rl ) {
					const lineWithNewline = `${ line }\n`;

					if ( ! currentInsert ) {
						if ( isSupportedInsertHeader( line ) ) {
							currentInsert = {
								header: line,
								rawLines: [ lineWithNewline ],
								rows: [],
								canSplit: true,
							};
							continue;
						}

						await writeChunk( lineWithNewline );
						continue;
					}

					currentInsert.rawLines.push( lineWithNewline );

					const trimmedLine = line.trim();
					const isRowLine =
						trimmedLine.startsWith( '(' ) &&
						( trimmedLine.endsWith( ',' ) || trimmedLine.endsWith( ';' ) );

					if ( isRowLine ) {
						currentInsert.rows.push( line );
					} else if ( trimmedLine.length > 0 ) {
						currentInsert.canSplit = false;
					}

					if ( trimmedLine.endsWith( ';' ) ) {
						await flushCurrentInsert();
					}
				}

				await flushCurrentInsert();
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

function isSupportedInsertHeader( line: string ): boolean {
	return INSERT_HEADER_PATTERN.test( line ) && ! UNSUPPORTED_INSERT_PATTERN.test( line );
}

function rewriteBufferedInsertStatement(
	bufferedStatement: BufferedInsertStatement,
	maxRowsPerStatement: number,
	maxBytesPerStatement: number
): string {
	const originalStatement = bufferedStatement.rawLines.join( '' );

	if ( ! bufferedStatement.canSplit || bufferedStatement.rows.length === 0 ) {
		return originalStatement;
	}

	const rowBatches = buildInsertRowBatches(
		bufferedStatement.header,
		bufferedStatement.rows,
		maxRowsPerStatement,
		maxBytesPerStatement
	);

	if ( rowBatches.length <= 1 ) {
		return originalStatement;
	}

	return rowBatches
		.map( ( rows ) => formatInsertStatement( bufferedStatement.header, rows ) )
		.join( '\n' );
}

function buildInsertRowBatches(
	header: string,
	rows: string[],
	maxRowsPerStatement: number,
	maxBytesPerStatement: number
): string[][] {
	const batches: string[][] = [];
	let currentBatch: string[] = [];
	let currentBatchBytes = Buffer.byteLength( `${ header }\n` );

	const flushBatch = () => {
		if ( currentBatch.length === 0 ) {
			return;
		}

		batches.push( currentBatch );
		currentBatch = [];
		currentBatchBytes = Buffer.byteLength( `${ header }\n` );
	};

	for ( const row of rows ) {
		const normalizedRow = row.trimEnd();
		const rowBytes = Buffer.byteLength( `${ stripRowTerminator( normalizedRow ) }\n` );
		const reachedRowLimit = currentBatch.length >= maxRowsPerStatement;
		const reachedByteLimit =
			currentBatch.length > 0 && currentBatchBytes + rowBytes > maxBytesPerStatement;

		if ( reachedRowLimit || reachedByteLimit ) {
			flushBatch();
		}

		currentBatch.push( normalizedRow );
		currentBatchBytes += rowBytes;
	}

	flushBatch();

	return batches;
}

function formatInsertStatement( header: string, rows: string[] ): string {
	const formattedRows = rows.map( ( row, index ) => {
		const suffix = index === rows.length - 1 ? ';' : ',';
		return `${ stripRowTerminator( row ) }${ suffix }`;
	} );

	return `${ header }\n${ formattedRows.join( '\n' ) }\n`;
}

function stripRowTerminator( row: string ): string {
	return row.replace( /[;,]\s*$/, '' );
}
