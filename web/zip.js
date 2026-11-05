// The XLSX container uses ZIP32. The browser supplies the raw DEFLATE codec.
const zipSignatures = { file: 0x04034b50, directory: 0x02014b50, end: 0x06054b50 };
const zipMax = 0xffffffff;
const zipDecoder = new TextDecoder();
const zipEncoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function updateCrc(crc, bytes) {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return crc;
}

async function zipCrc(blob) {
  let crc = -1;
  for await (const chunk of blob.stream()) crc = updateCrc(crc, chunk);
  return (crc ^ -1) >>> 0;
}

function zipHeader(length, signature) {
  const bytes = new DataView(new ArrayBuffer(length));
  bytes.setUint32(0, signature, true);
  return bytes;
}

class ZipArchive {
  static async open(file) {
    const tail = new DataView(await file.slice(Math.max(0, file.size - 65557)).arrayBuffer());
    let end = tail.byteLength - 22;
    while (end >= 0 && (tail.getUint32(end, true) !== zipSignatures.end ||
      tail.getUint16(end + 20, true) !== tail.byteLength - end - 22)) end--;
    if (end < 0) throw new Error("This file is not a valid XLSX ZIP archive.");
    const count = tail.getUint16(end + 10, true);
    const size = tail.getUint32(end + 12, true);
    const offset = tail.getUint32(end + 16, true);
    if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true) ||
        count === 65535 || offset === zipMax || size > 64 * 1024 * 1024 || offset + size > file.size) {
      throw new Error("This ZIP archive layout is unsupported.");
    }
    const directory = new DataView(await file.slice(offset, offset + size).arrayBuffer());
    const entries = new Map();
    let position = 0;
    for (let index = 0; index < count; index++) {
      if (position + 46 > size || directory.getUint32(position, true) !== zipSignatures.directory) {
        throw new Error("The XLSX ZIP directory is damaged.");
      }
      const flags = directory.getUint16(position + 8, true);
      const method = directory.getUint16(position + 10, true);
      const crc = directory.getUint32(position + 16, true);
      const compressed = directory.getUint32(position + 20, true);
      const length = directory.getUint32(position + 24, true);
      const nameLength = directory.getUint16(position + 28, true);
      const extra = directory.getUint16(position + 30, true);
      const comment = directory.getUint16(position + 32, true);
      const local = directory.getUint32(position + 42, true);
      if (position + 46 + nameLength + extra + comment > size) throw new Error("Invalid ZIP directory entry.");
      const name = zipDecoder.decode(new Uint8Array(directory.buffer, position + 46, nameLength));
      entries.set(name, { flags, method, crc, compressed, length, local });
      position += 46 + nameLength + extra + comment;
    }
    return new ZipArchive(file, entries);
  }

  constructor(file, entries) {
    this.file = file;
    this.entries = entries;
  }

  text(path) { return this.read(path, false); }
  bytes(path) { return this.read(path, true); }

  async read(path, binary) {
    const decoder = new TextDecoder();
    const pieces = [];
    for await (const bytes of this.stream(path)) pieces.push(binary ? bytes : decoder.decode(bytes, { stream: true }));
    if (binary) {
      const output = new Uint8Array(this.entries.get(path).length);
      let offset = 0;
      for (const bytes of pieces) {
        output.set(bytes, offset);
        offset += bytes.length;
      }
      return output;
    }
    pieces.push(decoder.decode());
    return pieces.join("");
  }

  async *stream(path, limit = 256 * 1024 * 1024) {
    const entry = this.entries.get(path);
    if (!entry) throw new Error(`Missing XLSX workbook part: ${path}`);
    const { local, flags, method, compressed, length, crc } = entry;
    if (flags & 1) throw new Error("Encrypted XLSX workbooks are unsupported.");
    if (method !== 0 && method !== 8) throw new Error("Unsupported XLSX ZIP compression.");
    if (length > limit || local + 30 > this.file.size) {
      throw new Error("An XLSX workbook part exceeds the browser import limit.");
    }
    const header = new DataView(await this.file.slice(local, local + 30).arrayBuffer());
    if (header.getUint32(0, true) !== zipSignatures.file) throw new Error("Invalid XLSX ZIP entry.");
    const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    if (start + compressed > this.file.size) throw new Error("The XLSX ZIP entry is truncated.");
    let stream = this.file.slice(start, start + compressed).stream();
    if (method === 8) {
      let inflater;
      try { inflater = new DecompressionStream("deflate-raw"); }
      catch { throw new Error("This browser cannot decompress XLSX workbooks. Use a current Chromium or Firefox browser."); }
      stream = stream.pipeThrough(inflater);
    }
    let total = 0;
    let checksum = -1;
    for await (const bytes of stream) {
      total += bytes.length;
      if (total > length) throw new Error("The XLSX ZIP part exceeds its declared size.");
      checksum = updateCrc(checksum, bytes);
      yield bytes;
    }
    if (total !== length || ((checksum ^ -1) >>> 0) !== crc) throw new Error("The XLSX ZIP part is damaged.");
  }
}

class ZipWriter {
  constructor() {
    this.parts = [];
    this.directory = [];
    this.offset = 0;
    this.directorySize = 0;
    this.count = 0;
  }

  async add(path, chunks) {
    const name = zipEncoder.encode(path);
    const raw = new Blob(chunks);
    if (raw.size >= zipMax) throw new Error("An XLSX export part is too large for ZIP32.");
    const crc = await zipCrc(raw);
    let compressor;
    try { compressor = new CompressionStream("deflate-raw"); }
    catch { /* Older browsers can still create an uncompressed XLSX file. */ }
    const compressed = compressor ? await new Response(raw.stream().pipeThrough(compressor)).blob() : raw;
    const method = compressed.size < raw.size ? 8 : 0;
    const data = method ? compressed : raw;
    const local = zipHeader(30, zipSignatures.file);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint16(12, 33, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.size, true);
    local.setUint32(22, raw.size, true);
    local.setUint16(26, name.length, true);
    const entry = zipHeader(46, zipSignatures.directory);
    entry.setUint16(4, 20, true);
    new Uint8Array(entry.buffer).set(new Uint8Array(local.buffer, 4, 26), 6);
    entry.setUint32(42, this.offset, true);
    this.parts.push(local.buffer, name, data);
    this.directory.push(entry.buffer, name);
    this.offset += local.byteLength + name.length + data.size;
    this.directorySize += entry.byteLength + name.length;
    this.count++;
    if (this.offset + this.directorySize >= zipMax || this.count >= 65535) {
      throw new Error("The XLSX export exceeds the ZIP32 size limit.");
    }
  }

  blob() {
    const end = zipHeader(22, zipSignatures.end);
    end.setUint16(8, this.count, true);
    end.setUint16(10, this.count, true);
    end.setUint32(12, this.directorySize, true);
    end.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.directory, end.buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }
}
