// gvas.js — from-scratch parser for Unreal GVAS SaveGame data as used by Palworld.
// Format reference: docs/gvas-spec.md (distilled from public reverse-engineering).
// No external dependencies; runs in Node and browsers.

'use strict';

(() => {

const ASCII = new TextDecoder('latin1');
const UTF16 = new TextDecoder('utf-16le');

class Reader {
  constructor(u8) {
    this.u8 = u8;
    this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    this.off = 0;
  }
  get remaining() { return this.u8.length - this.off; }
  eof() { return this.off >= this.u8.length; }
  byte() { return this.u8[this.off++]; }
  bool() { return this.u8[this.off++] > 0; }
  u16() { const v = this.dv.getUint16(this.off, true); this.off += 2; return v; }
  i32() { const v = this.dv.getInt32(this.off, true); this.off += 4; return v; }
  u32() { const v = this.dv.getUint32(this.off, true); this.off += 4; return v; }
  i64() { const v = this.dv.getBigInt64(this.off, true); this.off += 8; return bigToNum(v); }
  u64() { const v = this.dv.getBigUint64(this.off, true); this.off += 8; return bigToNum(v); }
  f32() { const v = this.dv.getFloat32(this.off, true); this.off += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.off, true); this.off += 8; return v; }
  bytes(n) { const v = this.u8.subarray(this.off, this.off + n); this.off += n; return v; }
  fstring() {
    const size = this.i32();
    if (size === 0) return '';
    if (size < 0) {
      const n = -size;
      const data = this.bytes(n * 2);
      return UTF16.decode(data.subarray(0, n * 2 - 2));
    }
    const data = this.bytes(size);
    return ASCII.decode(data.subarray(0, size - 1));
  }
  guid() { return guidToString(this.bytes(16)); }
  optionalGuid() { return this.byte() ? this.guid() : null; }
}

function bigToNum(v) {
  return (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) ? Number(v) : v;
}

const HEX = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

// UE FGuid string form: b3b2b1b0-b7b6-b5b4-b11b10-b9b8b15b14b13b12
function guidToString(b) {
  return HEX[b[3]] + HEX[b[2]] + HEX[b[1]] + HEX[b[0]] + '-' +
         HEX[b[7]] + HEX[b[6]] + '-' + HEX[b[5]] + HEX[b[4]] + '-' +
         HEX[b[11]] + HEX[b[10]] + '-' + HEX[b[9]] + HEX[b[8]] +
         HEX[b[15]] + HEX[b[14]] + HEX[b[13]] + HEX[b[12]];
}

// Map key/value struct-type hints (path → 'StructProperty' | 'Guid').
const TYPE_HINTS = {
  '.worldSaveData.CharacterContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Key': 'StructProperty',
  '.worldSaveData.CharacterSaveParameterMap.Value': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Key': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Key': 'StructProperty',
  '.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Value': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Key': 'StructProperty',
  '.worldSaveData.ItemContainerSaveData.Value': 'StructProperty',
  '.worldSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value': 'StructProperty',
  '.worldSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Key': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Key': 'Guid',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value': 'StructProperty',
  '.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value.ItemMap.Value': 'StructProperty',
  '.worldSaveData.WorkSaveData.WorkSaveData.WorkAssignMap.Value': 'StructProperty',
  '.worldSaveData.BaseCampSaveData.Key': 'Guid',
  '.worldSaveData.BaseCampSaveData.Value': 'StructProperty',
  '.worldSaveData.BaseCampSaveData.Value.ModuleMap.Value': 'StructProperty',
  '.worldSaveData.CharacterContainerSaveData.Value': 'StructProperty',
  '.worldSaveData.GroupSaveDataMap.Key': 'Guid',
  '.worldSaveData.GroupSaveDataMap.Value': 'StructProperty',
  '.worldSaveData.EnemyCampSaveData.EnemyCampStatusMap.Value': 'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value': 'StructProperty',
  '.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value': 'StructProperty',
  '.worldSaveData.InvaderSaveData.Key': 'Guid',
  '.worldSaveData.InvaderSaveData.Value': 'StructProperty',
  '.worldSaveData.OilrigSaveData.OilrigMap.Value': 'StructProperty',
  '.worldSaveData.SupplySaveData.SupplyInfos.Key': 'Guid',
  '.worldSaveData.SupplySaveData.SupplyInfos.Value': 'StructProperty',
};

function hint(path, fallback) {
  return TYPE_HINTS[path] || fallback;
}

// opts.shouldExpand(path): return false to keep a property's body as raw bytes
// (fast skip; re-emittable verbatim). Default: expand everything.
function parseGvas(u8, opts = {}) {
  const r = new Reader(u8);
  const shouldExpand = opts.shouldExpand || (() => true);

  const magic = r.u32();
  if (magic !== 0x53415647) throw new Error('not a GVAS file');
  const header = {
    saveGameVersion: r.i32(),
    packageFileVersionUE4: r.i32(),
    packageFileVersionUE5: r.i32(),
    engineVersionMajor: r.u16(),
    engineVersionMinor: r.u16(),
    engineVersionPatch: r.u16(),
    engineVersionChangelist: r.u32(),
    engineVersionBranch: r.fstring(),
    customVersionFormat: r.i32(),
    customVersions: [],
    saveGameClassName: '',
  };
  if (header.saveGameVersion !== 3) throw new Error(`unexpected save game version ${header.saveGameVersion}`);
  const cvCount = r.u32();
  for (let i = 0; i < cvCount; i++) {
    header.customVersions.push([guidToString(r.bytes(16)), r.i32()]);
  }
  header.saveGameClassName = r.fstring();

  const properties = readProperties(r, '', shouldExpand);
  const trailer = r.bytes(Math.min(4, r.remaining)).slice();
  return { header, properties, trailer };
}

function readProperties(r, path, shouldExpand) {
  const out = {};
  for (;;) {
    const name = r.fstring();
    if (name === 'None') break;
    const typeName = r.fstring();
    const size = r.u64();
    const p = `${path}.${name}`;
    if (!shouldExpand(p)) {
      out[name] = skipProperty(r, typeName, size);
    } else {
      out[name] = readProperty(r, typeName, size, p, shouldExpand);
    }
  }
  return out;
}

// Reads the per-type pre-header then stores the body verbatim (for later
// re-serialization or on-demand parsing).
function skipProperty(r, typeName, size) {
  const node = { type: typeName, raw: true };
  switch (typeName) {
    case 'StructProperty':
      node.structType = r.fstring();
      node.structId = r.guid();
      node.id = r.optionalGuid();
      break;
    case 'ArrayProperty':
      node.arrayType = r.fstring();
      node.id = r.optionalGuid();
      break;
    case 'SetProperty':
      node.setType = r.fstring();
      node.id = r.optionalGuid();
      break;
    case 'MapProperty':
      node.keyType = r.fstring();
      node.valueType = r.fstring();
      node.id = r.optionalGuid();
      break;
    case 'EnumProperty':
    case 'ByteProperty':
      node.enumType = r.fstring();
      node.id = r.optionalGuid();
      break;
    case 'BoolProperty':
      node.value = r.bool();
      node.id = r.optionalGuid();
      return node;
    default:
      node.id = r.optionalGuid();
      break;
  }
  node.data = r.bytes(size);
  return node;
}

function readProperty(r, typeName, size, path, shouldExpand) {
  switch (typeName) {
    case 'IntProperty': return { type: typeName, id: r.optionalGuid(), value: r.i32() };
    case 'Int64Property': return { type: typeName, id: r.optionalGuid(), value: r.i64() };
    case 'UInt16Property': return { type: typeName, id: r.optionalGuid(), value: r.u16() };
    case 'UInt32Property': return { type: typeName, id: r.optionalGuid(), value: r.u32() };
    case 'FloatProperty': return { type: typeName, id: r.optionalGuid(), value: r.f32() };
    case 'DoubleProperty': return { type: typeName, id: r.optionalGuid(), value: r.f64() };
    case 'StrProperty':
    case 'NameProperty': return { type: typeName, id: r.optionalGuid(), value: r.fstring() };
    case 'BoolProperty': {
      const value = r.bool();
      return { type: typeName, value, id: r.optionalGuid() };
    }
    case 'EnumProperty': {
      const enumType = r.fstring();
      const id = r.optionalGuid();
      return { type: typeName, enumType, id, value: r.fstring() };
    }
    case 'ByteProperty': {
      const enumType = r.fstring();
      const id = r.optionalGuid();
      const value = enumType === 'None' ? r.byte() : r.fstring();
      return { type: typeName, enumType, id, value };
    }
    case 'StructProperty': {
      const structType = r.fstring();
      const structId = r.guid();
      const id = r.optionalGuid();
      const value = readStructValue(r, structType, path, shouldExpand);
      return { type: typeName, structType, structId, id, value };
    }
    case 'ArrayProperty': {
      const arrayType = r.fstring();
      const id = r.optionalGuid();
      const value = readArrayValue(r, arrayType, size - 4, path, shouldExpand);
      return { type: typeName, arrayType, id, ...value };
    }
    case 'SetProperty': {
      // element-type string, optional guid, then u32 removed-count (always 0
      // in saves) followed by an array-style payload
      const setType = r.fstring();
      const id = r.optionalGuid();
      const removed = r.u32();
      if (removed !== 0) throw new Error(`SetProperty with ${removed} removals at ${path}`);
      const value = readArrayValue(r, setType, size - 8, path, shouldExpand);
      return { type: typeName, setType, id, ...value };
    }
    case 'MapProperty': {
      const keyType = r.fstring();
      const valueType = r.fstring();
      const id = r.optionalGuid();
      r.u32(); // always 0
      const count = r.u32();
      const keyStructType = hint(`${path}.Key`, 'Guid');
      const valueStructType = hint(`${path}.Value`, 'StructProperty');
      const entries = new Array(count);
      const keyPath = `${path}.Key`, valPath = `${path}.Value`;
      for (let i = 0; i < count; i++) {
        const key = readPropValue(r, keyType, keyStructType, keyPath, shouldExpand);
        const value = readPropValue(r, valueType, valueStructType, valPath, shouldExpand);
        entries[i] = { key, value };
      }
      return { type: typeName, keyType, valueType, id, entries };
    }
    default:
      throw new Error(`unknown property type ${typeName} at ${path}`);
  }
}

function readStructValue(r, structType, path, shouldExpand) {
  switch (structType) {
    case 'Vector': return { x: r.f64(), y: r.f64(), z: r.f64() };
    case 'Quat': return { x: r.f64(), y: r.f64(), z: r.f64(), w: r.f64() };
    case 'LinearColor': return { r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32() };
    case 'DateTime': return r.u64();
    case 'Guid': return r.guid();
    default: return readProperties(r, path, shouldExpand);
  }
}

// Map entry / bare value (no per-property header).
function readPropValue(r, typeName, structTypeHint, path, shouldExpand) {
  switch (typeName) {
    case 'StructProperty': return readStructValue(r, structTypeHint, path, shouldExpand);
    case 'EnumProperty':
    case 'NameProperty':
    case 'StrProperty': return r.fstring();
    case 'IntProperty': return r.i32();
    case 'Int64Property': return r.i64();
    case 'UInt32Property': return r.u32();
    case 'FloatProperty': return r.f32();
    case 'BoolProperty': return r.bool();
    case 'ByteProperty': return r.byte();
    default:
      throw new Error(`unsupported map key/value type ${typeName} at ${path}`);
  }
}

function readArrayValue(r, arrayType, size, path, shouldExpand) {
  const count = r.u32();
  switch (arrayType) {
    case 'StructProperty': {
      const propName = r.fstring();
      const propType = r.fstring();
      r.u64(); // inner size
      const structType = r.fstring();
      const structId = r.guid();
      r.byte(); // optional-guid flag
      const values = new Array(count);
      const p = `${path}.${propName}`;
      for (let i = 0; i < count; i++)
        values[i] = readStructValue(r, structType, p, shouldExpand);
      return { propName, propType, structType, structId, values };
    }
    case 'EnumProperty':
    case 'NameProperty':
    case 'StrProperty': {
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = r.fstring();
      return { values };
    }
    case 'Guid': {
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = r.guid();
      return { values };
    }
    case 'ByteProperty': {
      if (size === count) return { values: r.bytes(count) };
      throw new Error(`labelled ByteProperty array not supported at ${path}`);
    }
    case 'IntProperty': {
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = r.i32();
      return { values };
    }
    case 'Int64Property': {
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = r.i64();
      return { values };
    }
    case 'FloatProperty': {
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = r.f32();
      return { values };
    }
    case 'BoolProperty': {
      const values = new Array(count);
      for (let i = 0; i < count; i++) values[i] = r.bool();
      return { values };
    }
    default:
      throw new Error(`unsupported array type ${arrayType} at ${path}`);
  }
}

// ---- Palworld RawData blob decoders ----------------------------------------------

// CharacterSaveParameterMap.Value.RawData blob:
// property list {SaveParameter}, 4 unknown bytes, guid group_id.
function parseCharacterRawData(blob) {
  const r = new Reader(blob);
  const object = readProperties(r, '.SaveParameter', () => true);
  let unknownBytes = null, groupId = null;
  if (r.remaining >= 20) {
    unknownBytes = Array.from(r.bytes(4));
    groupId = r.guid();
  }
  return { object, unknownBytes, groupId, trailing: r.remaining };
}

// CharacterContainerSaveData.Value.Slots.Slots.RawData blob:
// empty → empty slot; else guid player_uid, guid instance_id, u8 permission_tribe_id.
function parseCharacterContainerSlotRawData(blob) {
  if (blob.length === 0) return null;
  const r = new Reader(blob);
  return {
    playerUid: r.guid(),
    instanceId: r.guid(),
    permissionTribeId: r.byte(),
  };
}

const api = {
  Reader,
  parseGvas,
  guidToString,
  parseCharacterRawData,
  parseCharacterContainerSlotRawData,
};

// Always register the browser global — bundlers wrap this file as CJS, which
// makes `module` exist in the browser too, so an if/else here would skip it.
globalThis.PalTools = Object.assign(globalThis.PalTools || {}, api);
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}

})();
