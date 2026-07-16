// pals.js — extract players, pals, containers and guilds from parsed save data.

'use strict';

(() => {

const isNode = typeof module !== 'undefined' && module.exports;
const gvas = isNode ? require('./gvas.js') : globalThis.PalTools;

const WORLD_EXPAND_ROOTS = [
  '.worldSaveData.CharacterSaveParameterMap',
  '.worldSaveData.CharacterContainerSaveData',
  '.worldSaveData.GroupSaveDataMap',
  '.worldSaveData.GameTimeSaveData',
];

function worldShouldExpand(p) {
  if (!p.startsWith('.worldSaveData.')) return true;
  return WORLD_EXPAND_ROOTS.some(root => p === root || p.startsWith(root + '.'));
}

function val(node) { return node ? node.value : undefined; }

// Read a SaveParameter field that changed type across game versions (Int→Byte).
function num(props, name, dflt) {
  const n = props[name];
  if (!n) return dflt;
  return n.value;
}

function parseLevelSav(gvasBytes) {
  return gvas.parseGvas(gvasBytes, { shouldExpand: worldShouldExpand });
}

function parsePlayerSav(gvasBytes) {
  return gvas.parseGvas(gvasBytes);
}

// Extracts everything pal-related from a parsed Level.sav.
function extractWorld(level) {
  const world = level.properties.worldSaveData.value;

  // --- characters ---
  const players = [];
  const pals = [];
  for (const entry of world.CharacterSaveParameterMap.entries) {
    const key = {
      playerUid: entry.key.PlayerUId.value,
      instanceId: entry.key.InstanceId.value,
    };
    const rawNode = entry.value.RawData;
    const blob = rawNode.values;
    const parsed = gvas.parseCharacterRawData(blob);
    const sp = parsed.object.SaveParameter;
    const p = sp ? sp.value : {};

    const base = {
      key,
      groupId: parsed.groupId,
      nickname: val(p.NickName) || null,
      level: num(p, 'Level', 1),
      exp: num(p, 'Exp', 0),
    };

    if (p.IsPlayer && p.IsPlayer.value) {
      players.push({
        ...base,
        uid: key.playerUid,
      });
    } else {
      const characterId = val(p.CharacterID) || '';
      const gender = p.Gender ? String(p.Gender.value).replace('EPalGenderType::', '') : null;
      const slotId = p.SlotId ? p.SlotId.value : null;
      const containerId = slotId && slotId.ContainerId ? slotId.ContainerId.value.ID.value : null;
      const slotIndex = slotId && slotId.SlotIndex ? slotId.SlotIndex.value : 0;
      const hpNode = p.Hp || p.HP;
      pals.push({
        ...base,
        characterId,
        species: characterId.replace(/^BOSS_/i, '').replace(/^PREDATOR_/i, ''),
        isAlpha: /^BOSS_/i.test(characterId),
        isLucky: !!(p.IsRarePal && p.IsRarePal.value),
        gender,
        rank: num(p, 'Rank', 1),
        rankHp: num(p, 'Rank_HP', 0),
        rankAttack: num(p, 'Rank_Attack', 0),
        rankDefence: num(p, 'Rank_Defence', 0),
        rankCraftSpeed: num(p, 'Rank_CraftSpeed', 0),
        talentHp: num(p, 'Talent_HP', 0),
        talentMelee: num(p, 'Talent_Melee', 0),
        talentShot: num(p, 'Talent_Shot', 0),
        talentDefense: num(p, 'Talent_Defense', 0),
        passives: p.PassiveSkillList ? p.PassiveSkillList.values : [],
        equipWaza: p.EquipWaza ? p.EquipWaza.values.map(w => String(w).replace('EPalWazaID::', '')) : [],
        masteredWaza: p.MasteredWaza ? p.MasteredWaza.values.map(w => String(w).replace('EPalWazaID::', '')) : [],
        hp: hpNode && hpNode.value && hpNode.value.Value ? hpNode.value.Value.value : null,
        ownerUid: p.OwnerPlayerUId ? p.OwnerPlayerUId.value : null,
        containerId,
        slotIndex,
        friendship: num(p, 'FriendshipPoint', 0),
      });
    }
  }

  // --- containers ---
  const containers = new Map();
  if (world.CharacterContainerSaveData) {
    for (const entry of world.CharacterContainerSaveData.entries) {
      const id = entry.key.ID.value;
      const slotsNode = entry.value.Slots;
      const slots = [];
      if (slotsNode && slotsNode.values) {
        for (const slot of slotsNode.values) {
          const rd = slot.RawData ? gvas.parseCharacterContainerSlotRawData(slot.RawData.values) : null;
          slots.push({
            slotIndex: slot.SlotIndex ? slot.SlotIndex.value : 0,
            instanceId: rd ? rd.instanceId : null,
            playerUid: rd ? rd.playerUid : null,
          });
        }
      }
      containers.set(id, {
        id,
        slotNum: entry.value.SlotNum ? entry.value.SlotNum.value : slots.length,
        slots,
      });
    }
  }

  // --- guilds (generic parse; RawData blob decoding deferred) ---
  const guilds = [];
  if (world.GroupSaveDataMap) {
    for (const entry of world.GroupSaveDataMap.entries) {
      const groupType = entry.value.GroupType ? entry.value.GroupType.value : null;
      guilds.push({ id: entry.key, groupType });
    }
  }

  return { players, pals, containers, guilds };
}

// Extracts container bindings from a parsed player .sav.
function extractPlayerMeta(player) {
  const sd = player.properties.SaveData.value;
  const inv = (sd.InventoryInfo || sd.inventoryInfo);
  const cid = node => (node ? node.value.ID.value : null);

  // Collected relics/effigies: union of the typed flag sets (1.0) plus the
  // legacy flat map (mirrors CapturePower only). Keys are 32-hex instance ids.
  const collectedRelics = new Set();
  const rd = sd.RecordData ? sd.RecordData.value : null;
  if (rd) {
    const flat = rd.RelicObtainForInstanceFlag;
    if (flat && flat.entries) {
      for (const e of flat.entries) if (e.value) collectedRelics.add(String(e.key).toUpperCase());
    }
    const byType = rd.RelicObtainForInstanceFlagByType;
    if (byType && byType.values) {
      for (const entry of byType.values) {
        const flags = entry.Flags;
        if (flags && flags.entries) {
          for (const e of flags.entries) if (e.value) collectedRelics.add(String(e.key).toUpperCase());
        }
      }
    }
  }

  // Other per-player world-progress flags (keys as stored in the save)
  const flagKeys = (node) => (node && node.entries ? node.entries.filter(e => e.value).map(e => String(e.key)) : []);
  const unlockedFastTravel = rd ? flagKeys(rd.FastTravelPointUnlockFlag).map(k => k.toUpperCase()) : [];
  const defeatedBosses = rd ? flagKeys(rd.NormalBossDefeatFlag).map(k => k.toLowerCase()) : [];
  const defeatedTowers = rd ? flagKeys(rd.TowerBossDefeatFlag) : [];
  const collectedNotes = rd ? flagKeys(rd.NoteObtainForInstanceFlag) : [];

  return {
    collectedRelics: [...collectedRelics],
    unlockedFastTravel,
    defeatedBosses,
    defeatedTowers,
    collectedNotes,
    playerUid: sd.PlayerUId ? sd.PlayerUId.value : null,
    instanceId: sd.IndividualId ? sd.IndividualId.value.InstanceId.value : null,
    palboxContainerId: cid(sd.PalStorageContainerId),
    partyContainerId: cid(sd.OtomoCharacterContainerId),
    inventory: inv ? {
      common: cid(inv.value.CommonContainerId),
      essential: cid(inv.value.EssentialContainerId),
      weaponLoadOut: cid(inv.value.WeaponLoadOutContainerId),
      armor: cid(inv.value.PlayerEquipArmorContainerId),
      food: cid(inv.value.FoodEquipContainerId),
    } : null,
  };
}

// Classify each pal's location given player metas: palbox | party | base | other.
function classifyPals(worldData, playerMetas) {
  const byContainer = new Map();
  for (const meta of playerMetas) {
    if (meta.palboxContainerId) byContainer.set(meta.palboxContainerId, { where: 'palbox', owner: meta.playerUid });
    if (meta.partyContainerId) byContainer.set(meta.partyContainerId, { where: 'party', owner: meta.playerUid });
  }
  for (const pal of worldData.pals) {
    const loc = pal.containerId ? byContainer.get(pal.containerId) : null;
    pal.where = loc ? loc.where : (pal.containerId ? 'base/other' : 'unknown');
  }
  return worldData;
}

const api = { parseLevelSav, parsePlayerSav, extractWorld, extractPlayerMeta, classifyPals };
if (isNode) module.exports = api;
else globalThis.PalTools = Object.assign(globalThis.PalTools || {}, api);

})();
