/**
 * Just enough zip to edit an .xlsx in place.
 *
 * An .xlsx is a zip of XML parts. Loading one with a spreadsheet library and
 * saving it again keeps the formulas but re-serialises the styles, taking the
 * Defra metric template from 3.6MB to 82MB. Editing only the parts
 * that change, and copying every other entry's compressed bytes through
 * untouched, keeps the file the size it was and leaves styles, validation,
 * charts and the other forty-odd sheets exactly as Defra shipped them.
 *
 * Node's own zlib does the deflate and the CRC, so this needs no dependency.
 * Zip64 and encrypted entries are refused rather than half-supported: the
 * metric template uses neither.
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_END = 0x06054b50

const METHOD_STORED = 0
const METHOD_DEFLATE = 8

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const END_RECORD_SIZE = 22
// The end record may be followed by a comment of up to 64KB.
const MAX_END_SEARCH = END_RECORD_SIZE + 0xffff

const FLAG_ENCRYPTED = 0x0001
// Bit 3 says sizes and CRC follow the data in a descriptor. The rewritten
// local headers carry them up front, so the bit is cleared on the way out.
const FLAG_DATA_DESCRIPTOR = 0x0008
const ZIP64_MARKER = 0xffffffff

const VERSION_NEEDED = 20

function findEndRecord(buffer) {
  const floor = Math.max(0, buffer.length - MAX_END_SEARCH)
  for (let i = buffer.length - END_RECORD_SIZE; i >= floor; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_END) {
      return i
    }
  }
  throw new Error('Not a zip file: no end-of-central-directory record')
}

function readCentralEntry(buffer, offset) {
  if (buffer.readUInt32LE(offset) !== SIG_CENTRAL) {
    throw new Error(`Corrupt zip: bad central directory entry at ${offset}`)
  }
  const flags = buffer.readUInt16LE(offset + 8)
  const nameLength = buffer.readUInt16LE(offset + 28)
  const extraLength = buffer.readUInt16LE(offset + 30)
  const commentLength = buffer.readUInt16LE(offset + 32)
  const entry = {
    flags,
    method: buffer.readUInt16LE(offset + 10),
    time: buffer.readUInt16LE(offset + 12),
    date: buffer.readUInt16LE(offset + 14),
    crc: buffer.readUInt32LE(offset + 16),
    compressedSize: buffer.readUInt32LE(offset + 20),
    size: buffer.readUInt32LE(offset + 24),
    externalAttributes: buffer.readUInt32LE(offset + 38),
    localOffset: buffer.readUInt32LE(offset + 42),
    name: buffer.toString(
      'utf8',
      offset + CENTRAL_HEADER_SIZE,
      offset + CENTRAL_HEADER_SIZE + nameLength
    )
  }
  if (flags & FLAG_ENCRYPTED) {
    throw new Error(`Encrypted zip entries are not supported (${entry.name})`)
  }
  if (
    entry.compressedSize === ZIP64_MARKER ||
    entry.size === ZIP64_MARKER ||
    entry.localOffset === ZIP64_MARKER
  ) {
    throw new Error(`Zip64 entries are not supported (${entry.name})`)
  }
  return {
    entry,
    next:
      offset + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength
  }
}

function locateData(buffer, entry) {
  const at = entry.localOffset
  if (buffer.readUInt32LE(at) !== SIG_LOCAL) {
    throw new Error(`Corrupt zip: bad local header for ${entry.name}`)
  }
  const nameLength = buffer.readUInt16LE(at + 26)
  const extraLength = buffer.readUInt16LE(at + 28)
  const start = at + LOCAL_HEADER_SIZE + nameLength + extraLength
  return buffer.subarray(start, start + entry.compressedSize)
}

/**
 * Read a zip's directory. Entry data stays compressed until asked for, so an
 * untouched entry can be copied through without ever being inflated.
 *
 * @param {Buffer} buffer
 * @returns {{ names: string[], has: (name: string) => boolean,
 *   read: (name: string) => Buffer, entries: object[] }}
 */
