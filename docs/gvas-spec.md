# GVAS / Palworld Save Format — Reimplementation Reference

(Research distilled from cheahjs/palworld-save-tools and deafdudecomputers/PalworldSaveTools, 2026-07-14.)

All integers little-endian.

## 0. Outer .sav container

```
offset 0:  u32  uncompressed_len (of final GVAS bytes)
offset 4:  u32  compressed_len
offset 8:  3B   magic: "PlZ" (zlib) | "PlM" (Oodle) | "CNK" (Xbox wrapper: real header repeats at +12)
offset 11: u8   save_type
offset 12: compressed data...
```
- PlZ + 0x31: single zlib; compressed_len == len(data)-12
- PlZ + 0x32: double zlib; compressed_len == len(inner after first inflate)
- PlM + 0x31: single Oodle (Kraken/Mermaid) pass; compressed_len = len(file)-12
- Validate uncompressed_len == len(gvas).
- WRITING: game accepts PlZ double-zlib (0x32) regardless of input format; it transparently upgrades to PlM on next save. So Oodle needed only for READING.

## 1. GVAS header

```
i32   magic == 0x53415647 ("GVAS")
i32   save_game_version == 3
i32   package_file_version_ue4
i32   package_file_version_ue5
u16×3 engine version major/minor/patch
u32   engine_version_changelist
fstr  engine_version_branch        ("++UE5+Release-5.1")
i32   custom_version_format == 3
u32   custom_versions_count; count × { guid(16B), i32 version }
fstr  save_game_class_name         ("/Script/Pal.PalWorldSaveGame")
```
Then root property list until name=="None", then a 4-byte 00000000 trailer (preserve).

## 2. Primitives

- fstring: i32 size; size==0 → ""; size<0 → read |size|*2 bytes UTF-16LE, strip 2-byte NUL; size>0 → read size bytes ASCII, strip 1-byte NUL.
- guid: 16 raw bytes. Stringify: b3 b2 b1 b0 - b7 b6 - b5 b4 - b11 b10 - b9 b8 b15 b14 b13 b12 (lowercase hex, dashes as shown).
- optional_guid: u8 flag; if nonzero read 16-byte guid.
- tarray(fn): u32 count then count elements.

## 2.4 Property list

Each property: fstring name ("None" terminates), fstring type, u64 size, payload.
Path strings like `.worldSaveData.CharacterSaveParameterMap.Value.RawData` drive custom decode + map hints.

## 2.5 Per-type payloads

| Type | Payload |
|---|---|
| IntProperty | optional_guid, i32 |
| Int64Property | optional_guid, i64 |
| UInt16Property | optional_guid, u16 |
| UInt32Property | optional_guid, u32 |
| FloatProperty | optional_guid, float |
| DoubleProperty | optional_guid, double |
| BoolProperty | bool byte FIRST, then optional_guid flag (size field is 0) |
| StrProperty / NameProperty | optional_guid, fstring |
| EnumProperty | fstring enum_type, optional_guid, fstring enum_value |
| ByteProperty | fstring enum_type, optional_guid; enum_type=="None" → u8 else fstring |
| StructProperty | fstring struct_type, guid struct_id, optional_guid, struct_value |
| ArrayProperty | fstring array_type, optional_guid, body |
| MapProperty | fstring key_type, fstring value_type, optional_guid, u32 (0), u32 count, count × {key, value} |

struct_value dispatch: Vector→3×double{x,y,z}; Quat→4×double; LinearColor→4×float; DateTime→u64; Guid→16B; else nested property list (until "None").

ArrayProperty body: u32 count; if array_type=="StructProperty": fstring prop_name, fstring prop_type, u64 inner_size, fstring type_name, guid id, u8 flag; then count × struct_value(type_name). Else: EnumProperty/NameProperty→count×fstring; Guid→count×16B; ByteProperty→if size==count raw blob else unsupported.

