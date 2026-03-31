const LATIN = 'a-z';
const CYRILLIC = 'а-яё';
const ARABIC = '\\u0600-\\u06FF';
const HEBREW = '\\u0590-\\u05FF';
const CHINESE = '\\u4e00-\\u9fa5';
const JAPANESE_HIRAGANA = '\\u3040-\\u309F';
const JAPANESE_KATAKANA = '\\u30A0-\\u30FF';
const KOREAN_HANGUL = '\\uAC00-\\uD7AF';
const KOREAN_JAMO = '\\u1100-\\u11FF'; // Hangul syllables are decomposed to Jamo letters
const NUMBERS = '0-9';
const WHITELISTED_SYMBOLS = '_\\- '; // Allow underscore, hyphen, and space

const ALLOWED_CHARS = new RegExp(
	`[^${ LATIN }${ NUMBERS }${ CYRILLIC }${ ARABIC }${ HEBREW }${ CHINESE }${ JAPANESE_HIRAGANA }${ JAPANESE_KATAKANA }${ KOREAN_HANGUL }${ KOREAN_JAMO }${ WHITELISTED_SYMBOLS }]`,
	'gi'
);

function normalizeFolderName( filename: string ) {
	return String( filename )
		.replace( /ł/g, 'l' ) // Polish ł to l
		.replace( /Ł/g, 'L' ) // Polish Ł to L
		.normalize( 'NFKD' )
		.replace( /[\u0300-\u036f]/g, '' ) // Remove diacritics
		.replace( ALLOWED_CHARS, '' )
		.trim();
}

export const sanitizeFolderName = ( filename: string ) => {
	return normalizeFolderName( filename )
		.toLowerCase()
		.replace( /\s+/g, '-' ) // Replace spaces with hyphens
		.replace( /-+/g, '-' ); // Replace multiple hyphens with a single one
};

export const sanitizeSiteNameAsFolderName = ( filename: string ) => {
	return normalizeFolderName( filename )
		.replace( /\s+/g, ' ' ) // Collapse multiple spaces while preserving the site name format
		.replace( /-+/g, '-' );
};