export function readZip(buffer) {
  const end = findEndRecord(buffer)
  const count = buffer.readUInt16LE(end + 10)
  let offset = buffer.readUInt32LE(end + 16)
  const entries = []
  for (let i = 0; i < count; i += 1) {
    const { entry, next } = readCentralEntry(buffer, offset)
    entry.data = locateData(buffer, entry)
    entries.push(entry)
    offset = next
  }
  const byName = new Map(entries.map((e) => [e.name, e]))

  function read(name) {
    const entry = byName.get(name)
    if (!entry) {
      throw new Error(`No zip entry named ${name}`)
    }
    if (entry.method === METHOD_STORED) {
      return Buffer.from(entry.data)
    }
    if (entry.method === METHOD_DEFLATE) {
      return inflateRawSync(entry.data)
    }
    throw new Error(`Unsupported compression method ${entry.method} (${name})`)
  }

  return {
    entries,
    names: entries.map((e) => e.name),
    has: (name) => byName.has(name),
    read
  }
}

function replacedEntry(original, content) {
  const data = deflateRawSync(content)
  return {
    ...original,
    flags: original.flags & ~FLAG_DATA_DESCRIPTOR,
    method: METHOD_DEFLATE,
    crc: crc32(content),
    size: content.length,
    compressedSize: data.length,
    data
  }
}

function localHeader(entry, nameBytes) {
  const header = Buffer.alloc(LOCAL_HEADER_SIZE)
  header.writeUInt32LE(SIG_LOCAL, 0)
  header.writeUInt16LE(VERSION_NEEDED, 4)
  header.writeUInt16LE(entry.flags & ~FLAG_DATA_DESCRIPTOR, 6)
  header.writeUInt16LE(entry.method, 8)
  header.writeUInt16LE(entry.time, 10)
  header.writeUInt16LE(entry.date, 12)
  header.writeUInt32LE(entry.crc, 14)
  header.writeUInt32LE(entry.compressedSize, 18)
  header.writeUInt32LE(entry.size, 22)
  header.writeUInt16LE(nameBytes.length, 26)
  header.writeUInt16LE(0, 28)
  return header
}

function centralHeader(entry, nameBytes, localOffset) {
  const header = Buffer.alloc(CENTRAL_HEADER_SIZE)
  header.writeUInt32LE(SIG_CENTRAL, 0)
  header.writeUInt16LE(VERSION_NEEDED, 4)
  header.writeUInt16LE(VERSION_NEEDED, 6)
  header.writeUInt16LE(entry.flags & ~FLAG_DATA_DESCRIPTOR, 8)
  header.writeUInt16LE(entry.method, 10)
  header.writeUInt16LE(entry.time, 12)
  header.writeUInt16LE(entry.date, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.compressedSize, 20)
  header.writeUInt32LE(entry.size, 24)
  header.writeUInt16LE(nameBytes.length, 28)
  header.writeUInt32LE(entry.externalAttributes, 38)
  header.writeUInt32LE(localOffset, 42)
  return header
}

/**
 * Write a new zip: every entry of `zip` in its original order, with the
 * entries named in `replacements` swapped for new content. Everything else is
 * copied as the compressed bytes it already was.
 *
 * @param {ReturnType<typeof readZip>} zip
 * @param {Map<string, Buffer|string>} replacements
 * @returns {Buffer}
 */
export function writeZip(zip, replacements) {
  for (const name of replacements.keys()) {
    if (!zip.has(name)) {
      throw new Error(`Cannot replace ${name}: it is not in the zip`)
    }
  }
  const chunks = []
  const central = []
  let offset = 0
  for (const original of zip.entries) {
    const content = replacements.get(original.name)
    const entry =
      content === undefined
        ? original
        : replacedEntry(original, Buffer.from(content))
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const header = localHeader(entry, nameBytes)
    central.push(centralHeader(entry, nameBytes, offset), nameBytes)
    chunks.push(header, nameBytes, entry.data)
    offset += header.length + nameBytes.length + entry.data.length
  }
  const centralDirectory = Buffer.concat(central)
  const end = Buffer.alloc(END_RECORD_SIZE)
  end.writeUInt32LE(SIG_END, 0)
  end.writeUInt16LE(zip.entries.length, 8)
  end.writeUInt16LE(zip.entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, centralDirectory, end])
}