Map entries: NO struct headers — struct types from hint table; defaults key "Guid", value "StructProperty". Non-struct key/value read as bare primitive (no optional_guid).

## 2.6 Map type hints (path → type)

```
.worldSaveData.CharacterContainerSaveData.Key: StructProperty
.worldSaveData.CharacterSaveParameterMap.Key: StructProperty
.worldSaveData.CharacterSaveParameterMap.Value: StructProperty
.worldSaveData.FoliageGridSaveDataMap.Key: StructProperty
.worldSaveData.FoliageGridSaveDataMap.Value: StructProperty
.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value: StructProperty
.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Key: StructProperty
.worldSaveData.FoliageGridSaveDataMap.Value.ModelMap.Value.InstanceDataMap.Value: StructProperty
.worldSaveData.ItemContainerSaveData.Key: StructProperty
.worldSaveData.ItemContainerSaveData.Value: StructProperty
.worldSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value: StructProperty
.worldSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value: StructProperty
.worldSaveData.MapObjectSpawnerInStageSaveData.Key: StructProperty
.worldSaveData.MapObjectSpawnerInStageSaveData.Value: StructProperty
.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Key: Guid
.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value: StructProperty
.worldSaveData.MapObjectSpawnerInStageSaveData.Value.SpawnerDataMapByLevelObjectInstanceId.Value.ItemMap.Value: StructProperty
.worldSaveData.WorkSaveData.WorkSaveData.WorkAssignMap.Value: StructProperty
.worldSaveData.BaseCampSaveData.Key: Guid
.worldSaveData.BaseCampSaveData.Value: StructProperty
.worldSaveData.BaseCampSaveData.Value.ModuleMap.Value: StructProperty
.worldSaveData.CharacterContainerSaveData.Value: StructProperty
.worldSaveData.GroupSaveDataMap.Key: Guid
.worldSaveData.GroupSaveDataMap.Value: StructProperty
.worldSaveData.EnemyCampSaveData.EnemyCampStatusMap.Value: StructProperty
.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.Model.EffectMap.Value: StructProperty
.worldSaveData.DungeonSaveData.DungeonSaveData.MapObjectSaveData.MapObjectSaveData.ConcreteModel.ModuleMap.Value: StructProperty
.worldSaveData.InvaderSaveData.Key: Guid
.worldSaveData.InvaderSaveData.Value: StructProperty
.worldSaveData.OilrigSaveData.OilrigMap.Value: StructProperty
.worldSaveData.SupplySaveData.SupplyInfos.Key: Guid
.worldSaveData.SupplySaveData.SupplyInfos.Value: StructProperty
```

## 3. Custom RawData decoders (path → format)

All are ArrayProperty<ByteProperty> blobs parsed with a fresh reader; pass nested_caller_path to avoid recursion.

- `.worldSaveData.CharacterSaveParameterMap.Value.RawData` (character):
  property list → {SaveParameter}, then 4 unknown bytes, then guid group_id.
- `.worldSaveData.CharacterContainerSaveData.Value.Slots.Slots.RawData` (character_container slot):
  empty blob → empty slot; else guid player_uid, guid instance_id, u8 permission_tribe_id.
- `.worldSaveData.ItemContainerSaveData.Value.RawData`: tarray<u8> type_a, tarray<u8> type_b, tarray<fstring> item_static_ids, trailing bytes opaque.
- `.worldSaveData.GroupSaveDataMap` (whole map; Value.RawData per group; layout depends on Value.GroupType EPalGroupType):
  guid group_id, fstring group_name, tarray{guid,guid} individual_character_handle_ids;
  Guild/IndependentGuild/Organization: u8 org_type, tarray<guid> base_ids;
  Guild/IndependentGuild: i32 base_camp_level, tarray<guid> map_object_instance_ids_base_camp_points, fstring guild_name;
  IndependentGuild: guid player_uid, fstring guild_name_2, i64 last_online_real_time, fstring player_name;
  Guild: guid admin_player_uid, i32 player_count, count × {guid player_uid, i64 last_online, fstring player_name}.
