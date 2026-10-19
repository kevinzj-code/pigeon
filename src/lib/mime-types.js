/* mime-types.js — the file extensions worth knowing, and what they are.
 *
 * Bundled and dated: the IANA registry grows (avif and wasm are recent), and a
 * lookup table that presents itself as permanent is misrepresenting what it is.
 *
 * `kind` is the coarse grouping people actually reason with — "is this an
 * image" is asked far more often than the exact subtype.
 */

export const MIME_AS_OF = '2026-08-29';

export const MIME_TYPES = {
  'html': { mime: 'text/html', label: 'Web page', kind: 'text' },
  'htm': { mime: 'text/html', label: 'Web page', kind: 'text' },
  'css': { mime: 'text/css', label: 'Stylesheet', kind: 'text' },
  'js': { mime: 'text/javascript', label: 'JavaScript', kind: 'text' },
  'mjs': { mime: 'text/javascript', label: 'JavaScript module', kind: 'text' },
  'json': { mime: 'application/json', label: 'JSON data', kind: 'text' },
  'xml': { mime: 'application/xml', label: 'XML document', kind: 'text' },
  'csv': { mime: 'text/csv', label: 'Comma-separated values', kind: 'text' },
  'tsv': { mime: 'text/tab-separated-values', label: 'Tab-separated values', kind: 'text' },
  'txt': { mime: 'text/plain', label: 'Plain text', kind: 'text' },
  'md': { mime: 'text/markdown', label: 'Markdown', kind: 'text' },
  'yaml': { mime: 'application/yaml', label: 'YAML', kind: 'text' },
  'yml': { mime: 'application/yaml', label: 'YAML', kind: 'text' },
  'toml': { mime: 'application/toml', label: 'TOML', kind: 'text' },
  'svg': { mime: 'image/svg+xml', label: 'Scalable vector image', kind: 'image' },
  'png': { mime: 'image/png', label: 'PNG image', kind: 'image' },
  'jpg': { mime: 'image/jpeg', label: 'JPEG image', kind: 'image' },
  'jpeg': { mime: 'image/jpeg', label: 'JPEG image', kind: 'image' },
  'gif': { mime: 'image/gif', label: 'GIF image', kind: 'image' },
  'webp': { mime: 'image/webp', label: 'WebP image', kind: 'image' },
  'avif': { mime: 'image/avif', label: 'AVIF image', kind: 'image' },
  'ico': { mime: 'image/vnd.microsoft.icon', label: 'Icon', kind: 'image' },
  'bmp': { mime: 'image/bmp', label: 'Bitmap image', kind: 'image' },
  'tiff': { mime: 'image/tiff', label: 'TIFF image', kind: 'image' },
  'mp3': { mime: 'audio/mpeg', label: 'MP3 audio', kind: 'audio' },
  'wav': { mime: 'audio/wav', label: 'WAV audio', kind: 'audio' },
  'ogg': { mime: 'audio/ogg', label: 'Ogg audio', kind: 'audio' },
  'flac': { mime: 'audio/flac', label: 'FLAC audio', kind: 'audio' },
  'm4a': { mime: 'audio/mp4', label: 'MPEG-4 audio', kind: 'audio' },
  'mp4': { mime: 'video/mp4', label: 'MP4 video', kind: 'video' },
  'webm': { mime: 'video/webm', label: 'WebM video', kind: 'video' },
  'mov': { mime: 'video/quicktime', label: 'QuickTime video', kind: 'video' },
  'avi': { mime: 'video/x-msvideo', label: 'AVI video', kind: 'video' },
  'mkv': { mime: 'video/x-matroska', label: 'Matroska video', kind: 'video' },
  'pdf': { mime: 'application/pdf', label: 'PDF document', kind: 'document' },
  'doc': { mime: 'application/msword', label: 'Word document', kind: 'document' },
  'docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document', kind: 'document' },
  'xls': { mime: 'application/vnd.ms-excel', label: 'Excel spreadsheet', kind: 'document' },
  'xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel spreadsheet', kind: 'document' },
  'ppt': { mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint presentation', kind: 'document' },
  'pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint presentation', kind: 'document' },
  'odt': { mime: 'application/vnd.oasis.opendocument.text', label: 'OpenDocument text', kind: 'document' },
  'zip': { mime: 'application/zip', label: 'Zip archive', kind: 'archive' },
  'gz': { mime: 'application/gzip', label: 'Gzip archive', kind: 'archive' },
  'tar': { mime: 'application/x-tar', label: 'Tar archive', kind: 'archive' },
  '7z': { mime: 'application/x-7z-compressed', label: '7-Zip archive', kind: 'archive' },
  'rar': { mime: 'application/vnd.rar', label: 'RAR archive', kind: 'archive' },
  'woff': { mime: 'font/woff', label: 'Web font', kind: 'font' },
  'woff2': { mime: 'font/woff2', label: 'Web font', kind: 'font' },
  'ttf': { mime: 'font/ttf', label: 'TrueType font', kind: 'font' },
  'otf': { mime: 'font/otf', label: 'OpenType font', kind: 'font' },
  'wasm': { mime: 'application/wasm', label: 'WebAssembly module', kind: 'binary' },
  'sqlite': { mime: 'application/vnd.sqlite3', label: 'SQLite database', kind: 'binary' },
  'gguf': { mime: 'application/octet-stream', label: 'Model weights', kind: 'binary' }
};

/* mime -> extensions, derived rather than typed twice. Several extensions share
   a type (jpg/jpeg, yaml/yml), so the value is a list. */
export const BY_MIME = Object.entries(MIME_TYPES).reduce((acc, [ext, info]) => {
  (acc[info.mime] ??= []).push(ext);
  return acc;
}, {});
