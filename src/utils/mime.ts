/**
 * MIME type utilities.
 * Handles MIME type detection and file extension mapping.
 */

import mime from 'mime-types';

/**
 * Get MIME type from file extension.
 */
export function getMimeType(filename: string): string {
  return mime.lookup(filename) || 'application/octet-stream';
}

/**
 * Get file extension from MIME type.
 */
export function getExtension(mimeType: string): string {
  return mime.extension(mimeType) || 'bin';
}

/**
 * Get content type header value (includes charset for text types).
 */
export function getContentType(filename: string): string {
  return mime.contentType(filename) || 'application/octet-stream';
}

/**
 * Check if MIME type is for a text file.
 */
export function isTextType(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript' ||
    mimeType === 'application/typescript' ||
    mimeType === 'application/x-yaml' ||
    mimeType === 'application/x-sh'
  );
}

/**
 * Check if MIME type is for an image.
 */
export function isImageType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * Check if MIME type is for a video.
 */
export function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * Check if MIME type is for audio.
 */
export function isAudioType(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

/**
 * Check if MIME type is for a document (PDF, Word, etc.).
 */
export function isDocumentType(mimeType: string): boolean {
  const documentTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/rtf',
  ];
  return documentTypes.includes(mimeType);
}

/**
 * Check if MIME type is for an archive.
 */
export function isArchiveType(mimeType: string): boolean {
  const archiveTypes = [
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
    'application/x-bzip2',
  ];
  return archiveTypes.includes(mimeType);
}

/**
 * Check if MIME type is for code/source files.
 */
export function isCodeType(mimeType: string): boolean {
  const codeTypes = [
    'text/javascript',
    'application/javascript',
    'text/typescript',
    'application/typescript',
    'text/x-python',
    'text/x-java-source',
    'text/x-c',
    'text/x-c++',
    'text/x-csharp',
    'text/x-go',
    'text/x-rust',
    'text/x-ruby',
    'text/x-php',
    'text/html',
    'text/css',
    'application/json',
    'application/xml',
    'text/xml',
    'application/x-yaml',
    'text/x-yaml',
  ];
  return codeTypes.includes(mimeType);
}

/**
 * Get a user-friendly category for a MIME type.
 */
export function getCategory(mimeType: string): string {
  if (isImageType(mimeType)) return 'image';
  if (isVideoType(mimeType)) return 'video';
  if (isAudioType(mimeType)) return 'audio';
  if (isDocumentType(mimeType)) return 'document';
  if (isArchiveType(mimeType)) return 'archive';
  if (isCodeType(mimeType)) return 'code';
  if (isTextType(mimeType)) return 'text';
  return 'file';
}

/**
 * Get icon name for a MIME type (for UI display).
 */
export function getIconName(mimeType: string): string {
  const category = getCategory(mimeType);
  const iconMap: Record<string, string> = {
    image: 'image',
    video: 'video',
    audio: 'music',
    document: 'file-text',
    archive: 'archive',
    code: 'code',
    text: 'file-text',
    file: 'file',
  };
  return iconMap[category] || 'file';
}

/**
 * Common MIME types for file pickers/filters.
 */
export const CommonMimeTypes = {
  // Images
  images: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
  ],

  // Documents
  documents: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],

  // Videos
  videos: [
    'video/mp4',
    'video/mpeg',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
  ],

  // Audio
  audio: [
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/aac',
  ],

  // Archives
  archives: [
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
  ],

  // Text
  text: [
    'text/plain',
    'text/html',
    'text/css',
    'text/csv',
    'text/markdown',
    'application/json',
    'application/xml',
  ],

  // Google Drive native types
  googleDrive: {
    document: 'application/vnd.google-apps.document',
    spreadsheet: 'application/vnd.google-apps.spreadsheet',
    presentation: 'application/vnd.google-apps.presentation',
    folder: 'application/vnd.google-apps.folder',
    form: 'application/vnd.google-apps.form',
    drawing: 'application/vnd.google-apps.drawing',
    site: 'application/vnd.google-apps.site',
  },
};

/**
 * Map Google Drive export MIME types to download formats.
 */
export const GoogleDriveExportTypes: Record<string, Record<string, string>> = {
  'application/vnd.google-apps.document': {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    html: 'text/html',
    rtf: 'application/rtf',
    odt: 'application/vnd.oasis.opendocument.text',
  },
  'application/vnd.google-apps.spreadsheet': {
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
  },
  'application/vnd.google-apps.presentation': {
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odp: 'application/vnd.oasis.opendocument.presentation',
  },
  'application/vnd.google-apps.drawing': {
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
  },
};

/**
 * Check if a Google Drive type needs export.
 */
export function isGoogleDriveType(mimeType: string): boolean {
  return mimeType.startsWith('application/vnd.google-apps.');
}

/**
 * Get available export formats for a Google Drive type.
 */
export function getGoogleDriveExportFormats(mimeType: string): string[] {
  const exports = GoogleDriveExportTypes[mimeType];
  return exports ? Object.keys(exports) : [];
}

/**
 * Get the export MIME type for a Google Drive type and format.
 */
export function getGoogleDriveExportMimeType(
  mimeType: string,
  format: string
): string | null {
  const exports = GoogleDriveExportTypes[mimeType];
  return exports?.[format] || null;
}
