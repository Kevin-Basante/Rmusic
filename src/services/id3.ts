/**
 * Minimal ID3v2 tag reader (title, artist, album and cover picture)
 * so local MP3 files show real metadata instead of only the file name.
 */
export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  cover?: Blob;
}

export async function readTags(file: Blob): Promise<AudioTags> {
  try {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    // "ID3" signature
    if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return {};
    const version = header[3];
    if (version < 3) return {};
    const tagSize = syncSafe(header, 6);
    const data = new Uint8Array(await file.slice(10, 10 + tagSize).arrayBuffer());
    const tags: AudioTags = {};

    let offset = 0;
    if (header[5] & 0x40) {
      // Extended header present: skip it.
      offset = version === 4 ? syncSafe(data, 0) : readUint32(data, 0) + 4;
    }

    while (offset + 10 <= data.length) {
      const id = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = version === 4 ? syncSafe(data, offset + 4) : readUint32(data, offset + 4);
      const body = data.subarray(offset + 10, offset + 10 + size);
      offset += 10 + size;
      if (size <= 0) continue;

      if (id === 'TIT2') tags.title = decodeText(body);
      else if (id === 'TPE1') tags.artist = decodeText(body);
      else if (id === 'TALB') tags.album = decodeText(body);
      else if (id === 'APIC' && !tags.cover) tags.cover = readPicture(body);
    }
    return tags;
  } catch {
    return {};
  }
}

function syncSafe(bytes: Uint8Array, start: number): number {
  return (bytes[start] << 21) | (bytes[start + 1] << 14) | (bytes[start + 2] << 7) | bytes[start + 3];
}

function readUint32(bytes: Uint8Array, start: number): number {
  return ((bytes[start] << 24) | (bytes[start + 1] << 16) | (bytes[start + 2] << 8) | bytes[start + 3]) >>> 0;
}

function decoderFor(encoding: number): TextDecoder {
  if (encoding === 1) return new TextDecoder('utf-16');
  if (encoding === 2) return new TextDecoder('utf-16be');
  if (encoding === 3) return new TextDecoder('utf-8');
  return new TextDecoder('iso-8859-1');
}

function decodeText(body: Uint8Array): string {
  return decoderFor(body[0]).decode(body.subarray(1)).replace(/\0/g, '').trim();
}

function readPicture(body: Uint8Array): Blob | undefined {
  const encoding = body[0];
  let i = 1;
  // MIME type (ends with a 0 byte)
  const mimeEnd = body.indexOf(0, i);
  const mime = new TextDecoder('iso-8859-1').decode(body.subarray(i, mimeEnd)) || 'image/jpeg';
  i = mimeEnd + 1;
  i += 1; // picture type
  // Description (0 terminated; 2 bytes for UTF-16)
  if (encoding === 1 || encoding === 2) {
    while (i + 1 < body.length && !(body[i] === 0 && body[i + 1] === 0)) i += 2;
    i += 2;
  } else {
    while (i < body.length && body[i] !== 0) i++;
    i += 1;
  }
  if (i >= body.length) return undefined;
  const type = mime.includes('/') ? mime : `image/${mime.toLowerCase()}`;
  return new Blob([body.slice(i)], { type });
}