- `.worldSaveData.DynamicItemSaveData.DynamicItemSaveData.RawData`: guid created_world_id, guid local_id, fstring static_id; then heuristics: egg (fstring character_id + proplist + 4B + guid, EOF) | armor (exactly 4B float durability) | weapon (float durability, i32 bullets, tarray<fstring> passives, EOF) | else opaque.
- `.worldSaveData.BaseCampSaveData.Value.RawData`: guid id, fstring name, u8 state, ftransform (quat 4×double + vector 3×double + vector 3×double), float area_range, guid group_id_belong_to, ftransform fast_travel_local_transform, guid owner_map_object_instance_id.
- `.worldSaveData.BaseCampSaveData.Value.WorkerDirector.RawData`: guid id, ftransform spawn_transform, u8 current_order_type, u8 current_battle_type, guid container_id (base worker container).
- DISABLED (stale since game v0.3.7, treat as opaque): `.worldSaveData.BaseCampSaveData.Value.ModuleMap`, `.worldSaveData.MapObjectSaveData`, `.worldSaveData.ItemContainerSaveData.Value.Slots.Slots.RawData`.

## 4. Pals / palbox

CharacterSaveParameterMap: Key proplist {PlayerUId guid (zeros for pals), InstanceId guid}; Value proplist {RawData → §character}.
SaveParameter (PalIndividualCharacterSaveParameter, plain proplist), all fields optional:
CharacterID (Name, species; BOSS_ prefix = alpha), NickName (Str), Gender (Enum EPalGenderType::Male/Female),
Level (Byte u8; IntProperty in old saves — dispatch on serialized type), Exp (Int64), Rank (Byte 1-5),
Rank_HP/Rank_Attack/Rank_Defence/Rank_CraftSpeed (Byte 0-20 souls),
Talent_HP/Talent_Melee/Talent_Shot/Talent_Defense (Byte 0-100 IVs; Int in old saves),
PassiveSkillList (Array<Name>), EquipWaza (Array<Enum> EPalWazaID::), MasteredWaza (Array<Enum>),
Hp (Struct FixedPoint64 → {Value: Int64}, ×1000), FullStomach (Float), SanityValue (Float), FriendshipPoint (Int),
IsPlayer (Bool, player entry only), IsRarePal (Bool, lucky), OwnerPlayerUId (Struct Guid),
SlotId (Struct PalCharacterSlotId → {ContainerId: Struct PalContainerId → {ID: Struct Guid}, SlotIndex: Int}).

CharacterContainerSaveData: Key proplist {ID: Struct Guid}; Value {SlotNum: Int, Slots: Array<Struct> each {SlotIndex, RawData → slot blob}}.

Which container = palbox: from player .sav:
```
SaveData.value.PlayerUId.value
SaveData.value.IndividualId.value.InstanceId.value
SaveData.value.PalStorageContainerId.value.ID.value    ← PALBOX
SaveData.value.OtomoCharacterContainerId.value.ID.value ← PARTY
SaveData.value.InventoryInfo.value.{Common,DropSlot,Essential,WeaponLoadOut,PlayerEquipArmor,FoodEquip}ContainerId.value.ID.value
```
(older saves: lowercase `inventoryInfo`). Base worker containers via WorkerDirector.container_id.
Player filename = PlayerUId hex uppercase no dashes + ".sav".

## Gotchas

1. BoolProperty value byte before guid flag.
2. Map entries: inject struct types from hints.
3. Array<Struct> single inner header before bare values.
4. RawData blob: size == count.
5. Guids raw 16B; reorder only when stringifying.
6. Level/Rank/Talent switched Int→Byte across updates; dispatch on type string.
7. Empty slot RawData ⇒ empty slot.
8. Preserve 4-byte zero trailer + save_type on rewrite.
