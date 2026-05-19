// This file is just reference and deprecated

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { SchemaDeclarationError } from "./utils/errors.ts";

// ============================================================================
// ============================================================================
//
//   🌱 cultivar-js SYSTEM — TypeScript Implementation (Annotated Edition)
//
//   ไฟล์นี้รวมทุกอย่างที่โปรเจกต์นี้เป็น ทำงานอย่างไร และทำไมถึงออกแบบแบบนี้
//   เขียน comment ละเอียดมากๆ เพื่อให้คนที่เพิ่งเห็นโค้ดนี้เป็นครั้งแรก
//   อ่านแล้วเข้าใจได้ทั้งหมด ไม่ต้องเปิดเอกสารอะไรเพิ่ม
//
// ============================================================================
// ============================================================================
//
//   สารบัญ (Table of Contents)
//   ─────────────────────────
//   Part 1:  ปรัชญาและแนวคิดหลัก          (Philosophy & Core Concepts)
//   Part 2:  ประเภทข้อมูลพื้นฐาน             (Primitive Types & Constants)
//   Part 3:  โครงสร้าง Seed                  (Seed Binary Format)
//   Part 4:  โครงสร้าง Domain                (Domain Manifest)
//   Part 5:  การแกะ/ห่อ Seed                (Seed Parser & Serializer)
//   Part 6:  ระบบ Mutation                   (Mutation Operators)
//   Part 7:  ระบบ Curation                   (Curation Protocol)
//   Part 8:  ระบบ Lineage                    (Lineage & Provenance)
//   Part 9:  ระบบ Trust                      (Trust & Verification)
//   Part 10: ระบบ Economy                    (Economy & Marketplace)
//   Part 11: Execution Pipeline               (วิธีรัน Seed ใน Domain)
//   Part 12: ตัวอย่าง Domain จริง             (MIDI Music Domain)
//   Part 13: ข้อเสนอแนะจากการวิเคราะห์       (Analysis Recommendations)
//
// ============================================================================
// ============================================================================

// #############################################################################
// #############################################################################
//
//   PART 1: ปรัชญาและแนวคิดหลัก
//   ─────────────────────────────
//
//   ก่อนจะอ่านโค้ด ต้องเข้าใจ "หัวใจ" ของระบบก่อน
//
// #############################################################################
// #############################################################################

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  cultivar-js SYSTEM คืออะไร?                                          ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                         ║
 * ║  ลองจินตนาการว่าคุณมี "แม่พิมพ์" (Seed) ที่เวลาเอาไปกดลงบน "พื้นผิว"       ║
 * ║  (Domain) แล้ว มันจะประทับออกมาเป็น "ผลงาน" (Artifact)                  ║
 * ║                                                                         ║
 * ║  - Seed    = แม่พิมพ์ ค่าพารามิเตอร์ที่กำหนดว่าจะสร้างอะไร              ║
 * ║  - Domain  = พื้นผิว สภาพแวดล้อมที่กำหนดกฎว่าทำอะไรได้/ไม่ได้            ║
 * ║  - Artifact = ผลงานจริงที่ออกมา เช่น เพลง, ภาพ, รายงาน                 ║
 * ║                                                                         ║
 * ║  Seed เองยังไม่ใช่คำตอบ — มันต้อง "รัน" ใน Domain ถึงจะเกิดผลงาน      ║
 * ║  เหมือนสูตรอาหารที่ต้องลงมือทำ ถึงจะได้จานนั้นออกมา                    ║
 * ║                                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  6 AXIOMS (กติกาข้อบังคับ ห้ามทำลายเด็ดขาด)                              ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                         ║
 * ║  A1: Seed คือแม่พิมพ์ ไม่ใช่คำตอบ                                        ║
 * ║      → ต้องรันใน Domain ถึงจะมีความหมาย                                  ║
 * ║                                                                         ║
 * ║  A2: เครื่องเสนอ คนเลือก                                                 ║
 * ║      → ห้ามใช้คะแนนอัตโนมัติตัดสินแทนคน เพราะถ้าทำ ระบบจะ "เจาะช่อง"      ║
 * ║        เพื่อให้ได้คะแนนสูง แต่ผลงานจริงๆ ไม่ดี (Goodhart's Law)            ║
 * ║                                                                         ║
 * ║  A3: ทุกการเลือกต้องมีหลักฐาน                                               ║
 * ║      → ใครเลือก? เมื่อไหร่? เพราะอะไร? ถ้าไม่มี ประวัติศาสตร์ไร้ความหมาย    ║
 * ║                                                                         ║
 * ║  A4: ต้องมีผลงานให้ดูก่อนจึงจะเลือกได้                                     ║
 * ║      → จะคัดเลือกสิ่งที่ยังไม่เห็นไม่ได้                                    ║
 * ║                                                                         ║
 * ║  A5: Seed ที่ถูกปฏิเสธ ห้ามเป็นพ่อแม่ (ยกเว้น salvage)                     ║
 * ║      → ป้องกันไม่ให้กลับไปหา seed แย่ๆ                                    ║
 * ║                                                                         ║
 * ║  A6: ค่าของ Seed มาจาก 4 เสา: หายาก + แรงงานมนุษย์ + ใช้ได้จริง + เรื่องเล่า║
 * ║      → ขาดเสาใดเสาหนึ่ง ค่าจะพังทลาย                                    ║
 * ║                                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  วงจรการทำงาน (The Curation Loop)                                      ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                         ║
 * ║  1. เลือก Seed ตัวตั้งต้น (Base Seed)                                     ║
 * ║  2. สร้าง Seed ลูกหลายตัว (Mutation → Batch)                            ║
 * ║  3. รันทุกตัวใน Domain → ได้ Artifacts หลายชิ้น                          ║
 * ║  4. คนดู Artifacts → เลือกตัวที่ดีที่สุด                                    ║
 * ║  5. บันทึกการเลือก (Lineage)                                              ║
 * ║  6. เอาตัวที่เลือกเป็น Base Seed รอบใหม่ → วนกลับไปข้อ 1                    ║
 * ║                                                                         ║
 * ║  ยิ่งทำหลายรอบ Seed ยิ่งดี เพราะมี "แรงงานมนุษย์" ฝังอยู่ทุกรอบ           ║
 * ║                                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  โครงสร้าง Seed แบบภาพรวม                                               ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                         ║
 * ║  ┌─────────────────────────────┐                                        ║
 * ║  │     HEADER (48 bytes)       │  ← ข้อมูลระบบ: version, domain ID, etc.║
 * ║  ├─────────────────────────────┤                                        ║
 * ║  │   CORE FIELDS (Tier 0)      │  ← แกน: กำหนดพฤติกรรมพื้นฐาน           ║
 * ║  │   เปลี่ยนยาก, ผลกระทบสูง      │    เช่น tempo, key, mode               ║
 * ║  ├─────────────────────────────┤                                        ║
 * ║  │   TEXTURE FIELDS (Tier 1)   │  ← รายละเอียด: กำหนดความประณีต          ║
 * ║  │   เพิ่มได้เรื่อยๆ, ผลกระทบกลาง │    เช่น phrase_length, repeat_tendency  ║
 * ║  ├─────────────────────────────┤                                        ║
 * ║  │   BOND FIELDS (Tier 2)      │  ← สัญญาณเชื่อม: กำหนดความสอดคล้อง       ║
 * ║  │   เชื่อม fields ให้ไม่ขัดแย้ง  │    เช่น tempo↔density correlation      ║
 * ║  ├─────────────────────────────┤                                        ║
 * ║  │     FOOTER (32 bytes)       │  ← SHA-256 hash ตรวจความถูกต้อง         ║
 * ║  └─────────────────────────────┘                                        ║
 * ║                                                                         ║
 * ║  ภายนอกทั้งก้อนนี้ถูกบีบเป็นสตริงเดียว ดูเหมือน hash อ่านไม่ออก            ║
 * ║  เช่น: SDWR-7f2a8c9B1e4d6Qm3pR5t...                                    ║
 * ║                                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

// #############################################################################
// #############################################################################
//
//   PART 2: ประเภทข้อมูลพื้นฐาน
//   ────────────────────────────
//
//   ส่วนนี้นิยาม "ภาษา" ที่ Seed และ Domain ใช้คุยกัน
//   เหมือนกำหนดตัวอักษรก่อนจะเขียนหนังสือ
//
// #############################################################################
// #############################################################################

// ---------------------------------------------------------------------------
// 2.1 Magic Numbers — ตัวเลขวิเศษที่ใช้ระบุว่า "ไฟล์นี้คืออะไร"
// ---------------------------------------------------------------------------
//
// คอมพิวเตอร์เจอไฟล์แปลกๆ ก็ไม่รู้ว่ามันคืออะไร
// เลยใช้ "Magic Number" (ตัวเลขที่ตกลงกันไว้) ปักไว้ตอนต้นไฟล์
// เหมือนป้ายบอกว่า "ไฟล์นี้เป็นของระบบ cultivar-js"
//
// ทำไมถึงใช้เลขฐานสิบหก (0x...)? เพราะมัน compact และอ่านง่าย
// 0x5344534D = ตัวอักษร "SDSM" (cultivar-js System Manifest) ในรหัส ASCII
// 0x53445752 = ตัวอักษร "SDWR" (cultivar-js WRapped) สำหรับไฟล์ที่ห่อแล้ว
//

/** Magic number สำหรับ Seed ดิบ (ยังไม่ได้ห่อ Base58) */
export const SEED_MAGIC = 0x5344534d; // "SDSM"

/** Magic number สำหรับ Seed ที่ห่อแล้ว (Base58 encoded) */
export const WRAP_MAGIC = 0x53445752; // "SDWR"

/** เวอร์ชันรูปแบบ Seed ดั้งเดิม (16-bit IDs, scalar-only fields) */
export const SEED_VERSION_V1 = 0x0001;

/** เวอร์ชันรูปแบบ Seed v1.1 (16-bit IDs + length-delimited bonds + full-header CRC) */
export const SEED_VERSION_V1_1 = 0x0101;

/** เวอร์ชันรูปแบบ Seed v2 (24-bit IDs, arrays, composites, metadata trailer) */
export const SEED_VERSION_V2 = 0x0002;

/** เวอร์ชันปัจจุบันของรูปแบบ Seed */
export const SEED_VERSION = SEED_VERSION_V2;

/** ขนาด Header เป็น bytes (คงที่เสมอ) */
export const HEADER_SIZE = 48;

/** ขนาด Footer เป็น bytes (คงที่เสมอ — คือ SHA-256 hash) */
export const FOOTER_SIZE = 32;

/** ตำแหน่งของฟิลด์ CRC32 ภายใน header */
export const HEADER_CRC32_OFFSET = 44;

/** Magic number สำหรับ metadata trailer ของ v2 */
export const SEED_METADATA_MAGIC = 0x53445632; // "SDV2"

export function isSeedVersionV1(version: number): boolean {
  return version === SEED_VERSION_V1;
}

export function isSeedVersionV1_1(version: number): boolean {
  return version === SEED_VERSION_V1_1;
}

export function isSeedVersionV2(version: number): boolean {
  return version === SEED_VERSION_V2;
}

export function isSupportedSeedVersion(version: number): boolean {
  return (
    isSeedVersionV1(version) ||
    isSeedVersionV1_1(version) ||
    isSeedVersionV2(version)
  );
}

function uses16BitFieldIds(version: number): boolean {
  return isSeedVersionV1(version) || isSeedVersionV1_1(version);
}

function usesLegacyBondEncoding(version: number): boolean {
  return isSeedVersionV1(version);
}

function usesLengthDelimitedBondEncoding(version: number): boolean {
  return isSeedVersionV1_1(version) || isSeedVersionV2(version);
}

function usesFullHeaderCRC(version: number): boolean {
  return isSeedVersionV1_1(version) || isSeedVersionV2(version);
}

function supportsMetadataTrailer(version: number): boolean {
  return isSeedVersionV2(version);
}

// ---------------------------------------------------------------------------
// 2.2 Field Type Tags — ประเภทของข้อมูลแต่ละ field
// ---------------------------------------------------------------------------
//
// แต่ละ field ใน Seed มี "ป้าย" (type tag) บอกว่าค่านั้นเป็นตัวเลขแบบไหน
// เหมือนในฟอร์มที่มี "ช่องกรอกตัวเลข" กับ "ช่องกรอกข้อความ"
// ถ้าไม่มีป้าย parser จะไม่รู้ว่า bytes ถัดไปควรอ่านแค่ไหน
//

export enum FieldTypeTag {
  /** จำนวนเต็ม 0-255 (1 byte) — เช่น mode, key_center */
  UINT8 = 0x01,
  /** จำนวนเต็ม 0-65535 (2 bytes) — เช่น field IDs, phrase_length */
  UINT16 = 0x02,
  /** จำนวนเต็ม 0-4,294,967,295 (4 bytes) — เช่น generation count */
  UINT32 = 0x03,
  /** จำนวนเต็ม 0-18,446,744,073,709,551,615 (8 bytes)
   *  ⚠️ เกินความปลอดภัยของ JavaScript number (2^53) ต้องใช้ BigInt */
  UINT64 = 0x04,
  /** ทศนิยม 32-bit (4 bytes) — เช่น tempo, density, weight */
  FLOAT32 = 0x05,
  /** ทศนิยม 64-bit (8 bytes) — สำหรับค่าที่ต้องการความแม่นยำสูง */
  FLOAT64 = 0x06,
  /** ค่าจริง/เท็จ (1 byte: 0x00 = false, 0x01 = true) */
  BOOL = 0x07,
  /** ข้อมูลไบนารีดิบ — มี 2-byte length นำหน้า แล้วตามด้วยข้อมูล */
  BYTES = 0x08,
  /** ข้อความ UTF-8 — มี 2-byte length นำหน้า แล้วตามด้วยตัวอักษร */
  STRING = 0x09,
  /** รายการของค่าที่มี type เหมือนกันทั้งหมด */
  ARRAY = 0x0a,
  /** ข้อมูลแบบมีโครงสร้างภายใน (nested / hierarchical) */
  COMPOSITE = 0x0b,
}

/**
 * แปลง Type Tag เป็นขนาดเป็น bytes
 *
 * สำคัญมาก: UINT64 ใน JavaScript ต้องใช้ BigInt เพราะ number ปกติ
 * จะเสีย precision เกิน 2^53 (ค่าประมาณ 9 × 10^15)
 * ถ้าใช้ number ธรรมดา ค่าจะ "กลม" ผิดเพี้ยน
 */
export function typeTagToSize(tag: FieldTypeTag): number | null {
  switch (tag) {
    case FieldTypeTag.UINT8:
      return 1;
    case FieldTypeTag.UINT16:
      return 2;
    case FieldTypeTag.UINT32:
      return 4;
    case FieldTypeTag.UINT64:
      return 8;
    case FieldTypeTag.FLOAT32:
      return 4;
    case FieldTypeTag.FLOAT64:
      return 8;
    case FieldTypeTag.BOOL:
      return 1;
    // BYTES และ STRING มีขนาดผันแปร → ต้องอ่าน length prefix ก่อน
    case FieldTypeTag.BYTES:
    case FieldTypeTag.STRING:
    case FieldTypeTag.ARRAY:
    case FieldTypeTag.COMPOSITE:
      return null; // variable length
    default:
      throw new Error(
        `Unknown type tag: 0x${(tag as number).toString(16).padStart(2, "0")}`,
      );
  }
}

export type PrimitiveFieldValue =
  | number
  | bigint
  | boolean
  | Uint8Array
  | string;

export interface ArrayFieldValue {
  kind: "array";
  elementTypeTag: FieldTypeTag;
  items: FieldValue[];
}

export interface CompositeFieldValue {
  kind: "composite";
  schemaId: number;
  fields: SeedField[];
}

export type FieldValue =
  | PrimitiveFieldValue
  | ArrayFieldValue
  | CompositeFieldValue;

export function isArrayFieldValue(value: FieldValue): value is ArrayFieldValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "array"
  );
}

export function isCompositeFieldValue(
  value: FieldValue,
): value is CompositeFieldValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "composite"
  );
}

// ---------------------------------------------------------------------------
// 2.3 Field ID Ranges — ช่วงตัวเลขที่บอกว่า field นี้อยู่ชั้นไหน
// ---------------------------------------------------------------------------
//
// ลองนึกถึงอาคาร 3 ชั้น:
//   ชั้น 1 (Core)    = ห้อง 1-999
//   ชั้น 2 (Texture) = ห้อง 1000-1999
//   ชั้น 3 (Bond)    = ห้อง 2000-2999
//
// ถ้าเห็นห้องเลข 1500 ก็รู้ทันทีว่าอยู่ชั้น Texture
// ไม่ต้องมีป้ายบอกแยก — ตัวเลขบอกทุกอย่าง
//

/** Field IDs v1: Core fields (แกน, เปลี่ยนยาก, ผลกระทบสูง) */
export const LEGACY_CORE_FIELD_ID_MIN = 0x0001; // 1
export const LEGACY_CORE_FIELD_ID_MAX = 0x03e7; // 999

/** Field IDs v1: Texture fields (รายละเอียด, เพิ่มได้เรื่อยๆ) */
export const LEGACY_TEXTURE_FIELD_ID_MIN = 0x03e8; // 1000
export const LEGACY_TEXTURE_FIELD_ID_MAX = 0x07cf; // 1999

/** Field IDs v1: Bond fields (สัญญาณเชื่อมระหว่าง fields) */
export const LEGACY_BOND_FIELD_ID_MIN = 0x07d0; // 2000
export const LEGACY_BOND_FIELD_ID_MAX = 0x0bb7; // 2999

/** Field IDs v2: Core fields */
export const CORE_FIELD_ID_MIN = 0x000001;
export const CORE_FIELD_ID_MAX = 0x00ffff;

/** Field IDs v2: Texture fields */
export const TEXTURE_FIELD_ID_MIN = 0x010000;
export const TEXTURE_FIELD_ID_MAX = 0x01ffff;

/** Field IDs v2: Bond fields */
export const BOND_FIELD_ID_MIN = 0x020000;
export const BOND_FIELD_ID_MAX = 0x02ffff;

/**
 * ตรวจสอบว่า field ID นี้อยู่ชั้นไหน
 *
 * ใช้ทุกครั้งที่ต้องรู้ว่า field นี้เป็น Core, Texture หรือ Bond
 * เช่น ตอน parse seed, ตอน apply mutation, ตอนแสดงผลให้ user
 */
export function getFieldTier(
  fieldId: number,
  version: number = SEED_VERSION,
): "core" | "texture" | "bond" | "unknown" {
  if (uses16BitFieldIds(version)) {
    if (
      fieldId >= LEGACY_CORE_FIELD_ID_MIN &&
      fieldId <= LEGACY_CORE_FIELD_ID_MAX
    )
      return "core";
    if (
      fieldId >= LEGACY_TEXTURE_FIELD_ID_MIN &&
      fieldId <= LEGACY_TEXTURE_FIELD_ID_MAX
    )
      return "texture";
    if (
      fieldId >= LEGACY_BOND_FIELD_ID_MIN &&
      fieldId <= LEGACY_BOND_FIELD_ID_MAX
    )
      return "bond";
    return "unknown";
  }
  if (fieldId >= CORE_FIELD_ID_MIN && fieldId <= CORE_FIELD_ID_MAX)
    return "core";
  if (fieldId >= TEXTURE_FIELD_ID_MIN && fieldId <= TEXTURE_FIELD_ID_MAX)
    return "texture";
  if (fieldId >= BOND_FIELD_ID_MIN && fieldId <= BOND_FIELD_ID_MAX)
    return "bond";
  return "unknown";
}

// ---------------------------------------------------------------------------
// 2.4 Bond Relationship Types — ประเภทของความสัมพันธ์ระหว่าง fields
// ---------------------------------------------------------------------------
//
// ลองนึกถึงความสัมพันธ์ระหว่างคน:
//   - CORRELATE = "ถ้า A เพิ่ม B ก็เพิ่มด้วย" (เพื่อนร่วมทาง)
//   - CONSTRAIN = "ถ้า A เป็นแบบนี้ B ต้องอยู่ในขอบเขตนี้" (ผู้คุม)
//   - SEQUENCE  = "B เกิดหลัง A หน่วย" (คิว)
//   - INHIBIT   = "A กด B" (ศัตรู)
//   - AMPLIFY   = "A ขยาย B" (เพื่อนสนิทที่ช่วยโฆษณา)
//

export enum RelationshipType {
  /** เมื่อ source เปลี่ยน target ก็เปลี่ยนตาม (ทิศทางเดียวกันหรือตรงข้าม) */
  CORRELATE = 0x01,
  /** เมื่อ source "ทำงาน" target ถูกบังคับให้อยู่ในช่วง [min, max] */
  CONSTRAIN = 0x02,
  /** target เริ่มทำงานหลัง source ไป `offset` ก้าว */
  SEQUENCE = 0x03,
  /** source กด/ลดผลของ target ลง */
  INHIBIT = 0x04,
  /** source เพิ่ม/ขยายผลของ target */
  AMPLIFY = 0x05,
  /** ปรับค่า target เมื่อหลาย source เข้าเงื่อนไขพร้อมกัน */
  CONDITIONAL_BLEND = 0x06,
  /** รวมค่าแบบถ่วงน้ำหนัก Σ(source_i × weight_i) */
  WEIGHTED_SUM = 0x07,
  /** เปิด/ปิดผลของ target ตาม threshold ของหลาย source */
  THRESHOLD_GATE = 0x08,
}

export enum BondBlendModeTag {
  ADDITIVE = 0x01,
  MULTIPLICATIVE = 0x02,
  CONDITIONAL = 0x03,
}

export type BondBlendMode = "additive" | "multiplicative" | "conditional";

export interface BondSourceRef {
  fieldId: number;
  weight: number;
}

export interface BondTargetRef {
  fieldId: number;
  blendMode: BondBlendMode;
}

export interface FieldCondition {
  field: number | string;
  op: "<" | "<=" | ">" | ">=" | "==" | "!=" | "in" | "not_in";
  value: PrimitiveFieldValue | PrimitiveFieldValue[];
}

// ---------------------------------------------------------------------------
// 2.5 Size Constraints — ขอบเขตขนาดของ Seed
// ---------------------------------------------------------------------------
//
// ทำไมต้องจำกัดขนาด?
// - ถ้า Seed ใหญ่เกินไป → ส่งผ่านเน็ตช้า, เก็บใน DB แพง
// - ถ้า Texture ไม่จำกัด → seed ที่ tune มากๆ อาจบวมจนไม่มีทางใช้ได้จริง
// - 64KB สำหรับ texture นั้นใหญ่พอที่จะระบุรายละเอียดได้อย่างละเอียดมาก
//

export const SEED_SIZE_LIMITS = {
  /** ขนาด Header: คงที่เสมอ 48 bytes */
  header: 48,
  /** Core fields: สูงสุด 4096 bytes (domain เป็นคนกำหนดว่าจะใช้เท่าไหร่) */
  coreMax: 4096,
  /** Texture fields: สูงสุด 65536 bytes = 64 KB */
  textureMax: 65536,
  /** Bond fields: สูงสุด 16384 bytes = 16 KB */
  bondMax: 16384,
  /** ขนาดรวมสูงสุด ≈ 86 KB */
  totalMax: 48 + 4096 + 65536 + 16384 + 32,
} as const;

// ---------------------------------------------------------------------------
// 2.6 Curation Actions — สิ่งที่คนทำได้เมื่อดู Artifact
// ---------------------------------------------------------------------------

export enum CurationAction {
  /** "ชอบตัวนี้! เอาเป็นฐานรอบหน้า" — ต้องมีอย่างน้อย 1 tag */
  SELECT = "select",
  /** "ไม่ดีพอ" — ตัวนี้จะไม่ได้เป็นพ่อแม่ของรอบต่อไป */
  REJECT = "reject",
  /** "ภาพรวมไม่ดี แต่มีส่วนที่น่าสนใจ" — ดึงส่วนดีออกมาใช้ต่อ */
  SALVAGE = "salvage",
  /** "ตอนนี้ไม่ดี แต่อนาคตอาจเป็นประโยชน์" — เก็บไว้ในคลัง */
  ARCHIVE = "archive",
}

// ---------------------------------------------------------------------------
// 2.7 Constraint Enforcement Modes — วิธีจัดการเมื่อผลงานผิดกฎ
// ---------------------------------------------------------------------------

export enum EnforcementMode {
  /**
   * REJECT: ผลงานผิดกฎ → ไม่เอาเลย สร้าง "error artifact" แทน
   * ใช้กับกฎที่ห้ามละเมิดเด็ดขาด เช่น ผลงานทางการแพทย์ผิดเกณฑ์
   */
  REJECT = "reject",

  /**
   * CLAMP: ผลงานผิดกฎ → แก้ให้อยู่ในขอบเขตที่ถูกต้อง (แก้น้อยที่สุด)
   * เช่น โน้ตเกินช่วงมือคน → ดึงกลับมาในช่วงที่เล่นได้
   */
  CLAMP = "clamp",

  /**
   * NEAREST: ผลงานผิดกฎ → ค้นหาผลงานที่ใกล้เคียงที่สุดที่ผ่านกฎ
   * ใช้ทรัพยากรมากกว่าแต่ผลดีกว่า
   */
  NEAREST = "nearest",
}

// ---------------------------------------------------------------------------
// 2.8 Mutation Radius Presets — ระดับความกล้าของการเปลี่ยนแปลง
// ---------------------------------------------------------------------------
//
// ลองนึกถึงปรับเสียงเพลง:
//   FINE   = หมุน knob นิดเดียว (เสียงเกือบเหมือนเดิม แต่ดีขึ้นนิดหน่อย)
//   MEDIUM = หมุนปานกลาง (เปลี่ยนบ้างแต่ยังอยู่ในทิศทางเดียวกัน)
//   BROAD  = หมุนเยอะ (เปลี่ยนทิศทางได้ แต่อาจได้ขยะ)
//   WILD   = สุ่มหมด (เสี่ยงมาก แต่อาจเจอของดีที่ไม่คาดคิด)
//

export interface RadiusSetting {
  /** โอกาสที่ core field แต่ละตัวจะถูกเปลี่ยน (0 = ไม่เปลี่ยนเลย, 1 = เปลี่ยนทุกตัว) */
  coreMutationRate: number;
  /** ขนาดการเปลี่ยนแปลงสูงสุดของ core field (เศษส่วน เช่น 0.05 = เปลี่ยนได้ ±5%) */
  coreMutationMagnitude: number;
  /** จำนวน texture fields ใหม่ที่จะเพิ่มเข้าไป */
  textureGrowthCount: number;
  /** โอกาสที่ texture field เดิมจะถูกปรับค่า */
  textureEditRate: number;
  /** ขนาดการปรับค่า texture สูงสุด */
  textureEditMagnitude: number;
  /** จำนวน bond fields ใหม่ที่จะเพิ่ม */
  bondGrowthCount: number;
  /** โอกาสที่ bond field เดิมจะถูกปรับ */
  bondEditRate: number;
}

export const RADIUS_PRESETS: Record<string, RadiusSetting> = {
  /** ปรับแต่งละเอียด — สำหรับรอบท้ายๆ ที่ seed ดีแล้ว อยากขัดเกลาเพิ่ม */
  fine: {
    coreMutationRate: 0.05,
    coreMutationMagnitude: 0.02,
    textureGrowthCount: 0,
    textureEditRate: 0.3,
    textureEditMagnitude: 0.05,
    bondGrowthCount: 0,
    bondEditRate: 0,
  },
  /** ปรับปานกลาง — ค่า default สำหรับส่วนใหญ่ */
  medium: {
    coreMutationRate: 0.1,
    coreMutationMagnitude: 0.05,
    textureGrowthCount: 2,
    textureEditRate: 0.2,
    textureEditMagnitude: 0.1,
    bondGrowthCount: 1,
    bondEditRate: 0.1,
  },
  /** ปรับกว้าง — สำหรับตอนต้นที่ยังหาทิศทาง */
  broad: {
    coreMutationRate: 0.2,
    coreMutationMagnitude: 0.15,
    textureGrowthCount: 5,
    textureEditRate: 0.15,
    textureEditMagnitude: 0.2,
    bondGrowthCount: 2,
    bondEditRate: 0.15,
  },
  /** ปรับบ้า — "ลองดูสิ เผื่อเจออะไรใหม่" */
  wild: {
    coreMutationRate: 0.4,
    coreMutationMagnitude: 0.3,
    textureGrowthCount: 10,
    textureEditRate: 0.1,
    textureEditMagnitude: 0.3,
    bondGrowthCount: 3,
    bondEditRate: 0.2,
  },
};

// #############################################################################
// #############################################################################
//
//   PART 3: โครงสร้าง Seed (TypeScript Interfaces)
//   ──────────────────────────────────────────────
//
//   ส่วนนี้นิยามรูปร่างของ Seed ใน TypeScript
//   คิดว่าแต่ละ interface เป็น "พิมพ์เขียว" ของสิ่งของแต่ละชนิด
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SeedField — หน่วยข้อมูลเล็กที่สุดใน Seed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * แต่ละ field ก็เหมือน "บรรทัดในฟอร์ม" — มีชื่อ (id) มีประเภท (typeTag)
 * และมีค่า (value)
 *
 * ตัวอย่าง: field id=1, type=float32, value=120.0 หมายถึง "tempo = 120 BPM"
 *
 * สิ่งสำคัญ: value อาจเป็นได้หลายแบบ:
 * - number สำหรับตัวเลขธรรมดา
 * - bigint สำหรับ uint64 (JavaScript number ไม่ปลอดภัยเกิน 2^53)
 * - boolean สำหรับค่าจริง/เท็จ
 * - Uint8Array สำหรับข้อมูลไบนารี
 * - string สำหรับข้อความ
 */
export interface SeedField {
  /** Field ID — ตัวเลขที่บอกว่า field นี้คืออะไร (เช่น 1 = tempo, 2 = key_center) */
  id: number;

  /** ประเภทของค่า — บอกว่าจะอ่าน/เขียนค่านี้อย่างไร */
  typeTag: FieldTypeTag;

  /** ค่าของ field — ประเภทตาม typeTag */
  value: FieldValue;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BondParameters — พารามิเตอร์ของ Bond ตามประเภทความสัมพันธ์
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * แต่ละประเภท Bond มีพารามิเตอร์ต่างกัน:
 * - CORRELATE: ρ (rho) = ความสัมพันธ์ -1 ถึง 1
 * - CONSTRAIN: min, max = ขอบเขต
 * - SEQUENCE: offset = จำนวนก้าว
 * - INHIBIT: strength = ความแรงของการกด 0-1
 * - AMPLIFY: factor = ตัวคูณ ≥ 1.0
 *
 * เราใช้ union type เพื่อให้ TypeScript ช่วยตรวจสอบว่าใส่พารามิเตอร์ถูก
 */
export type BondParameters =
  | { type: RelationshipType.CORRELATE; rho: number; influence?: number } // ρ ∈ [-1, 1]
  | { type: RelationshipType.CONSTRAIN; min: number; max: number }
  | { type: RelationshipType.SEQUENCE; offset: number } // uint16
  | { type: RelationshipType.INHIBIT; strength: number } // ∈ [0, 1]
  | { type: RelationshipType.AMPLIFY; factor: number } // ≥ 1.0
  | {
      type: RelationshipType.CONDITIONAL_BLEND;
      conditions: FieldCondition[];
      blendFactor?: number;
      targetMin?: number;
      targetMax?: number;
      fallbackValue?: number;
    }
  | {
      type: RelationshipType.WEIGHTED_SUM;
      bias?: number;
      clamp?: [number, number];
    }
  | {
      type: RelationshipType.THRESHOLD_GATE;
      threshold: number;
      activeValue?: number;
      inactiveValue?: number;
    };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BondField — ความสัมพันธ์ระหว่าง fields
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bond เหมือน "กฎ" ที่บอกว่า field A กับ field B เกี่ยวข้องกันอย่างไร
 *
 * ตัวอย่างในโดเมนเพลง:
 *   source = tempo (field id 1)
 *   target = density (field id 4)
 *   type = CORRELATE, rho = 0.6
 *   หมายความว่า: "เทมโปเร็วขึ้น → ความหนาแน่นของโน้ตมักเพิ่มตาม"
 *
 * ถ้าไม่มี Bond → fields ทำงานอิสระ → อาจขัดแย้งกัน
 *   เช่น เทมโปเร็ว + โน้ตยาว → เล่นไม่ไหว!
 *   Bond จะช่วยประสานให้ไม่ขัดแย้ง
 */
export interface BondField {
  /** Bond ID — ตัวระบุของ bond นี้ (อยู่ในช่วง 2000-2999) */
  id: number;

  /** Field ต้นทาง — รูปแบบเก่า 1→1 */
  sourceFieldId?: number;

  /** Field ปลายทาง — รูปแบบเก่า 1→1 */
  targetFieldId?: number;

  /** Field ต้นทางหลายตัว + น้ำหนัก */
  sources?: BondSourceRef[];

  /** ปลายทางของ bond ในระบบ v2 */
  target?: BondTargetRef;

  /** ประเภทและพารามิเตอร์ของความสัมพันธ์ */
  parameters: BondParameters;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SeedHeader — ส่วนหัวของ Seed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Header เหมือน "ปกหนังสือ" — บอกข้อมูลระบบก่อนจะเปิดอ่านเนื้อหาข้างใน
 * มีขนาดคงที่ 48 bytes เสมอ ทำให้ parser รู้ว่าต้องอ่านกี่ bytes
 *
 * สิ่งสำคัญใน Header:
 * - domainId: บอกว่า Seed นี้ออกแบบมาสำหรับ Domain ไหน
 *   (เหมือนปลั๊กอินที่บอกว่าใช้กับโปรแกรมอะไร)
 * - generation: จำนวนรอบที่ผ่านการ tune มา (ยิ่งสูง = ผ่านมือคนมาเยอะ)
 * - entropyBudget: ควบคุมความสุ่ม (0 = ทำซ้ำได้เป๊ะ, 255 = สุ่มมาก)
 */
export interface SeedHeader {
  /** Magic number — ต้องเป็น 0x5344534D ("SDSM") เสมอ */
  magic: number;

  /** เวอร์ชันรูปแบบ — ปัจจุบัน 0x0001 */
  version: number;

  /** UUID ของ Domain ที่ Seed นี้สร้างมาให้ — เหมือน "รหัสประเทศ" บนหนังสือเดินทาง */
  domainId: string;

  /** จำนวนรอบ tuning ที่ผ่านมา — 0 = สร้างใหม่, 10 = ผ่านการ tune 10 รอบ */
  generation: number;

  /**
   * งบความสุ่ม (0-255):
   *   0   = deterministic (seed เดียวกัน → ผลเดียวกันเสมอ)
   *   128 = สุ่มปานกลาง
   *   255 = สุ่มเต็มที่
   *
   * ทำไมต้องมี? เพราะบาง Domain ต้องการความสุ่ม (แต่งเพลง)
   * แต่บาง Domain ห้ามสุ่ม (วิเคราะห์ทางการแพทย์)
   */
  entropyBudget: number;

  /** ขนาดส่วน Core เป็น bytes */
  coreSize: number;

  /** ขนาดส่วน Texture เป็น bytes */
  textureSize: number;

  /** ขนาดส่วน Bond เป็น bytes */
  bondSize: number;

  /** Flags — บิตพิเศษ:
   *   bit 0 = มีต้นกำเนิดจาก salvage หรือไม่
   *   bit 1-31 = สงวนไว้ (ยังไม่ใช้)
   */
  flags: number;

  /** CRC32 checksum — ตรวจว่าข้อมูลเสียหรือไม่ */
  crc32: number;

  /** เวอร์ชัน schema ของ Domain ที่ seed นี้ถูกสร้างมาจาก (v2 metadata) */
  domainSchemaVersion?: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Seed — โครงสร้างหลักของทั้งระบบ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Seed คือ "แม่พิมพ์" — เวลาเอาไปรันใน Domain ถึงจะเกิดผลงาน
 *
 * โครงสร้างแบบชั้น:
 *   Tier 0 (Core)    = แกน ไม่ค่อยเปลี่ยน เปลี่ยนแล้วผลกระทบสูง
 *   Tier 1 (Texture) = รายละเอียด เพิ่มได้เรื่อยๆ ยิ่งเยอะยิ่งประณีต
 *   Tier 2 (Bond)    = สัญญาณเชื่อม ประสานให้ fields ไม่ขัดแย้ง
 *
 * ทำไมต้องแบ่ง 3 ชั้น?
 *   - ถ้ามีแค่ชั้นเดียว → mutation จะไม่รู้ว่าอะไรเปลี่ยนได้เยอะ/น้อย
 *   - แบ่งชั้นแล้ว → mutation จะรู้ว่า core เปลี่ยนนิดหน่อย (เสี่ยง)
 *     แต่ texture เปลี่ยนได้เยอะ (ปลอดภัย)
 */
export interface Seed {
  /** ส่วนหัว — ข้อมูลระบบ */
  header: SeedHeader;

  /** Core fields — แกนของ Seed (เปลี่ยนยาก, ผลกระทบสูง) */
  coreFields: SeedField[];

  /** Texture fields — รายละเอียด (เพิ่มได้เรื่อยๆ, ยิ่งเยอะยิ่งประณีต) */
  textureFields: SeedField[];

  /** Bond fields — สัญญาณเชื่อม (ทำให้ fields ไม่ขัดแย้งกัน) */
  bondFields: BondField[];

  /**
   * SHA-256 hash ของ Seed นี้
   * ทำหน้าที่ 2 อย่าง:
   * 1. ตรวจความถูกต้อง — ถ้าข้อมูลเสีย hash จะไม่ตรง
   * 2. เป็น "ชื่อ" ของ Seed — seed สองอันที่เหมือนกันจะมี hash เดียวกัน
   */
  contentHash: string; // hex-encoded SHA-256

  /** คำเตือนจาก parser เช่น unknown bond types ที่ถูก skip */
  parseWarnings?: string[];
}

// #############################################################################
// #############################################################################
//
//   PART 4: โครงสร้าง Domain (TypeScript Interfaces)
//   ─────────────────────────────────────────────
//
//   Domain คือ "สภาพแวดล้อม" ที่ Seed มารัน
//   เหมือนเครื่องซิงค์ที่รับ "สูตรอาหาร" (Seed) แล้วผลิต "อาหาร" (Artifact) ออกมา
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DomainFieldDefinition — นิยามของ field หนึ่งๆ ใน Domain
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Domain เป็นคนกำหนดว่า field แต่ละตัว:
 * - ชื่ออะไร
 * - ประเภทอะไร
 * - ค่าอยู่ในช่วงไหน
 * - หมายถึงอะไร (semantics)
 * - จำเป็นต้องมีหรือไม่
 *
 * เหมือน "คู่มือ" ที่บอกว่าฟอร์มแต่ละช่องให้กรอกอะไร
 */
export interface DomainFieldDefinition {
  /** Field ID — ตัวเลขระบุ */
  id: number;

  /** ชื่อที่คนอ่านได้ — เช่น "tempo", "key_center" */
  name: string;

  /** ประเภทข้อมูล */
  typeTag: FieldTypeTag;

  /** จำเป็นต้องมี? (สำหรับ core fields เท่านั้น, texture/bond ไม่จำเป็นเสมอ) */
  required?: boolean;

  /** ค่าเริ่มต้น — ใช้เมื่อ Seed ไม่ได้ระบุ field นี้ */
  default?: FieldValue;

  /** ขอบเขตค่า (สำหรับประเภทตัวเลข) — [ค่าต่ำสุด, ค่าสูงสุด] */
  range?: [number, number];

  /** ช่วงตัดสินใจสำหรับ entropy/generator เมื่อไม่มี range หลัก */
  decisionRange?: { min: number; max: number };

  /** คำอธิบายภาษาคน — บอกว่า field นี้ควบคุมอะไร */
  semantics: string;

  /**
   * น้ำหนักสำหรับการเติบโต — ยิ่งสูงยิ่งมีโอกาสถูกเพิ่มใน texture growth
   * (ใช้กับ texture fields เท่านั้น)
   */
  growthWeight?: number;

  /** ถ้าเป็น ARRAY: type ของสมาชิก */
  elementTypeTag?: FieldTypeTag;

  /** ถ้าเป็น COMPOSITE: ชื่อ schema ใน DomainManifest.compositeSchemas */
  compositeSchema?: string;
}

export interface CompositeSchemaDefinition {
  id: number;
  name: string;
  fields: DomainFieldDefinition[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DomainBondDefinition — นิยามของ Bond ที่ Domain รองรับ
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface DomainBondDefinition {
  /** Bond ID */
  id: number;

  /** ชื่อ */
  name: string;

  /** Field ต้นทางแบบเก่า */
  sourceField?: number;

  /** Field ปลายทางแบบเก่า */
  targetField?: number;

  /** alias แบบเก่าอีกชื่อหนึ่ง เพื่อให้ v1 code เดิมยังใช้ได้ */
  target?: number;

  /** หลาย source + น้ำหนัก */
  sources?: BondSourceRef[];

  /** ปลายทางแบบ v2 */
  targetRef?: BondTargetRef;

  /** ประเภทความสัมพันธ์ที่รองรับ */
  relationshipTypes: RelationshipType[];

  /** ค่าพารามิเตอร์เริ่มต้น */
  defaultParameters: BondParameters;

  /** คำอธิบาย */
  semantics: string;
}

export interface DeclarativeRule {
  field: string;
  operator: "<" | "<=" | ">" | ">=" | "==" | "!=" | "in" | "not_in";
  value: PrimitiveFieldValue | PrimitiveFieldValue[];
  scope?: string;
  message?: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DomainConstraint — กฎที่ผลงานต้องเป็นไปตาม
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Constraint ต่างจาก Bond:
 * - Bond คือความสัมพันธ์ระหว่าง fields (ภายใน Seed)
 * - Constraint คือกฎที่ผลงานต้องเป็นไปตาม (ภายนอก Seed)
 *
 * เช่น "โน้ตห้ามกว้างเกินมือคน" เป็น constraint ของ Domain เพลง
 * Seed จะใส่ค่าอะไรก็ได้ แต่เวลาผลิตออกมาแล้ว ต้องผ่านกฎนี้
 */
export interface DomainConstraint {
  /** ชื่อกฎ */
  id: string;

  /** คำอธิบายภาษาคน */
  description: string;

  /** วิธีจัดการเมื่อผิดกฎ: reject (ไม่เอา), clamp (แก้ให้), nearest (หาอันใกล้) */
  enforcement: EnforcementMode;

  /**
   * ฟังก์ชันตรวจสอบ — รับ artifact มา ตอบ true ถ้าผ่าน
   *
   * ⚠️ หมายเหตุ: function ไม่สามารถ serialize ได้
   * ใน production ควรเปลี่ยนเป็น declarative rule language แทน
   * เช่น JSON: { "field": "max_chord_span", "op": "<=", "value": 19 }
   */
  check?: (artifact: unknown) => boolean;

  /** กฎแบบ declarative ที่ serialize ได้ */
  rules?: DeclarativeRule[];
}

export interface KnowledgeReference {
  type: string;
  uuid: string;
  version: string;
  required: boolean;
  fallback?: string;
}

export interface MigrationStep {
  field: number;
  operation: "multiply" | "add" | "rename" | "split" | "merge" | "delete";
  parameters: Record<string, unknown>;
  reason: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DomainManifest — "สัญญา" ระหว่าง Domain กับ Seed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Manifest เป็นเหมือน "คู่มือการใช้งาน" ของ Domain
 * บอกว่า:
 * - Domain นี้รับ core fields อะไรบ้าง (จำเป็นหรือไม่)
 * - Texture fields อะไรให้ปรับได้ (ค่า default คืออะไร)
 * - Bond อะไรให้ใส่ได้
 * - กฎอะไรบ้างที่ผลงานต้องผ่าน
 * - Domain รู้อะไรอยู่แล้วโดยไม่ต้องใส่ใน Seed
 *
 * ทุก Domain ต้องประกาศ Manifest นี้ — ไม่งั้น Seed จะไม่รู้จะกรอกอะไร
 */
export interface DomainManifest {
  /** UUID ของ Domain — ต้องไม่ซ้ำกับ Domain อื่น */
  id: string;

  /** ชื่อที่คนอ่านได้ */
  name: string;

  /** เวอร์ชัน (semantic versioning) — เช่น "1.2.3" */
  version: string;

  /** คำอธิบาย */
  description: string;

  /**
   * โหมดการทำงาน:
   * - "deterministic" = seed เดียวกัน → ผลเดียวกันเสมอ (เช่น การวิเคราะห์ทางการแพทย์)
   * - "nondeterministic" = seed เดียวกันอาจได้ผลต่างกัน (เช่น แต่งเพลง)
   */
  determinism: "deterministic" | "nondeterministic";

  /** ค่า entropy เริ่มต้น — 0 ถ้า deterministic */
  entropyBudgetDefault: number;

  /** นิยามของ Core fields — แกนของ Seed */
  coreFields: DomainFieldDefinition[];

  /** นิยามของ Texture fields — รายละเอียด */
  textureFields: DomainFieldDefinition[];

  /** นิยามของ Bond fields — สัญญาณเชื่อม */
  bondFields: DomainBondDefinition[];

  /** schema สำหรับ composite fields */
  compositeSchemas?: Record<string, CompositeSchemaDefinition>;

  /** กฎที่ผลงานต้องผ่าน */
  constraints: DomainConstraint[];

  /** ความรู้ที่ Domain มีอยู่แล้ว — Seed ไม่ต้องใส่เอง */
  knowledge: {
    /** Domain รู้อะไรอยู่แล้ว (เช่น "รู้ chord progressions มาตรฐาน") */
    description: string;
    /** ถ้า Seed ว่างๆ จะเกิดอะไรขึ้น? (เช่น "สร้างเพลง C major ธรรมดา") */
    defaultBehavior: string;
    /** อ้างอิง knowledge modules ภายนอก */
    references?: KnowledgeReference[];
  };

  /** migration ระหว่าง schema versions ของ domain */
  migrations?: Record<string, MigrationStep[]>;
}

export interface KnowledgeModule {
  uuid: string;
  version: string;
  payload: unknown;
}

export interface ResolvedKnowledgeReference {
  reference: KnowledgeReference;
  resolvedUuid: string | null;
  status: "resolved" | "fallback" | "missing";
  module?: KnowledgeModule;
}

export interface MigrationAuditRecord {
  fromVersion: string;
  toVersion: string;
  step: MigrationStep;
}

export interface TransportableDomainConstraint
  extends Omit<DomainConstraint, "check" | "rules"> {
  rules: DeclarativeRule[];
}

export interface TransportableDomainManifest
  extends Omit<DomainManifest, "constraints"> {
  constraints: TransportableDomainConstraint[];
}

export interface LineageStore {
  append(record: LineageRecord): void;
  loadAll(): LineageRecord[];
}

export interface SeedDistanceWeights {
  core: number;
  texture: number;
  bond: number;
}

export interface BatchShortlist {
  batch: Seed[];
  representativeIndices: number[];
  clusterAssignments: number[];
}

export interface RadiusRecommendation {
  recommendedRadius: keyof typeof RADIUS_PRESETS;
  exploratoryRestartRatio: number;
  reason: string;
}

export interface StagnationAssessment {
  stagnant: boolean;
  noveltyStreak: number;
  meanNovelty: number;
  tagCollapse: boolean;
  recommendation: RadiusRecommendation | null;
}

export interface ResolvedSeedState {
  byFieldId: Map<number, FieldValue>;
  byName: Record<string, unknown>;
  metadata: {
    knowledge: ResolvedKnowledgeReference[];
    migrationAuditTrail: MigrationAuditRecord[];
    bondApplications: ArtifactMetadata["bondApplications"];
  };
}

function getFieldIdByteWidth(version: number): number {
  return uses16BitFieldIds(version) ? 2 : 3;
}

function deepCopyFieldValue(value: FieldValue): FieldValue {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (isArrayFieldValue(value)) {
    return {
      kind: "array",
      elementTypeTag: value.elementTypeTag,
      items: value.items.map((item) => deepCopyFieldValue(item)),
    };
  }
  if (isCompositeFieldValue(value)) {
    return {
      kind: "composite",
      schemaId: value.schemaId,
      fields: value.fields.map((field) => ({
        ...field,
        value: deepCopyFieldValue(field.value),
      })),
    };
  }
  return value;
}

function normalizeBondField(bond: BondField): BondField {
  const sources =
    bond.sources && bond.sources.length > 0
      ? bond.sources.map((source) => ({ ...source }))
      : bond.sourceFieldId !== undefined
        ? [{ fieldId: bond.sourceFieldId, weight: 1.0 }]
        : [];

  const target =
    bond.target ??
    (bond.targetFieldId !== undefined
      ? {
          fieldId: bond.targetFieldId,
          blendMode: "additive" as BondBlendMode,
        }
      : undefined);

  return {
    ...bond,
    sourceFieldId: bond.sourceFieldId ?? sources[0]?.fieldId,
    targetFieldId: bond.targetFieldId ?? target?.fieldId,
    sources,
    target,
    parameters: { ...bond.parameters } as BondParameters,
  };
}

function normalizeDomainBondDefinition(
  bond: DomainBondDefinition,
): DomainBondDefinition {
  const sources =
    bond.sources && bond.sources.length > 0
      ? bond.sources.map((source) => ({ ...source }))
      : bond.sourceField !== undefined
        ? [{ fieldId: bond.sourceField, weight: 1.0 }]
        : [];

  const targetRef =
    bond.targetRef ??
    (bond.target !== undefined
      ? {
          fieldId: bond.target,
          blendMode: "additive" as BondBlendMode,
        }
      : undefined);

  return {
    ...bond,
    sourceField: bond.sourceField ?? sources[0]?.fieldId,
    target: bond.target ?? targetRef?.fieldId,
    sources,
    targetRef,
    defaultParameters: { ...bond.defaultParameters } as BondParameters,
  };
}

function normalizeSeed(seed: Seed): Seed {
  return {
    ...seed,
    header: { ...seed.header },
    coreFields: seed.coreFields.map((field) => ({
      ...field,
      value: deepCopyFieldValue(field.value),
    })),
    textureFields: seed.textureFields.map((field) => ({
      ...field,
      value: deepCopyFieldValue(field.value),
    })),
    bondFields: seed.bondFields.map((bond) => normalizeBondField(bond)),
    parseWarnings: seed.parseWarnings ? [...seed.parseWarnings] : undefined,
  };
}

function normalizeManifest(domain: DomainManifest): DomainManifest {
  return {
    ...domain,
    coreFields: domain.coreFields.map((field) => ({
      ...field,
      default:
        field.default === undefined
          ? undefined
          : deepCopyFieldValue(field.default),
      decisionRange: field.decisionRange ? { ...field.decisionRange } : undefined,
    })),
    textureFields: domain.textureFields.map((field) => ({
      ...field,
      default:
        field.default === undefined
          ? undefined
          : deepCopyFieldValue(field.default),
      decisionRange: field.decisionRange ? { ...field.decisionRange } : undefined,
    })),
    bondFields: domain.bondFields.map((bond) =>
      normalizeDomainBondDefinition(bond),
    ),
    compositeSchemas: domain.compositeSchemas
      ? Object.fromEntries(
          Object.entries(domain.compositeSchemas).map(([key, schema]) => [
            key,
            {
              ...schema,
              fields: schema.fields.map((field) => ({
                ...field,
                default:
                  field.default === undefined
                    ? undefined
                    : deepCopyFieldValue(field.default),
                decisionRange: field.decisionRange
                  ? { ...field.decisionRange }
                  : undefined,
              })),
            },
          ]),
        )
      : undefined,
    constraints: domain.constraints.map((constraint) => ({
      ...constraint,
      rules: constraint.rules ? [...constraint.rules] : undefined,
    })),
    knowledge: {
      ...domain.knowledge,
      references: domain.knowledge.references
        ? domain.knowledge.references.map((reference) => ({ ...reference }))
        : undefined,
    },
    migrations: domain.migrations
      ? Object.fromEntries(
          Object.entries(domain.migrations).map(([range, steps]) => [
            range,
            steps.map((step) => ({
              ...step,
              parameters: { ...step.parameters },
            })),
          ]),
        )
      : undefined,
  };
}

export function validateTransportableDomainManifest(domain: DomainManifest): {
  valid: boolean;
  issues: string[];
} {
  const issues = domain.constraints
    .filter((constraint) => !constraint.rules || constraint.rules.length === 0)
    .map(
      (constraint) =>
        `Constraint ${constraint.id} is not transportable because it has no declarative rules`,
    );
  return { valid: issues.length === 0, issues };
}

export function serializeTransportableDomainManifest(
  domain: DomainManifest,
): string {
  const validation = validateTransportableDomainManifest(domain);
  if (!validation.valid) {
    throw new Error(validation.issues.join("; "));
  }
  const normalized = normalizeManifest(domain);
  const transportable: TransportableDomainManifest = {
    ...normalized,
    constraints: normalized.constraints.map((constraint) => ({
      id: constraint.id,
      description: constraint.description,
      enforcement: constraint.enforcement,
      rules: [...(constraint.rules ?? [])],
    })),
  };
  return JSON.stringify(transportable, null, 2);
}

function fieldValueToComparable(
  value: unknown,
): PrimitiveFieldValue | undefined {
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return undefined;
}

function fieldValueToNumber(value: FieldValue | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

function compareComparableValues(
  left: PrimitiveFieldValue | undefined,
  op: DeclarativeRule["operator"] | FieldCondition["op"],
  right: PrimitiveFieldValue | PrimitiveFieldValue[],
): boolean {
  if (left === undefined) return false;

  switch (op) {
    case "<":
      return (
        typeof left === "number" && typeof right === "number" && left < right
      );
    case "<=":
      return (
        typeof left === "number" && typeof right === "number" && left <= right
      );
    case ">":
      return (
        typeof left === "number" && typeof right === "number" && left > right
      );
    case ">=":
      return (
        typeof left === "number" && typeof right === "number" && left >= right
      );
    case "==":
      return Array.isArray(right)
        ? right.some((value) => value === left)
        : left === right;
    case "!=":
      return Array.isArray(right)
        ? right.every((value) => value !== left)
        : left !== right;
    case "in":
      return Array.isArray(right) && right.some((value) => value === left);
    case "not_in":
      return Array.isArray(right) && right.every((value) => value !== left);
  }
}

function readPath(target: unknown, path: string): unknown {
  if (path.length === 0) return target;

  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let current: any = target;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[segment];
  }
  return current;
}

const KNOWN_RELATIONSHIP_TYPES = new Set<number>(
  Object.values(RelationshipType).filter(
    (value): value is number => typeof value === "number",
  ),
);

function isKnownRelationshipType(tag: number): tag is RelationshipType {
  return KNOWN_RELATIONSHIP_TYPES.has(tag);
}

function isNumericTypeTag(typeTag: FieldTypeTag): boolean {
  return (
    typeTag === FieldTypeTag.UINT8 ||
    typeTag === FieldTypeTag.UINT16 ||
    typeTag === FieldTypeTag.UINT32 ||
    typeTag === FieldTypeTag.UINT64 ||
    typeTag === FieldTypeTag.FLOAT32 ||
    typeTag === FieldTypeTag.FLOAT64
  );
}

function getFieldDecisionBounds(
  fieldDef: DomainFieldDefinition,
): [number, number] | undefined {
  if (fieldDef.range) return fieldDef.range;
  if (fieldDef.decisionRange) {
    return [fieldDef.decisionRange.min, fieldDef.decisionRange.max];
  }
  return undefined;
}

function cloneWithZeroedCRC(content: Uint8Array): Uint8Array {
  const normalized = new Uint8Array(content);
  if (normalized.length >= HEADER_CRC32_OFFSET + 4) {
    normalized.fill(0, HEADER_CRC32_OFFSET, HEADER_CRC32_OFFSET + 4);
  }
  return normalized;
}

function fieldDefinitionsById(
  domain: DomainManifest,
): Map<number, DomainFieldDefinition> {
  return new Map(
    [...domain.coreFields, ...domain.textureFields].map((field) => [field.id, field]),
  );
}

// #############################################################################
// #############################################################################
//
//   PART 5: การแกะ/ห่อ Seed (Parser & Serializer)
//   ────────────────────────────────────────────
//
//   ส่วนนี้คือ "นักแปล" ที่แปลง Seed ระหว่าง 2 รูปแบบ:
//   1. Binary (bytes) — สำหรับเก็บในไฟล์/ส่งเครือข่าย
//   2. TypeScript Object — สำหรับจัดการในโค้ด
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SeedParser — แกะ Seed จากไบนารีเป็น TypeScript Object
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * การทำงานเหมือนเปิดจดหมาย:
 * 1. ดูซอง (Header) — ตรวจ magic, version, domain ID
 * 2. อ่านจดหมาย (Core + Texture + Bond) — แปล bytes เป็นค่า
 * 3. ดูตราประทับ (Footer) — ตรวจ SHA-256 ว่าไม่ถูกแก้ไข
 *
 * ข้อควรระวัง:
 * - Endianness: ใช้ Big-Endian (network byte order) ตลอด
 * - BigInt: uint64 ต้องอ่านด้วย DataView.getBigUint64()
 * - Variable-length fields (bytes, string): อ่าน length prefix ก่อน
 */
export class SeedParser {
  /**
   * แกะ Seed จาก Uint8Array (ไบนารีดิบ)
   *
   * @param data - ไบนารีข้อมูลของ Seed
   * @returns Seed object ที่พร้อมใช้งาน
   * @throws Error ถ้าข้อมูลเสีย หรือไม่ตรงตามรูปแบบ
   */
  static parse(data: Uint8Array): Seed {
    if (data.length < HEADER_SIZE + FOOTER_SIZE) {
      throw new Error(
        `Seed data too short: ${data.length} bytes ` +
          `(minimum ${HEADER_SIZE + FOOTER_SIZE})`,
      );
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    const magic = view.getUint32(offset, false);
    offset += 4;
    if (magic !== SEED_MAGIC) {
      throw new Error(
        `Invalid magic: expected 0x${SEED_MAGIC.toString(16)}, ` +
          `got 0x${magic.toString(16)}`,
      );
    }

    const version = view.getUint16(offset, false);
    offset += 2;

    const domainIdBytes = data.slice(offset, offset + 16);
    const domainId = SeedParser.bytesToUUID(domainIdBytes);
    offset += 16;

    const generation = view.getUint32(offset, false);
    offset += 4;
    const entropyBudget = view.getUint8(offset);
    offset += 1;
    offset += 1; // reserved

    const coreSize = view.getUint32(offset, false);
    offset += 4;
    const textureSize = view.getUint32(offset, false);
    offset += 4;
    const bondSize = view.getUint32(offset, false);
    offset += 4;
    const flags = view.getUint32(offset, false);
    offset += 4;
    const crc32 = view.getUint32(offset, false);
    offset += 4;

    const contentPart = data.slice(0, data.length - FOOTER_SIZE);
    const footerHash = data.slice(data.length - FOOTER_SIZE);
    const afterHeader = data.slice(HEADER_SIZE, data.length - FOOTER_SIZE);
    const computedCRC =
      isSupportedSeedVersion(version) && !usesFullHeaderCRC(version)
        ? SeedParser.computeCRC32(afterHeader)
        : SeedParser.computeCRC32(cloneWithZeroedCRC(contentPart));
    if (computedCRC !== crc32) {
      throw new Error(
        `CRC32 mismatch: expected ${crc32}, computed ${computedCRC}. Seed data is corrupted!`,
      );
    }

    if (!isSupportedSeedVersion(version)) {
      throw new Error(`Unsupported seed version: ${version}`);
    }

    const computedHash = new Uint8Array(SeedParser.computeSHA256(contentPart));
    if (!SeedParser.equalBytes(footerHash, computedHash)) {
      throw new Error("Footer hash mismatch: seed content failed integrity checks");
    }

    const header: SeedHeader = {
      magic,
      version,
      domainId,
      generation,
      entropyBudget,
      coreSize,
      textureSize,
      bondSize,
      flags,
      crc32,
    };

    const coreStart = HEADER_SIZE;
    const coreEnd = coreStart + coreSize;
    const textureStart = coreEnd;
    const textureEnd = textureStart + textureSize;
    const bondStart = textureEnd;
    const bondEnd = bondStart + bondSize;

    const coreFields = SeedParser.parseFields(
      data.slice(coreStart, coreEnd),
      version,
    );
    const textureFields = SeedParser.parseFields(
      data.slice(textureStart, textureEnd),
      version,
    );
    const { bonds: bondFields, warnings: bondWarnings } = SeedParser.parseBondFields(
      data.slice(bondStart, bondEnd),
      version,
    );

    if (supportsMetadataTrailer(version) && bondEnd < data.length - FOOTER_SIZE) {
      const metadata = data.slice(bondEnd, data.length - FOOTER_SIZE);
      Object.assign(header, SeedParser.parseMetadataTrailer(metadata));
    }

    return normalizeSeed({
      header,
      coreFields,
      textureFields,
      bondFields,
      contentHash: SeedParser.uint8ArrayToHex(computedHash),
      parseWarnings: bondWarnings.length > 0 ? bondWarnings : undefined,
    });
  }

  /**
   * Parse fields แบบ Core/Texture (โครงสร้างเดียวกัน)
   *
   * โครงสร้าง: [Field ID (2B)] [Type Tag (1B)] [Value (variable)]
   *
   * วิธีอ่าน:
   * 1. อ่าน 2 bytes → field ID
   * 2. อ่าน 1 byte → type tag (บอกว่าค่าต่อไปเป็นอะไร)
   * 3. อ่านค่าตาม type tag:
   *    - uint8 → 1 byte
   *    - uint16 → 2 bytes
   *    - float32 → 4 bytes
   *    - string → 2 bytes (length) + N bytes (ตัวอักษร)
   *    - ...เป็นต้น
   * 4. ทำซ้ำจนกว่าจะหมดข้อมูล
   */
  private static parseFields(
    data: Uint8Array,
    version: number,
    fieldCount?: number,
  ): SeedField[] {
    const fields: SeedField[] = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    while (
      offset < data.length &&
      (fieldCount === undefined || fields.length < fieldCount)
    ) {
      const { field, bytesRead } = SeedParser.parseSingleField(
        data,
        view,
        offset,
        version,
      );
      offset += bytesRead;
      fields.push(field);
    }

    return fields;
  }

  /**
   * Parse Bond Fields (โครงสร้างต่างจาก Core/Texture)
   *
   * โครงสร้าง:
   *   [Field ID (2B)] [Source Field ID (2B)] [Target Field ID (2B)]
   *   [Relationship Type (1B)] [Parameters (variable)]
   *
   * ⚠️ ปัญหาที่พบ: parameters ไม่มี length prefix
   * ทำให้ parser ต้องรู้ขนาดจาก relationship type เท่านั้น
   * ถ้ามี type ใหม่ในอนาคต → parser เก่าจะข้ามไม่ได้
   *
   * 💡 ข้อเสนอแนะ: เพิ่ม parameterLength (2 bytes) ก่อน parameters
   */
  private static parseBondFields(
    data: Uint8Array,
    version: number,
  ): { bonds: BondField[]; warnings: string[] } {
    const bonds: BondField[] = [];
    const warnings: string[] = [];
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    while (offset < data.length) {
      if (usesLegacyBondEncoding(version)) {
        const id = view.getUint16(offset, false);
        offset += 2;
        const sourceFieldId = view.getUint16(offset, false);
        offset += 2;
        const targetFieldId = view.getUint16(offset, false);
        offset += 2;
        const relType = view.getUint8(offset) as RelationshipType;
        offset += 1;
        const parameters = SeedParser.readBondParameters(
          data,
          view,
          offset,
          relType,
          version,
        );
        offset += SeedParser.bondParameterSize(relType, version, parameters);

        bonds.push(
          normalizeBondField({
            id,
            sourceFieldId,
            targetFieldId,
            parameters,
          }),
        );
        continue;
      }

      if (uses16BitFieldIds(version)) {
        const id = view.getUint16(offset, false);
        offset += 2;
        const sourceFieldId = view.getUint16(offset, false);
        offset += 2;
        const targetFieldId = view.getUint16(offset, false);
        offset += 2;
        const relTypeRaw = view.getUint8(offset);
        offset += 1;
        const paramLen = view.getUint16(offset, false);
        offset += 2;
        const paramBytes = data.slice(offset, offset + paramLen);
        offset += paramLen;

        if (!isKnownRelationshipType(relTypeRaw)) {
          warnings.push(
            `Skipped unknown v1.1 bond type 0x${relTypeRaw.toString(16).padStart(2, "0")} for bond ${id}`,
          );
          continue;
        }

        const parameters = SeedParser.readBondParameters(
          paramBytes,
          new DataView(
            paramBytes.buffer,
            paramBytes.byteOffset,
            paramBytes.byteLength,
          ),
          0,
          relTypeRaw,
          version,
        );

        bonds.push(
          normalizeBondField({
            id,
            sourceFieldId,
            targetFieldId,
            parameters,
          }),
        );
        continue;
      }

      const id = SeedParser.readFieldId(view, offset, version);
      offset += getFieldIdByteWidth(version);
      const sourceCount = view.getUint8(offset);
      offset += 1;
      const sources: BondSourceRef[] = [];
      for (let i = 0; i < sourceCount; i++) {
        const fieldId = SeedParser.readFieldId(view, offset, version);
        offset += getFieldIdByteWidth(version);
        const weight = view.getFloat32(offset, false);
        offset += 4;
        sources.push({ fieldId, weight });
      }

      const targetFieldId = SeedParser.readFieldId(view, offset, version);
      offset += getFieldIdByteWidth(version);
      const blendMode = SeedParser.readBlendMode(view.getUint8(offset));
      offset += 1;
      const relTypeRaw = view.getUint8(offset);
      offset += 1;
      const paramLen = view.getUint16(offset, false);
      offset += 2;
      const paramBytes = data.slice(offset, offset + paramLen);
      offset += paramLen;

      if (!isKnownRelationshipType(relTypeRaw)) {
        warnings.push(
          `Skipped unknown v2 bond type 0x${relTypeRaw.toString(16).padStart(2, "0")} for bond ${id}`,
        );
        continue;
      }

      const parameters = SeedParser.readBondParameters(
        paramBytes,
        new DataView(
          paramBytes.buffer,
          paramBytes.byteOffset,
          paramBytes.byteLength,
        ),
        0,
        relTypeRaw,
        version,
      );

      bonds.push(
        normalizeBondField({
          id,
          sources,
          target: { fieldId: targetFieldId, blendMode },
          parameters,
        }),
      );
    }

    return { bonds, warnings };
  }

  private static parseSingleField(
    data: Uint8Array,
    view: DataView,
    offset: number,
    version: number,
  ): { field: SeedField; bytesRead: number } {
    const id = SeedParser.readFieldId(view, offset, version);
    offset += getFieldIdByteWidth(version);

    const typeTag = view.getUint8(offset) as FieldTypeTag;
    offset += 1;

    const { value, bytesRead } = SeedParser.readValue(
      data,
      view,
      offset,
      typeTag,
      version,
    );
    offset += bytesRead;

    return {
      field: { id, typeTag, value },
      bytesRead: getFieldIdByteWidth(version) + 1 + bytesRead,
    };
  }

  /**
   * อ่านค่า field ตาม type tag
   *
   * นี่คือ "หัวใจ" ของ parser — แปล bytes เป็นค่าที่ TypeScript เข้าใจ
   *
   * ⚠️ สิ่งที่ต้องระวัง:
   * - float32/float64 ใช้ DataView อ่าน เพราะมันจัดการ IEEE 754 ให้
   * - uint64 ต้องใช้ BigInt เพราะ JavaScript number ไม่ปลอดภัยเกิน 2^53
   * - string ต้องอ่าน length prefix ก่อน แล้วถึงอ่านตัวอักษร
   */
  private static readValue(
    data: Uint8Array,
    view: DataView,
    offset: number,
    typeTag: FieldTypeTag,
    version: number,
  ): { value: SeedField["value"]; bytesRead: number } {
    switch (typeTag) {
      case FieldTypeTag.UINT8:
        return { value: view.getUint8(offset), bytesRead: 1 };

      case FieldTypeTag.UINT16:
        return { value: view.getUint16(offset, false), bytesRead: 2 };

      case FieldTypeTag.UINT32:
        return { value: view.getUint32(offset, false), bytesRead: 4 };

      case FieldTypeTag.UINT64: {
        // ⚠️ ต้องใช้ BigInt! JavaScript number จะเสีย precision
        const value = view.getBigUint64(offset, false);
        return { value, bytesRead: 8 };
      }

      case FieldTypeTag.FLOAT32:
        return { value: view.getFloat32(offset, false), bytesRead: 4 };

      case FieldTypeTag.FLOAT64:
        return { value: view.getFloat64(offset, false), bytesRead: 8 };

      case FieldTypeTag.BOOL:
        return { value: view.getUint8(offset) === 0x01, bytesRead: 1 };

      case FieldTypeTag.BYTES: {
        // อ่าน length prefix (2 bytes) แล้วตามด้วยข้อมูล
        const len = view.getUint16(offset, false);
        const bytes = new Uint8Array(
          data.buffer,
          data.byteOffset + offset + 2,
          len,
        );
        return { value: new Uint8Array(bytes), bytesRead: 2 + len };
      }

      case FieldTypeTag.STRING: {
        // อ่าน length prefix (2 bytes) แล้วตามด้วย UTF-8 ตัวอักษร
        const len = view.getUint16(offset, false);
        const strBytes = new Uint8Array(
          data.buffer,
          data.byteOffset + offset + 2,
          len,
        );
        const value = new TextDecoder("utf-8").decode(strBytes);
        return { value, bytesRead: 2 + len };
      }

      case FieldTypeTag.ARRAY: {
        const elementTypeTag = view.getUint8(offset) as FieldTypeTag;
        const count = view.getUint16(offset + 1, false);
        let cursor = offset + 3;
        const items: FieldValue[] = [];
        for (let i = 0; i < count; i++) {
          const { value, bytesRead } = SeedParser.readValue(
            data,
            view,
            cursor,
            elementTypeTag,
            version,
          );
          items.push(value);
          cursor += bytesRead;
        }

        return {
          value: { kind: "array", elementTypeTag, items },
          bytesRead: cursor - offset,
        };
      }

      case FieldTypeTag.COMPOSITE: {
        const schemaId = view.getUint16(offset, false);
        const fieldCount = view.getUint16(offset + 2, false);
        const compositeData = data.slice(offset + 4);
        const fields = SeedParser.parseFields(
          compositeData,
          version,
          fieldCount,
        );
        const bytesRead =
          4 +
          fields.reduce(
            (sum, field) =>
              sum +
              getFieldIdByteWidth(version) +
              1 +
              SeedSerializer.measureValue(field, version),
            0,
          );

        return {
          value: { kind: "composite", schemaId, fields },
          bytesRead,
        };
      }

      default:
        throw new Error(
          `Unknown type tag: 0x${(typeTag as number).toString(16)}`,
        );
    }
  }

  /** อ่าน Bond parameters ตามประเภทความสัมพันธ์ */
  private static readBondParameters(
    data: Uint8Array,
    view: DataView,
    offset: number,
    relType: RelationshipType,
    version: number,
  ): BondParameters {
    if (usesLengthDelimitedBondEncoding(version) && isSeedVersionV2(version)) {
      const raw = new TextDecoder("utf-8").decode(data.slice(offset));
      const parsed =
        raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
      return { type: relType, ...parsed } as BondParameters;
    }

    switch (relType) {
      case RelationshipType.CORRELATE:
        return {
          type: RelationshipType.CORRELATE,
          rho: view.getFloat64(offset, false), // 8 bytes
        };

      case RelationshipType.CONSTRAIN:
        return {
          type: RelationshipType.CONSTRAIN,
          min: view.getFloat64(offset, false), // 8 bytes
          max: view.getFloat64(offset + 8, false), // 8 bytes
        };

      case RelationshipType.SEQUENCE:
        return {
          type: RelationshipType.SEQUENCE,
          offset: view.getUint16(offset, false), // 2 bytes
        };

      case RelationshipType.INHIBIT:
        return {
          type: RelationshipType.INHIBIT,
          strength: view.getFloat64(offset, false), // 8 bytes
        };

      case RelationshipType.AMPLIFY:
        return {
          type: RelationshipType.AMPLIFY,
          factor: view.getFloat64(offset, false), // 8 bytes
        };

      default:
        throw new Error(
          `Unknown relationship type: 0x${(relType as number).toString(16)}`,
        );
    }
  }

  /** ขนาด parameters เป็น bytes สำหรับแต่ละประเภท Bond */
  private static bondParameterSize(
    relType: RelationshipType,
    version: number,
    params?: BondParameters,
  ): number {
    if (isSeedVersionV2(version)) {
      return new TextEncoder().encode(JSON.stringify(params ?? {})).length;
    }

    switch (relType) {
      case RelationshipType.CORRELATE:
        return 8; // float64 rho
      case RelationshipType.CONSTRAIN:
        return 16; // float64 min + float64 max
      case RelationshipType.SEQUENCE:
        return 2; // uint16 offset
      case RelationshipType.INHIBIT:
        return 8; // float64 strength
      case RelationshipType.AMPLIFY:
        return 8; // float64 factor
      default:
        return 0;
    }
  }

  private static parseMetadataTrailer(
    data: Uint8Array,
  ): Partial<Pick<SeedHeader, "domainSchemaVersion">> {
    if (data.length === 0) return {};
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    const magic = view.getUint32(offset, false);
    offset += 4;
    if (magic !== SEED_METADATA_MAGIC) {
      return {};
    }

    const entryCount = view.getUint8(offset);
    offset += 1;
    const result: Partial<Pick<SeedHeader, "domainSchemaVersion">> = {};

    for (let i = 0; i < entryCount && offset < data.length; i++) {
      const entryTag = view.getUint8(offset);
      offset += 1;
      const len = view.getUint16(offset, false);
      offset += 2;
      const payload = data.slice(offset, offset + len);
      offset += len;

      if (entryTag === 0x01) {
        result.domainSchemaVersion = new TextDecoder("utf-8").decode(payload);
      }
    }

    return result;
  }

  private static readFieldId(
    view: DataView,
    offset: number,
    version: number,
  ): number {
    if (uses16BitFieldIds(version)) {
      return view.getUint16(offset, false);
    }

    return (
      (view.getUint8(offset) << 16) |
      (view.getUint8(offset + 1) << 8) |
      view.getUint8(offset + 2)
    );
  }

  private static readBlendMode(tag: number): BondBlendMode {
    switch (tag) {
      case BondBlendModeTag.ADDITIVE:
        return "additive";
      case BondBlendModeTag.MULTIPLICATIVE:
        return "multiplicative";
      case BondBlendModeTag.CONDITIONAL:
        return "conditional";
      default:
        return "additive";
    }
  }

  /** แปลง 16 bytes เป็น UUID string */
  private static bytesToUUID(bytes: Uint8Array): string {
    const hex = SeedParser.uint8ArrayToHex(bytes);
    // รูปแบบ: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /** แปลง Uint8Array เป็น hex string */
  private static uint8ArrayToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private static equalBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * คำนวณ CRC32
   *
   * CRC32 เป็น checksum ที่ตรวจจับข้อมูลเสียแบบไม่ตั้งใจได้เร็ว
   * โอกาสตรวจไม่พบ ≈ 1 ใน 4 พันล้าน (ซึ่งน้อยมาก)
   *
   * แต่ CRC32 ไม่ใช่ cryptographic integrity check และไม่ใช่ security boundary
   * ถ้าต้องการป้องกันการแก้ไขโดยเจตนา ต้องมี signed envelope หรือ HMAC ภายนอก
   *
   * ⚠️ นี่คือ stub — ใน production ต้องใช้ library จริง
   * เช่น npm package `crc` หรือ implement CRC32 table เอง
   */
  public static computeCRC32(data: Uint8Array): number {
    // Stub — ใน production ใช้ library จริง
    // เช่น: import crc32 from 'crc'; return crc32(data);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * คำนวณ SHA-256
   *
   * SHA-256 เป็น hash function ที่:
   * - ข้อมูลเดียวกัน → hash เดียวกันเสมอ (deterministic)
   * - เปลี่ยนแม้แค่ 1 bit → hash เปลี่ยนมาก (avalanche effect)
   * - หาข้อมูลที่ให้ hash เดียวกันได้ยากมาก (collision resistance)
   *
   * ⚠️ นี่คือ stub — ใน production ใช้ Web Crypto API หรือ Node.js crypto
   */
  public static computeSHA256(data: Uint8Array): ArrayBuffer {
    const K = new Uint32Array([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
      0x1f83d9ab, 0x5be0cd19,
    ]);
    const bitLength = data.length * 8;
    const paddedLength = (((data.length + 9 + 63) >> 6) << 6) >>> 0;
    const padded = new Uint8Array(paddedLength);
    padded.set(data);
    padded[data.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32), false);
    view.setUint32(paddedLength - 4, bitLength >>> 0, false);

    const W = new Uint32Array(64);
    for (let i = 0; i < paddedLength; i += 64) {
      for (let t = 0; t < 16; t++) {
        W[t] = view.getUint32(i + t * 4, false);
      }
      for (let t = 16; t < 64; t++) {
        const s0 =
          ((W[t - 15] >>> 7) | (W[t - 15] << 25)) ^
          ((W[t - 15] >>> 18) | (W[t - 15] << 14)) ^
          (W[t - 15] >>> 3);
        const s1 =
          ((W[t - 2] >>> 17) | (W[t - 2] << 15)) ^
          ((W[t - 2] >>> 19) | (W[t - 2] << 13)) ^
          (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }

      let [a, b, c, d, e, f, g, h] = Array.from(H);
      for (let t = 0; t < 64; t++) {
        const S1 =
          ((e >>> 6) | (e << 26)) ^
          ((e >>> 11) | (e << 21)) ^
          ((e >>> 25) | (e << 7));
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
        const S0 =
          ((a >>> 2) | (a << 30)) ^
          ((a >>> 13) | (a << 19)) ^
          ((a >>> 22) | (a << 10));
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const outView = new DataView(out.buffer);
    for (let i = 0; i < H.length; i++) {
      outView.setUint32(i * 4, H[i], false);
    }
    return out.buffer;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SeedSerializer — ห่อ Seed จาก TypeScript Object เป็นไบนารี
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * การทำงานเหมือนปิดซองจดหมาย:
 * 1. เขียน Header → คำนวณ sizes ของแต่ละ section
 * 2. เขียน Core fields → แปลค่าเป็น bytes
 * 3. เขียน Texture fields → แปลค่าเป็น bytes
 * 4. เขียน Bond fields → แปลค่าเป็น bytes
 * 5. คำนวณ CRC32 + SHA-256 → เขียน Footer
 */
export class SeedSerializer {
  /**
   * แปลง Seed object เป็น Uint8Array (ไบนารีดิบ)
   *
   * ขั้นตอน:
   * 1. Serialize แต่ละ section ของ fields เป็น bytes
   * 2. สร้าง Header ด้วย sizes ที่คำนวณได้
   * 3. คำนวณ CRC32 (ครอบหลัง Header)
   * 4. ต่อทุกอย่างเข้าด้วยกัน
   * 5. คำนวณ SHA-256 → เขียน Footer
   */
  static serialize(seed: Omit<Seed, "contentHash">): Uint8Array {
    const normalizedSeed = normalizeSeed(seed as Seed);
    const version = normalizedSeed.header.version ?? SEED_VERSION;
    // Serialize แต่ละ section
    const coreBytes = SeedSerializer.serializeFields(
      normalizedSeed.coreFields,
      version,
    );
    const textureBytes = SeedSerializer.serializeFields(
      normalizedSeed.textureFields,
      version,
    );
    const bondBytes = SeedSerializer.serializeBondFields(
      normalizedSeed.bondFields,
      version,
    );
    const metadataBytes = supportsMetadataTrailer(version)
      ? SeedSerializer.serializeMetadataTrailer(
          normalizedSeed.header,
        )
      : new Uint8Array(0);

    // คำนวณขนาด
    const coreSize = coreBytes.length;
    const textureSize = textureBytes.length;
    const bondSize = bondBytes.length;

    // สร้าง Header (ก่อนใส่ CRC32)
    const headerBytes = new Uint8Array(HEADER_SIZE);
    const headerView = new DataView(headerBytes.buffer);
    let off = 0;

    headerView.setUint32(off, normalizedSeed.header.magic, false);
    off += 4;
    headerView.setUint16(off, version, false);
    off += 2;
    // UUID string → 16 bytes
    const uuidBytes = SeedSerializer.uuidToBytes(
      normalizedSeed.header.domainId,
    );
    headerBytes.set(uuidBytes, off);
    off += 16;
    headerView.setUint32(off, normalizedSeed.header.generation, false);
    off += 4;
    headerView.setUint8(off, normalizedSeed.header.entropyBudget);
    off += 1;
    headerView.setUint8(off, 0);
    off += 1; // reserved
    headerView.setUint32(off, coreSize, false);
    off += 4;
    headerView.setUint32(off, textureSize, false);
    off += 4;
    headerView.setUint32(off, bondSize, false);
    off += 4;
    headerView.setUint32(off, normalizedSeed.header.flags, false);
    off += 4;

    // ต่อ core + texture + bond เพื่อคำนวณ CRC32
    const preFooterContent = SeedSerializer.concatUint8Arrays(
      headerBytes,
      coreBytes,
      textureBytes,
      bondBytes,
      metadataBytes,
    );
    const crc32 = usesFullHeaderCRC(version)
      ? SeedParser.computeCRC32(cloneWithZeroedCRC(preFooterContent))
      : SeedParser.computeCRC32(
          SeedSerializer.concatUint8Arrays(
            coreBytes,
            textureBytes,
            bondBytes,
            metadataBytes,
          ),
        );

    // เขียน CRC32 ลง Header
    headerView.setUint32(off, crc32, false);

    // ต่อทุกอย่าง (ยกเว้น footer)
    const contentBytes = SeedSerializer.concatUint8Arrays(
      headerBytes,
      coreBytes,
      textureBytes,
      bondBytes,
      metadataBytes,
    );

    // คำนวณ SHA-256 footer
    const hashBuffer = SeedParser.computeSHA256(contentBytes);
    const footerBytes = new Uint8Array(hashBuffer);

    // ต่อ footer
    return SeedSerializer.concatUint8Arrays(contentBytes, footerBytes);
  }

  /**
   * Serialize fields แบบ Core/Texture
   *
   * โครงสร้าง: [Field ID (2B)] [Type Tag (1B)] [Value (variable)]
   * ทุก field ต่อกันเรื่อยๆ ไม่มี padding
   */
  private static serializeFields(
    fields: SeedField[],
    version: number,
  ): Uint8Array {
    const chunks: Uint8Array[] = [];

    for (const field of fields) {
      const idBytes = SeedSerializer.writeFieldId(field.id, version);

      // Type Tag (1 byte)
      const tagBytes = new Uint8Array([field.typeTag]);

      // Value
      const valueBytes = SeedSerializer.writeValue(field, version);

      chunks.push(idBytes, tagBytes, valueBytes);
    }

    return SeedSerializer.concatUint8Arrays(...chunks);
  }

  /**
   * Serialize Bond fields
   *
   * โครงสร้าง:
   *   [Field ID (2B)] [Source (2B)] [Target (2B)] [Type (1B)] [Params]
   */
  private static serializeBondFields(
    bonds: BondField[],
    version: number,
  ): Uint8Array {
    const chunks: Uint8Array[] = [];

    for (const bond of bonds) {
      const normalizedBond = normalizeBondField(bond);
      if (usesLegacyBondEncoding(version)) {
        const headBytes = new Uint8Array(7);
        const headView = new DataView(headBytes.buffer);
        headView.setUint16(0, normalizedBond.id, false);
        headView.setUint16(2, normalizedBond.sourceFieldId ?? 0, false);
        headView.setUint16(4, normalizedBond.targetFieldId ?? 0, false);
        headView.setUint8(6, normalizedBond.parameters.type);

        const paramBytes = SeedSerializer.writeBondParameters(
          normalizedBond.parameters,
          version,
        );
        chunks.push(headBytes, paramBytes);
        continue;
      }

      if (uses16BitFieldIds(version)) {
        const sources = normalizedBond.sources ?? [];
        if (sources.length > 1) {
          throw new Error(
            `Seed v1.1 supports only single-source bonds; bond ${normalizedBond.id} has ${sources.length}`,
          );
        }
        const headBytes = new Uint8Array(9);
        const headView = new DataView(headBytes.buffer);
        headView.setUint16(0, normalizedBond.id, false);
        headView.setUint16(2, normalizedBond.sourceFieldId ?? sources[0]?.fieldId ?? 0, false);
        headView.setUint16(
          4,
          normalizedBond.targetFieldId ?? normalizedBond.target?.fieldId ?? 0,
          false,
        );
        headView.setUint8(6, normalizedBond.parameters.type);
        const paramBytes = SeedSerializer.writeBondParameters(
          normalizedBond.parameters,
          version,
        );
        headView.setUint16(7, paramBytes.length, false);
        chunks.push(headBytes, paramBytes);
        continue;
      }

      const bondIdBytes = SeedSerializer.writeFieldId(
        normalizedBond.id,
        version,
      );
      const sources = normalizedBond.sources ?? [];
      const sourceCount = new Uint8Array([sources.length]);
      const sourceBytes = sources.map((source) => {
        const fieldIdBytes = SeedSerializer.writeFieldId(
          source.fieldId,
          version,
        );
        const weightBytes = new Uint8Array(4);
        new DataView(weightBytes.buffer).setFloat32(0, source.weight, false);
        return SeedSerializer.concatUint8Arrays(fieldIdBytes, weightBytes);
      });

      const targetBytes = SeedSerializer.writeFieldId(
        normalizedBond.target?.fieldId ?? 0,
        version,
      );
      const blendMode = new Uint8Array([
        SeedSerializer.writeBlendMode(
          normalizedBond.target?.blendMode ?? "additive",
        ),
      ]);
      const relType = new Uint8Array([normalizedBond.parameters.type]);
      const paramBytes = SeedSerializer.writeBondParameters(
        normalizedBond.parameters,
        version,
      );
      const paramLen = new Uint8Array(2);
      new DataView(paramLen.buffer).setUint16(0, paramBytes.length, false);

      chunks.push(
        SeedSerializer.concatUint8Arrays(
          bondIdBytes,
          sourceCount,
          ...sourceBytes,
          targetBytes,
          blendMode,
          relType,
          paramLen,
          paramBytes,
        ),
      );
    }

    return SeedSerializer.concatUint8Arrays(...chunks);
  }

  /** เขียนค่า field เป็น bytes ตาม type tag */
  private static writeValue(field: SeedField, version: number): Uint8Array {
    switch (field.typeTag) {
      case FieldTypeTag.UINT8:
        return new Uint8Array([field.value as number]);

      case FieldTypeTag.UINT16: {
        const buf = new Uint8Array(2);
        new DataView(buf.buffer).setUint16(0, field.value as number, false);
        return buf;
      }
      case FieldTypeTag.UINT32: {
        const buf = new Uint8Array(4);
        new DataView(buf.buffer).setUint32(0, field.value as number, false);
        return buf;
      }
      case FieldTypeTag.UINT64: {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setBigUint64(0, field.value as bigint, false);
        return buf;
      }
      case FieldTypeTag.FLOAT32: {
        const buf = new Uint8Array(4);
        new DataView(buf.buffer).setFloat32(0, field.value as number, false);
        return buf;
      }
      case FieldTypeTag.FLOAT64: {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setFloat64(0, field.value as number, false);
        return buf;
      }
      case FieldTypeTag.BOOL:
        return new Uint8Array([field.value ? 0x01 : 0x00]);

      case FieldTypeTag.BYTES: {
        const data = field.value as Uint8Array;
        const lenBuf = new Uint8Array(2);
        new DataView(lenBuf.buffer).setUint16(0, data.length, false);
        return SeedSerializer.concatUint8Arrays(lenBuf, data);
      }
      case FieldTypeTag.STRING: {
        const encoded = new TextEncoder().encode(field.value as string);
        const lenBuf = new Uint8Array(2);
        new DataView(lenBuf.buffer).setUint16(0, encoded.length, false);
        return SeedSerializer.concatUint8Arrays(lenBuf, encoded);
      }
      case FieldTypeTag.ARRAY: {
        if (!isArrayFieldValue(field.value)) {
          throw new Error(`Field ${field.id} expected array value`);
        }
        const arrayValue = field.value;
        const header = new Uint8Array(3);
        const headerView = new DataView(header.buffer);
        headerView.setUint8(0, arrayValue.elementTypeTag);
        headerView.setUint16(1, arrayValue.items.length, false);
        const items = arrayValue.items.map((item) =>
          SeedSerializer.writeAnonymousValue(
            item,
            arrayValue.elementTypeTag,
            version,
          ),
        );
        return SeedSerializer.concatUint8Arrays(header, ...items);
      }
      case FieldTypeTag.COMPOSITE: {
        if (!isCompositeFieldValue(field.value)) {
          throw new Error(`Field ${field.id} expected composite value`);
        }
        const header = new Uint8Array(4);
        const headerView = new DataView(header.buffer);
        headerView.setUint16(0, field.value.schemaId, false);
        headerView.setUint16(2, field.value.fields.length, false);
        const body = SeedSerializer.serializeFields(
          field.value.fields,
          version,
        );
        return SeedSerializer.concatUint8Arrays(header, body);
      }
      default:
        throw new Error(
          `Unknown type tag: 0x${(field.typeTag as number).toString(16)}`,
        );
    }
  }

  /** เขียน Bond parameters เป็น bytes */
  private static writeBondParameters(
    params: BondParameters,
    version: number,
  ): Uint8Array {
    if (isSeedVersionV2(version)) {
      const { type: _type, ...rest } = params as BondParameters & {
        type: RelationshipType;
      };
      return new TextEncoder().encode(JSON.stringify(rest));
    }

    switch (params.type) {
      case RelationshipType.CORRELATE: {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setFloat64(0, params.rho, false);
        return buf;
      }
      case RelationshipType.CONSTRAIN: {
        const buf = new Uint8Array(16);
        new DataView(buf.buffer).setFloat64(0, params.min, false);
        new DataView(buf.buffer).setFloat64(8, params.max, false);
        return buf;
      }
      case RelationshipType.SEQUENCE: {
        const buf = new Uint8Array(2);
        new DataView(buf.buffer).setUint16(0, params.offset, false);
        return buf;
      }
      case RelationshipType.INHIBIT: {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setFloat64(0, params.strength, false);
        return buf;
      }
      case RelationshipType.AMPLIFY: {
        const buf = new Uint8Array(8);
        new DataView(buf.buffer).setFloat64(0, params.factor, false);
        return buf;
      }
      default:
        throw new Error(
          `Relationship type ${params.type} requires v2 serialization`,
        );
    }
  }

  static measureValue(field: SeedField, version: number): number {
    return SeedSerializer.writeValue(field, version).length;
  }

  private static writeAnonymousValue(
    value: FieldValue,
    typeTag: FieldTypeTag,
    version: number,
  ): Uint8Array {
    return SeedSerializer.writeValue({ id: 0, typeTag, value }, version);
  }

  private static serializeMetadataTrailer(header: SeedHeader): Uint8Array {
    if (!header.domainSchemaVersion) return new Uint8Array(0);

    const versionBytes = new TextEncoder().encode(header.domainSchemaVersion);
    const entryBytes = new Uint8Array(1 + 2);
    const entryView = new DataView(entryBytes.buffer);
    entryView.setUint8(0, 0x01);
    entryView.setUint16(1, versionBytes.length, false);

    const magic = new Uint8Array(4);
    new DataView(magic.buffer).setUint32(0, SEED_METADATA_MAGIC, false);

    return SeedSerializer.concatUint8Arrays(
      magic,
      new Uint8Array([1]),
      entryBytes,
      versionBytes,
    );
  }

  /** แปลง UUID string เป็น 16 bytes */
  private static uuidToBytes(uuid: string): Uint8Array {
    const hex = uuid.replace(/-/g, "");
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  private static writeFieldId(id: number, version: number): Uint8Array {
    if (uses16BitFieldIds(version)) {
      const bytes = new Uint8Array(2);
      new DataView(bytes.buffer).setUint16(0, id, false);
      return bytes;
    }

    return new Uint8Array([(id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff]);
  }

  private static writeBlendMode(mode: BondBlendMode): number {
    switch (mode) {
      case "additive":
        return BondBlendModeTag.ADDITIVE;
      case "multiplicative":
        return BondBlendModeTag.MULTIPLICATIVE;
      case "conditional":
        return BondBlendModeTag.CONDITIONAL;
    }
  }

  /** ต่อ Uint8Arrays หลายอันเข้าด้วยกัน */
  private static concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SeedWrapper — ห่อ Seed ไบนารีเป็นสตริงที่คนส่งกันได้
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ขั้นตอน:
 * 1. Serialize seed เป็น bytes
 * 2. ถ้าใหญ่เกิน 256 bytes → บีบด้วย DEFLATE
 * 3. เติม wrap header (4 bytes: magic + flags)
 * 4. เข้ารหัสเป็น Base58
 * 5. เติม prefix "SDWR-"
 *
 * ทำไมใช้ Base58 ไม่ใช่ Base64?
 * - Base58 ไม่มีตัวสับสน: 0/O, l/I
 * - ดูเหมือน cryptocurrency address → เข้ากับ concept "seed มีค่า"
 *
 * ผลลัพธ์จะออกมาประมาณนี้:
 *   SDWR-7f2a8c9B1e4d6Qm3pR5tU8vW0xY2zA4b6C8dE0fG3hJ5k...
 */
export class SeedWrapper {
  /** Base58 alphabet (Bitcoin style) — ไม่มี 0, O, l, I เพื่อไม่ให้สับสน */
  private static readonly BASE58_ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  /**
   * ห่อ Seed เป็นสตริงภายนอก
   */
  static wrap(seed: Seed): string {
    const rawBytes = SeedSerializer.serialize(seed);

    // บีบด้วย DEFLATE ถ้าใหญ่เกิน 256 bytes
    let compressed: Uint8Array;
    let flags = 0x00;

    if (rawBytes.length > 256) {
      const deflated = new Uint8Array(deflateSync(rawBytes));
      if (deflated.length < rawBytes.length) {
        compressed = deflated;
        flags = 0x01; // bit 0 = compressed
      } else {
        compressed = rawBytes;
      }
    } else {
      compressed = rawBytes;
    }

    // เติม wrap header
    const wrapHeader = new Uint8Array(4);
    const wrapView = new DataView(wrapHeader.buffer);
    wrapView.setUint32(0, WRAP_MAGIC, false);
    wrapView.setUint8(0, (WRAP_MAGIC >>> 24) & 0xff);
    wrapView.setUint8(1, flags);
    // bytes 2-3 reserved

    const wrapped = SeedWrapper.concatArrays(wrapHeader, compressed);

    // เข้ารหัส Base58
    const base58 = SeedWrapper.encodeBase58(wrapped);

    return `SDWR-${base58}`;
  }

  /**
   * แกะ Seed จากสตริงภายนอก
   */
  static unwrap(wrapped: string): Seed {
    if (!wrapped.startsWith("SDWR-")) {
      throw new Error("Invalid seed: missing SDWR- prefix");
    }

    const base58 = wrapped.slice(5);
    const bytes = SeedWrapper.decodeBase58(base58);

    // อ่าน wrap header
    const flags = bytes[1];
    const isCompressed = (flags & 0x01) !== 0;

    const payload = bytes.slice(4);

    let rawBytes: Uint8Array;
    if (isCompressed) {
      try {
        rawBytes = new Uint8Array(inflateSync(payload));
      } catch (error) {
        throw new Error(
          `Wrapped seed inflate failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    } else {
      rawBytes = payload;
    }

    return SeedParser.parse(rawBytes);
  }

  /** เข้ารหัส Uint8Array เป็น Base58 string */
  private static encodeBase58(data: Uint8Array): string {
    // แปลงเป็น BigInteger-like (ใช้ array of digits base 256 → base 58)
    const digits: number[] = [0];

    for (const byte of data) {
      let carry = byte;
      for (let i = 0; i < digits.length; i++) {
        carry += digits[i] << 8;
        digits[i] = carry % 58;
        carry = Math.floor(carry / 58);
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = Math.floor(carry / 58);
      }
    }

    // เติม '1' สำหรับ leading zeros
    let result = "";
    for (const byte of data) {
      if (byte === 0) result += "1";
      else break;
    }

    // แปลง digits เป็นตัวอักษร
    for (let i = digits.length - 1; i >= 0; i--) {
      result += SeedWrapper.BASE58_ALPHABET[digits[i]];
    }

    return result;
  }

  /** ถอดรหัส Base58 string เป็น Uint8Array */
  private static decodeBase58(str: string): Uint8Array {
    const bytes: number[] = [0];

    for (const ch of str) {
      const idx = SeedWrapper.BASE58_ALPHABET.indexOf(ch);
      if (idx === -1) {
        throw new Error(`Invalid Base58 character: ${ch}`);
      }

      let carry = idx;
      for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>>= 8;
      }
    }

    // เติม leading zeros
    let result: number[] = [];
    for (const ch of str) {
      if (ch === "1") result.push(0);
      else break;
    }

    for (let i = bytes.length - 1; i >= 0; i--) {
      result.push(bytes[i]);
    }

    return new Uint8Array(result);
  }

  /** ต่อ Uint8Arrays */
  private static concatArrays(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}

// #############################################################################
// #############################################################################
//
//   PART 6: ระบบ Mutation (การเปลี่ยนแปลง Seed)
//   ────────────────────────────────────────────
//
//   Mutation คือกระบวนการ "สร้างลูกจากพ่อแม่"
//   เหมือนพ่อแม่ถ่ายทอดลักษณะให้ลูก แต่ลูกอาจเหมือนหรือต่างจากพ่อแม่
//
//   มี 5 ประเภทหลัก:
//   1. Core Shift     — เปลี่ยนแกน (เสี่ยงสูง ผลกระทบสูง)
//   2. Texture Growth  — เพิ่มรายละเอียดใหม่ (ปลอดภัย ผลกระทบกลาง)
//   3. Texture Edit    — ปรับรายละเอียดเดิม (ปลอดภัย ผลกระทบต่ำ)
//   4. Bond Forge      — เพิ่ม/แก้ไขสัญญาณเชื่อม (กลาง)
//   5. Crossover       — ผสมพ่อแม่ 2 ตัว (เสี่ยงสูง ผลกระทบสูง)
//
// #############################################################################
// #############################################################################

export class SeedMutator {
  /**
   * ═══════════════════════════════════════════════════════════════════════
   * CORE SHIFT — เปลี่ยนแกนของ Seed
   * ═══════════════════════════════════════════════════════════════════════
   *
   * เปรียบเหมือน "เปลี่ยนจังหวะเพลง" — เปลี่ยนแค่ค่าเดียวแต่ผลกระทบทั้งเพลง
   *
   * วิธีทำ:
   * - วนทุก core field
   * - สุ่มว่าจะเปลี่ยนหรือไม่ (ตาม coreMutationRate)
   * - ถ้าเปลี่ยน → ปรับค่าเล็กน้อย (ตาม coreMutationMagnitude)
   * - มีโอกาสนิดหน่อยที่จะเพิ่ม core field ใหม่ (optional)
   *
   * ⚠️ ข้อเสนอแนะจากการวิเคราะห์:
   * เดิมใช้ multiplicative mutation: value * (1 + δ)
   * แต่มีปัญหากับ:
   *   - ค่าติดลบ (เช่น register_bias: [-1, 1]) → mutation ผิดทิศ
   *   - ค่าใกล้ศูนย์ → mutation ไม่มีผล
   * เปลี่ยนเป็น additive mutation: value + δ
   * ซึ่งทำงานได้ดีกับทุกช่วงค่า
   */
  static coreShift(
    parent: Seed,
    radius: RadiusSetting,
    domain: DomainManifest,
  ): Seed {
    // Deep copy — ลูกต้องไม่แก้พ่อแม่!
    const child = SeedMutator.deepCopySeed(parent);
    child.header.generation += 1;

    for (const field of child.coreFields) {
      // สุ่มว่าจะเปลี่ยน field นี้หรือไม่
      if (Math.random() < radius.coreMutationRate) {
        // หานิยามของ field นี้จาก domain manifest
        const fieldDef = domain.coreFields.find((d) => d.id === field.id);

        const mutationBounds = fieldDef
          ? getFieldDecisionBounds(fieldDef)
          : undefined;
        if (mutationBounds && typeof field.value === "number") {
          // ✅ ใช้ ADDITIVE mutation (แก้จาก multiplicative ใน spec เดิม)
          // เหตุผล: ทำงานได้ดีกับทุกช่วงค่า รวมถึงติดลบและใกล้ศูนย์
          const range = mutationBounds[1] - mutationBounds[0];
          const delta =
            range * radius.coreMutationMagnitude * SeedMutator.randomGaussian();
          field.value = SeedMutator.clamp(
            field.value + delta,
            mutationBounds[0],
            mutationBounds[1],
          );
        }
      }
    }

    // โอกาสนิดหน่วยที่จะเพิ่ม optional core field
    const optionalFields = domain.coreFields.filter(
      (d) => !d.required && !child.coreFields.some((f) => f.id === d.id),
    );
    if (
      optionalFields.length > 0 &&
      Math.random() < radius.coreMutationRate * 0.1
    ) {
      const newDef =
        optionalFields[Math.floor(Math.random() * optionalFields.length)];
      const newField: SeedField = {
        id: newDef.id,
        typeTag: newDef.typeTag,
        value: SeedMutator.randomInRange(newDef),
      };
      child.coreFields.push(newField);
    }

    // คำนวณ hash ใหม่
    return SeedMutator.rehash(child);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * TEXTURE GROWTH — เพิ่มรายละเอียดใหม่ให้ Seed
   * ═══════════════════════════════════════════════════════════════════════
   *
   * เปรียบเหมือน "เพิ่มเครื่องเทศในสูตรอาหาร" — อาหารยังอร่อยอยู่
   * แต่เพิ่มระดับความประณีต
   *
   * วิธีทำ:
   * - ดูว่า Domain มี texture fields อะไรให้เพิ่มบ้าง
   * - สุ่มเลือกตาม growthWeight (บาง field สำคัญกว่า → มีโอกาสถูกเลือกมากกว่า)
   * - กำหนดค่าเริ่มต้น (จาก default ของ Domain + noise เล็กน้อย)
   * - เพิ่มเข้าไปใน seed
   *
   * ทำไม texture growth สำคัญ?
   * → เพราะ seed ที่มี texture เยอะ = "ประณีต" = "ฝีมือช่าง"
   * → แต่ละ texture field ที่เพิ่ม = การ override default ของ Domain
   *    ด้วยค่าที่คนเลือก → มี "แรงงานมนุษย์" ฝังอยู่
   */
  static textureGrowth(
    parent: Seed,
    radius: RadiusSetting,
    domain: DomainManifest,
  ): Seed {
    const child = SeedMutator.deepCopySeed(parent);
    child.header.generation += 1;

    // หา texture fields ที่ยังไม่มีใน seed
    const existingIds = new Set(child.textureFields.map((f) => f.id));
    const available = domain.textureFields.filter(
      (d) => !existingIds.has(d.id),
    );

    if (available.length === 0) return SeedMutator.rehash(child);

    // เลือกตาม growthWeight
    const nToAdd = Math.min(radius.textureGrowthCount, available.length);
    const selected = SeedMutator.weightedRandomSample(available, nToAdd);

    for (const fieldDef of selected) {
      const newField: SeedField = {
        id: fieldDef.id,
        typeTag: fieldDef.typeTag,
        // ค่าเริ่มต้น = default ของ Domain + noise เล็กน้อย
        value: SeedMutator.randomInRange(fieldDef),
      };
      child.textureFields.push(newField);
    }

    return SeedMutator.rehash(child);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * TEXTURE EDIT — ปรับรายละเอียดเดิมใน Seed
   * ═══════════════════════════════════════════════════════════════════════
   *
   * เปรียบเหมือน "ปรับเครื่องเทศนิดหน่อย" — เพิ่มเกลือนิด ลดน้ำตาลหน่อย
   * อาหารยังเหมือนเดิมแต่ดีขึ้น
   *
   * วิธีทำ:
   * - วนทุก texture field ที่มีอยู่
   * - สุ่มว่าจะปรับหรือไม่ (ตาม textureEditRate)
   * - ถ้าปรับ → เปลี่ยนค่าเล็กน้อย (ตาม textureEditMagnitude)
   *
   * ใช้ additive mutation (เหมือน core shift ที่แก้แล้ว)
   */
  static textureEdit(
    parent: Seed,
    radius: RadiusSetting,
    domain: DomainManifest,
  ): Seed {
    const child = SeedMutator.deepCopySeed(parent);
    child.header.generation += 1;

    for (const field of child.textureFields) {
      if (Math.random() < radius.textureEditRate) {
        const fieldDef = domain.textureFields.find((d) => d.id === field.id);

        const mutationBounds = fieldDef
          ? getFieldDecisionBounds(fieldDef)
          : undefined;
        if (mutationBounds && typeof field.value === "number") {
          // ✅ Additive mutation
          const range = mutationBounds[1] - mutationBounds[0];
          const delta =
            range * radius.textureEditMagnitude * SeedMutator.randomGaussian();
          field.value = SeedMutator.clamp(
            field.value + delta,
            mutationBounds[0],
            mutationBounds[1],
          );
        }
      }
    }

    return SeedMutator.rehash(child);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * BOND FORGE — เพิ่ม/แก้ไขสัญญาณเชื่อมระหว่าง fields
   * ═══════════════════════════════════════════════════════════════════════
   *
   * เปรียบเหมือน "เพิ่มกฎในวงดนตรี" — เทมโปเร็ว = โน้ตสั้น
   * ถ้าไม่มี bond → fields ทำงานอิสระ → อาจขัดแย้ง
   *
   * วิธีทำ:
   * - ดู bond definitions ที่ Domain รองรับ
   * - เลือกเพิ่ม bonds ใหม่ (ถ้า source/target fields มีอยู่ใน seed)
   * - ปรับ bonds เดิมนิดหน่อย
   */
  static bondForge(
    parent: Seed,
    radius: RadiusSetting,
    domain: DomainManifest,
  ): Seed {
    const child = SeedMutator.deepCopySeed(parent);
    child.header.generation += 1;

    // หา bond definitions ที่ยังไม่มีใน seed
    const existingBondIds = new Set(child.bondFields.map((b) => b.id));
    const available = domain.bondFields.filter(
      (d) => !existingBondIds.has(d.id),
    );

    // เพิ่ม bonds ใหม่
    const allFieldIds = new Set([
      ...child.coreFields.map((f) => f.id),
      ...child.textureFields.map((f) => f.id),
    ]);

    const nToAdd = Math.min(radius.bondGrowthCount, available.length);
    const selected = available.slice(0, nToAdd); // simplified selection

    for (const bondDef of selected) {
      const normalizedBondDef = normalizeDomainBondDefinition(bondDef);
      // เพิ่มได้ถ้า source + target มีอยู่ใน seed
      const sources = normalizedBondDef.sources ?? [];
      const targetFieldId = normalizedBondDef.targetRef?.fieldId;
      const canAdd =
        targetFieldId !== undefined &&
        sources.every((source) => allFieldIds.has(source.fieldId)) &&
        allFieldIds.has(targetFieldId);

      if (canAdd) {
        child.bondFields.push({
          id: normalizedBondDef.id,
          sourceFieldId: normalizedBondDef.sourceField,
          targetFieldId: normalizedBondDef.target,
          sources: sources.map((source) => ({ ...source })),
          target: normalizedBondDef.targetRef
            ? { ...normalizedBondDef.targetRef }
            : undefined,
          parameters: { ...normalizedBondDef.defaultParameters }, // copy default params
        });
      }
    }

    // ปรับ bonds เดิม
    for (const bond of child.bondFields) {
      if (Math.random() < radius.bondEditRate) {
        bond.parameters = SeedMutator.perturbBondParams(bond.parameters);
      }
    }

    return SeedMutator.rehash(child);
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * CROSSOVER — ผสมพ่อแม่ 2 ตัว
   * ═══════════════════════════════════════════════════════════════════════
   *
   * เปรียบเหมือน "ลูกที่รับลักษณะจากพ่อบ้าง แม่บ้าง"
   *
   * มี 3 กลยุทธ์:
   * - CORE_FROM_A: เอา core จากพ่อ A, texture/bond ผสม
   * - CORE_BLEND: ผสม core ด้วย (เสี่ยงที่สุด)
   * - FIELD_SWAP: เอาของพ่อ A แล้วสลับบาง texture มาจากพ่อ B
   *
   * ⚠️ ข้อเสนอแนะจากการวิเคราะห์:
   * เดิมใช้ zip() จับคู่ตามตำแหน่ง → ผิด!
   * เพราะ fields อาจไม่ได้อยู่ตำแหน่งเดียวกัน
   * ต้องจับคู่ด้วย Field ID แทน
   */
  static crossover(
    parentA: Seed,
    parentB: Seed,
    strategy: "CORE_FROM_A" | "CORE_BLEND" | "FIELD_SWAP",
    domain: DomainManifest,
  ): Seed {
    // ต้องเป็น Domain เดียวกัน!
    if (parentA.header.domainId !== parentB.header.domainId) {
      throw new Error("Cannot crossover seeds from different domains");
    }

    const child = SeedMutator.emptySeed();
    child.header.domainId = parentA.header.domainId;
    child.header.version = parentA.header.version;
    child.header.domainSchemaVersion =
      parentA.header.domainSchemaVersion ?? domain.version;
    child.header.generation =
      Math.max(parentA.header.generation, parentB.header.generation) + 1;
    child.header.entropyBudget =
      Math.random() < 0.5
        ? parentA.header.entropyBudget
        : parentB.header.entropyBudget;

    switch (strategy) {
      case "CORE_FROM_A":
        child.coreFields = SeedMutator.deepCopyFields(parentA.coreFields);
        child.textureFields = SeedMutator.mergeTextures(parentA, parentB);
        child.bondFields = SeedMutator.mergeBonds(parentA, parentB);
        break;

      case "CORE_BLEND":
        child.coreFields = SeedMutator.blendCores(parentA, parentB, domain);
        child.textureFields = SeedMutator.mergeTextures(parentA, parentB);
        child.bondFields = SeedMutator.mergeBonds(parentA, parentB);
        break;

      case "FIELD_SWAP":
        child.coreFields = SeedMutator.deepCopyFields(parentA.coreFields);
        child.textureFields = SeedMutator.deepCopyFields(parentA.textureFields);
        // สลับบาง texture fields กับ parent B
        const swapCount = Math.max(
          1,
          Math.floor(child.textureFields.length / 3),
        );
        for (let i = 0; i < swapCount; i++) {
          const idx = Math.floor(Math.random() * child.textureFields.length);
          const matching = parentB.textureFields.find(
            (f) => f.id === child.textureFields[idx].id,
          );
          if (matching) {
            child.textureFields[idx] = SeedMutator.deepCopyFields([
              matching,
            ])[0];
          }
        }
        child.bondFields = SeedMutator.mergeBonds(parentA, parentB);
        break;
    }

    return SeedMutator.rehash(child);
  }

  /**
   * ✅ แก้แล้ว: Blend cores โดยจับคู่ด้วย Field ID ไม่ใช่ตำแหน่ง
   *
   * เดิมใช้ zip() → จับคู่ผิดถ้า fields ไม่อยู่ตำแหน่งเดียวกัน
   * แก้โดยวนตาม domain.coreFields แล้วหาในแต่ละ parent
   */
  private static blendCores(
    parentA: Seed,
    parentB: Seed,
    domain: DomainManifest,
  ): SeedField[] {
    const blended: SeedField[] = [];

    for (const fieldDef of domain.coreFields) {
      const fa = parentA.coreFields.find((f) => f.id === fieldDef.id);
      const fb = parentB.coreFields.find((f) => f.id === fieldDef.id);

      if (
        fa &&
        fb &&
        typeof fa.value === "number" &&
        typeof fb.value === "number"
      ) {
        // ทั้งคู่มี → ผสม (lerp)
        const t = 0.2 + Math.random() * 0.6; // หลีกเลี่ยงค่า 0 และ 1
        blended.push({
          id: fa.id,
          typeTag: fa.typeTag,
          value: fa.value * (1 - t) + fb.value * t,
        });
      } else if (fa) {
        blended.push(SeedMutator.deepCopyFields([fa])[0]);
      } else if (fb) {
        blended.push(SeedMutator.deepCopyFields([fb])[0]);
      }
      // ถ้าทั้งคู่ไม่มี → ไม่ใส่ (optional field)
    }

    return blended;
  }

  /** ผสม texture fields จากพ่อแม่ทั้งสอง */
  private static mergeTextures(parentA: Seed, parentB: Seed): SeedField[] {
    const merged: SeedField[] = [];
    const allIds = new Set([
      ...parentA.textureFields.map((f) => f.id),
      ...parentB.textureFields.map((f) => f.id),
    ]);

    for (const id of allIds) {
      const fa = parentA.textureFields.find((f) => f.id === id);
      const fb = parentB.textureFields.find((f) => f.id === id);

      if (
        fa &&
        fb &&
        typeof fa.value === "number" &&
        typeof fb.value === "number"
      ) {
        const t = 0.3 + Math.random() * 0.4;
        merged.push({
          id: fa.id,
          typeTag: fa.typeTag,
          value: fa.value * (1 - t) + fb.value * t,
        });
      } else if (fa) {
        merged.push(SeedMutator.deepCopyFields([fa])[0]);
      } else if (fb) {
        merged.push(SeedMutator.deepCopyFields([fb])[0]);
      }
    }

    return merged;
  }

  /** ผสม bond fields (สุ่มเลือกจากพ่อหรือแม่) */
  private static mergeBonds(parentA: Seed, parentB: Seed): BondField[] {
    const bonds: BondField[] = [];

    // เอา bonds ที่ไม่ซ้ำ ID
    const seenIds = new Set<number>();

    for (const bond of parentA.bondFields) {
      const normalizedBond = normalizeBondField(bond);
      bonds.push({
        ...normalizedBond,
        sources: normalizedBond.sources?.map((source) => ({ ...source })),
        target: normalizedBond.target
          ? { ...normalizedBond.target }
          : undefined,
        parameters: { ...normalizedBond.parameters } as BondParameters,
      });
      seenIds.add(bond.id);
    }
    for (const bond of parentB.bondFields) {
      if (!seenIds.has(bond.id)) {
        const normalizedBond = normalizeBondField(bond);
        bonds.push({
          ...normalizedBond,
          sources: normalizedBond.sources?.map((source) => ({ ...source })),
          target: normalizedBond.target
            ? { ...normalizedBond.target }
            : undefined,
          parameters: { ...normalizedBond.parameters } as BondParameters,
        });
      }
    }

    return bonds;
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * COMPOUND MUTATION — สร้าง batch ของลูกหลายตัว
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ในการ tuning จริง เราไม่ได้ใช้ mutation แค่ประเภทเดียว
   * แต่สร้าง batch ที่มีทั้งเด็กเก่ง (texture edit), เด็กนักสำรวจ (core shift),
   * และเด็กที่ผสม (crossover)
   *
   * สัดส่วนที่แนะนำ:
   * - 40% texture edit + texture growth (ปรับเกลา + เพิ่มรายละเอียด)
   * - 20% core shift + texture edit (เปลี่ยนทิศ + ปรับเกลา)
   * - 15% bond forge + texture edit (เพิ่มความสอดคล้อง + ปรับเกลา)
   * - 15% texture growth only (เพิ่มรายละเอียดอย่างเดียว)
   * - 10% core shift only (เปลี่ยนทิศทางอย่างเดียว)
   *
   * ทำไม texture operations ถึงเยอะที่สุด?
   * → เพราะปลอดภัยที่สุด + ให้ผลดีที่สุดในส่วนใหญ่
   * → core shift เสี่ยง (อาจได้ขยะ) เลยใส่น้อย
   */
  static generateTuningBatch(
    parent: Seed,
    radius: RadiusSetting,
    batchSize: number,
    domain: DomainManifest,
  ): Seed[] {
    const children: Seed[] = [];

    // สัดส่วน mutation strategies
    const strategies = [
      { weight: 0.4, ops: ["textureEdit", "textureGrowth"] as const },
      { weight: 0.2, ops: ["coreShift", "textureEdit"] as const },
      { weight: 0.15, ops: ["bondForge", "textureEdit"] as const },
      { weight: 0.15, ops: ["textureGrowth"] as const },
      { weight: 0.1, ops: ["coreShift"] as const },
    ];

    for (let i = 0; i < batchSize; i++) {
      // เลือก strategy ตามน้ำหนัก
      const r = Math.random();
      let cumulative = 0;
      let selected = strategies[0];

      for (const s of strategies) {
        cumulative += s.weight;
        if (r <= cumulative) {
          selected = s;
          break;
        }
      }

      // Apply operations ตามลำดับ
      let child = SeedMutator.deepCopySeed(parent);

      for (const op of selected.ops) {
        switch (op) {
          case "coreShift":
            child = SeedMutator.coreShift(child, radius, domain);
            break;
          case "textureGrowth":
            child = SeedMutator.textureGrowth(child, radius, domain);
            break;
          case "textureEdit":
            child = SeedMutator.textureEdit(child, radius, domain);
            break;
          case "bondForge":
            child = SeedMutator.bondForge(child, radius, domain);
            break;
        }
      }

      children.push(child);
    }

    return children;
  }

  // ─── Helper Functions ──────────────────────────────────────────────

  /** สุ่มค่าแบบ Gaussian (Normal Distribution) */
  private static randomGaussian(): number {
    // Box-Muller transform: แปลง uniform → gaussian
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /** จำกัดค่าให้อยู่ในช่วง [min, max] */
  private static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /** สุ่มค่าในช่วงที่กำหนด */
  private static randomInRange(fieldDef: DomainFieldDefinition): FieldValue {
    if (fieldDef.default !== undefined) {
      return deepCopyFieldValue(fieldDef.default);
    }
    if (fieldDef.typeTag === FieldTypeTag.BOOL) {
      return false;
    }
    if (fieldDef.typeTag === FieldTypeTag.STRING) {
      return "";
    }
    if (fieldDef.typeTag === FieldTypeTag.BYTES) {
      return new Uint8Array();
    }
    if (fieldDef.typeTag === FieldTypeTag.ARRAY) {
      return {
        kind: "array",
        elementTypeTag: fieldDef.elementTypeTag ?? FieldTypeTag.FLOAT32,
        items: [],
      };
    }
    if (fieldDef.typeTag === FieldTypeTag.COMPOSITE) {
      return {
        kind: "composite",
        schemaId: 0,
        fields: [],
      };
    }
    const numericBounds = getFieldDecisionBounds(fieldDef);
    if (numericBounds) {
      const [min, max] = numericBounds;
      // เริ่มจาก default + noise เล็กน้อย
      const center =
        typeof fieldDef.default === "number"
          ? fieldDef.default
          : (min + max) / 2;
      const noise = (max - min) * 0.1 * SeedMutator.randomGaussian();
      return SeedMutator.clamp(center + noise, min, max);
    }
    if (isNumericTypeTag(fieldDef.typeTag)) {
      throw new SchemaDeclarationError(
        `Numeric field ${fieldDef.name} requires range or decisionRange to generate defaults`,
      );
    }
    throw new SchemaDeclarationError(
      `Field ${fieldDef.name} of type ${fieldDef.typeTag} requires a default value for mutation-time materialization`,
    );
  }

  /** Weighted random sample — เลือก n ตัวจากรายการตามน้ำหนัก */
  private static weightedRandomSample(
    items: DomainFieldDefinition[],
    n: number,
  ): DomainFieldDefinition[] {
    const result: DomainFieldDefinition[] = [];
    const remaining = [...items];

    for (let i = 0; i < n && remaining.length > 0; i++) {
      const weights = remaining.map((item) => item.growthWeight ?? 1.0);
      const totalWeight = weights.reduce((a, b) => a + b, 0);

      let r = Math.random() * totalWeight;
      let selectedIdx = 0;

      for (let j = 0; j < weights.length; j++) {
        r -= weights[j];
        if (r <= 0) {
          selectedIdx = j;
          break;
        }
      }

      result.push(remaining[selectedIdx]);
      remaining.splice(selectedIdx, 1);
    }

    return result;
  }

  /** ปรับ bond parameters เล็กน้อย */
  private static perturbBondParams(params: BondParameters): BondParameters {
    const noise = () => 0.1 * SeedMutator.randomGaussian();

    switch (params.type) {
      case RelationshipType.CORRELATE:
        return {
          ...params,
          rho: SeedMutator.clamp(params.rho + noise(), -1, 1),
          influence:
            params.influence === undefined
              ? undefined
              : SeedMutator.clamp(params.influence + noise(), 0, 1),
        };
      case RelationshipType.CONSTRAIN:
        return {
          ...params,
          min: params.min + noise(),
          max: params.max + noise(),
        };
      case RelationshipType.SEQUENCE:
        return {
          ...params,
          offset: Math.max(0, params.offset + Math.round(noise() * 2)),
        };
      case RelationshipType.INHIBIT:
        return {
          ...params,
          strength: SeedMutator.clamp(params.strength + noise(), 0, 1),
        };
      case RelationshipType.AMPLIFY:
        return { ...params, factor: Math.max(1.0, params.factor + noise()) };
      case RelationshipType.CONDITIONAL_BLEND:
        return {
          ...params,
          blendFactor: Math.max(0, (params.blendFactor ?? 0.3) + noise()),
        };
      case RelationshipType.WEIGHTED_SUM:
        return {
          ...params,
          bias: (params.bias ?? 0) + noise(),
        };
      case RelationshipType.THRESHOLD_GATE:
        return {
          ...params,
          threshold: params.threshold + noise(),
        };
    }
  }

  /** Deep copy Seed */
  private static deepCopySeed(seed: Seed): Seed {
    return {
      header: { ...seed.header },
      coreFields: SeedMutator.deepCopyFields(seed.coreFields),
      textureFields: SeedMutator.deepCopyFields(seed.textureFields),
      bondFields: seed.bondFields.map((bond) => {
        const normalizedBond = normalizeBondField(bond);
        return {
          ...normalizedBond,
          sources: normalizedBond.sources?.map((source) => ({ ...source })),
          target: normalizedBond.target
            ? { ...normalizedBond.target }
            : undefined,
          parameters: { ...normalizedBond.parameters } as BondParameters,
        };
      }),
      contentHash: seed.contentHash,
      parseWarnings: seed.parseWarnings ? [...seed.parseWarnings] : undefined,
    };
  }

  /** Deep copy array of SeedField */
  private static deepCopyFields(fields: SeedField[]): SeedField[] {
    return fields.map((f) => ({
      ...f,
      value: deepCopyFieldValue(f.value),
    }));
  }

  /** สร้าง Seed เปล่า */
  private static emptySeed(): Seed {
    return {
      header: {
        magic: SEED_MAGIC,
        version: SEED_VERSION,
        domainId: "",
        generation: 0,
        entropyBudget: 128,
        coreSize: 0,
        textureSize: 0,
        bondSize: 0,
        flags: 0,
        crc32: 0,
        domainSchemaVersion: undefined,
      },
      coreFields: [],
      textureFields: [],
      bondFields: [],
      contentHash: "",
      parseWarnings: [],
    };
  }

  /** คำนวณ hash ใหม่หลัง mutation */
  private static rehash(seed: Seed): Seed {
    const reparsed = SeedParser.parse(SeedSerializer.serialize(seed));
    return {
      ...reparsed,
      parseWarnings: undefined,
    };
  }
}

// #############################################################################
// #############################################################################
//
//   PART 7: ระบบ Curation (การคัดเลือกโดยคน)
//   ──────────────────────────────────────────
//
//   ส่วนนี้คือ "หัวใจ" ของระบบ — คนดูผลงาน แล้วเลือก
//   เครื่องเสนอ คนเลือก — ห้ามใช้คะแนนอัตโนมัติ!
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CurationRecord — บันทึกการคัดเลือกแต่ละครั้ง
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ทุกครั้งที่คนดู artifact แล้วตัดสินใจ ต้องบันทึก:
 * - ใครเลือก? (curatorId)
 * - เลือกอะไร? (action)
 * - เพราะอะไร? (tags + note)
 * - เมื่อไหร่? (timestamp)
 * - จากตัวเลือกกี่ตัว? (batchSize)
 *
 * ถ้าไม่บันทึก → ประวัติศาสตร์ไร้ความหมาย → ละเมิด Axiom A3
 */
export interface CurationRecord {
  /** Hash ของ Seed ที่ถูกคัดเลือก */
  seedHash: string;

  /** ตัวตนของผู้คัดเลือก (pseudonymous = ไม่ระบุตัวจริง) */
  curatorId: string;

  /** การกระทำ: select, reject, salvage, archive */
  action: CurationAction;

  /**
   * Tags — คำอธิบายสั้นๆ ว่าทำไมถึงเลือก/ปฏิเสธ
   * บังคับอย่างน้อย 1 tag เพื่อป้องกัน "คลิกไม่คิด"
   *
   * หมวดหมู่ tags:
   * - Quality:    good-rhythm, harsh, clean, muddy
   * - Aesthetic:  melancholic, energetic, minimal, baroque
   * - Technical:  too-complex, well-balanced, over-simplified
   * - Comparative: better-than-parent, different-direction
   * - Structural: good-intro, weak-ending, strong-middle
   */
  tags: string[];

  /** หมายเหตยาย (ไม่บังคับ) — เช่น "ชอบจังหวะแต่เมโลดี้แปลกไป" */
  note?: string;

  /** ขนาด batch ที่ดู — เช่น ดู 10 ตัวแล้วเลือกตัวนี้ */
  batchSize: number;

  /** อันดับใน batch (1 = ตัวที่ดีที่สุด) */
  batchRank: number;

  /** เวลาที่คัดเลือก */
  timestamp: string; // ISO 8601
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SalvageRecord — บันทึกการ "เก็บของดีจากขยะ"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เมื่อ Seed ถูกปฏิเสธ แต่มีบางส่วนที่น่าสนใจ
 * เราสามารถ "เก็บ" fields ที่ดีออกมาใช้ต่อได้
 *
 * เหมือน "แกะเครื่องประดับจากตุ๊กตาที่เสียแล้วเอาไปใส่ตุ๊กตาใหม่"
 *
 * ข้อจำกัด: Seed ที่ถูกปฏิเสธห้ามเป็นพ่อแม่โดย default
 *           ยกเว้นผ่าน salvage — และต้องบันทึกใน lineage ด้วย
 */
export interface SalvageRecord {
  /** Hash ของ Seed ต้นทาง (ที่ถูกปฏิเสธ) */
  sourceSeedHash: string;

  /** Fields ที่เก็บมา */
  salvagedFields: Array<{
    fieldId: number;
    originalValue: SeedField["value"];
  }>;

  /** Seed ต้นทางถูกปฏิเสธหรือไม่? (ปกติคือใช่) */
  sourceWasRejected: boolean;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CurationService — จัดการกระบวนการคัดเลือก
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class CurationService {
  /**
   * บันทึกการคัดเลือก
   *
   * กฎสำคัญ:
   * - SELECT ต้องมีอย่างน้อย 1 tag (บังคับ!)
   * - ใน batch หนึ่งต้องมีอย่างน้อย 1 SELECT ก่อนจะไปรอบต่อไป
   * - ถ้าไม่มีตัวไหนดี → ต้องสร้าง batch ใหม่ หรือย้อนกลับ
   */
  static recordCuration(record: CurationRecord): void {
    // ตรวจว่า SELECT มี tag
    if (record.action === CurationAction.SELECT && record.tags.length === 0) {
      throw new Error("SELECT action requires at least 1 tag (Axiom A3)");
    }

    // ใน production: เขียนลง Curation Store (append-only)
    console.log(
      `[Curation] ${record.action} seed ${record.seedHash.slice(0, 12)}...`,
      `by ${record.curatorId}`,
      `tags: ${record.tags.join(", ")}`,
    );
  }

  /**
   * ตรวจว่า batch นี้มี SELECT อย่างน้อย 1 ตัว
   *
   * ถ้าไม่มี → ไม่สามารถไปรอบต่อไปได้
   * เพราะต้องมี base seed สำหรับ mutation รอบหน้า
   */
  static hasSelection(records: CurationRecord[]): boolean {
    return records.some((r) => r.action === CurationAction.SELECT);
  }
}

export interface SelectedSeedSnapshot {
  seed: Seed;
  tags: string[];
}

function compareFieldValuesForDistance(
  left: FieldValue | undefined,
  right: FieldValue | undefined,
  definition: DomainFieldDefinition | undefined,
  domain: DomainManifest,
): number {
  if (left === undefined || right === undefined) {
    return left === right ? 0 : 1;
  }

  if (isArrayFieldValue(left) || isArrayFieldValue(right)) {
    if (!isArrayFieldValue(left) || !isArrayFieldValue(right)) return 1;
    const length = Math.max(left.items.length, right.items.length);
    if (length === 0) return 0;
    const elementDefinition =
      definition?.elementTypeTag !== undefined
        ? { ...definition, typeTag: definition.elementTypeTag }
        : undefined;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += compareFieldValuesForDistance(
        left.items[i],
        right.items[i],
        elementDefinition,
        domain,
      );
    }
    return sum / length;
  }

  if (isCompositeFieldValue(left) || isCompositeFieldValue(right)) {
    if (!isCompositeFieldValue(left) || !isCompositeFieldValue(right)) return 1;
    const schema =
      (definition?.compositeSchema &&
        domain.compositeSchemas?.[definition.compositeSchema]) ||
      Object.values(domain.compositeSchemas ?? {}).find(
        (candidate) =>
          candidate.id === left.schemaId || candidate.id === right.schemaId,
      );
    const fieldDefs = new Map(schema?.fields.map((field) => [field.id, field]) ?? []);
    const leftById = new Map(left.fields.map((field) => [field.id, field]));
    const rightById = new Map(right.fields.map((field) => [field.id, field]));
    const ids = new Set([...leftById.keys(), ...rightById.keys()]);
    if (ids.size === 0) return 0;
    let sum = 0;
    for (const id of ids) {
      sum += compareFieldValuesForDistance(
        leftById.get(id)?.value,
        rightById.get(id)?.value,
        fieldDefs.get(id),
        domain,
      );
    }
    return sum / ids.size;
  }

  if (
    (typeof left === "number" || typeof left === "bigint") &&
    (typeof right === "number" || typeof right === "bigint")
  ) {
    const leftNumber = typeof left === "bigint" ? Number(left) : left;
    const rightNumber = typeof right === "bigint" ? Number(right) : right;
    const bounds = definition ? getFieldDecisionBounds(definition) : undefined;
    if (bounds) {
      const width = Math.max(bounds[1] - bounds[0], Number.EPSILON);
      return Math.min(1, Math.abs(leftNumber - rightNumber) / width);
    }
    return leftNumber === rightNumber ? 0 : 1;
  }

  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return 1;
    if (left.length !== right.length) return 1;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return 1;
    }
    return 0;
  }

  return left === right ? 0 : 1;
}

function collectionDistance(
  left: SeedField[],
  right: SeedField[],
  definitions: Map<number, DomainFieldDefinition>,
  domain: DomainManifest,
): number {
  const leftById = new Map(left.map((field) => [field.id, field]));
  const rightById = new Map(right.map((field) => [field.id, field]));
  const ids = new Set([...leftById.keys(), ...rightById.keys()]);
  if (ids.size === 0) return 0;

  let sum = 0;
  for (const id of ids) {
    sum += compareFieldValuesForDistance(
      leftById.get(id)?.value,
      rightById.get(id)?.value,
      definitions.get(id),
      domain,
    );
  }
  return sum / ids.size;
}

function compareBondDistance(left: BondField | undefined, right: BondField | undefined): number {
  if (!left || !right) return left === right ? 0 : 1;
  const a = normalizeBondField(left);
  const b = normalizeBondField(right);
  let parts = 0;
  let score = 0;

  const maxSources = Math.max(a.sources?.length ?? 0, b.sources?.length ?? 0);
  if (maxSources > 0) {
    let sourceScore = 0;
    for (let i = 0; i < maxSources; i++) {
      const leftSource = a.sources?.[i];
      const rightSource = b.sources?.[i];
      if (!leftSource || !rightSource) {
        sourceScore += 1;
        continue;
      }
      const idPenalty = leftSource.fieldId === rightSource.fieldId ? 0 : 1;
      const weightPenalty = Math.min(1, Math.abs(leftSource.weight - rightSource.weight));
      sourceScore += (idPenalty + weightPenalty) / 2;
    }
    score += sourceScore / maxSources;
    parts += 1;
  }

  score +=
    a.target?.fieldId === b.target?.fieldId &&
    a.target?.blendMode === b.target?.blendMode
      ? 0
      : 1;
  parts += 1;

  const paramScore =
    JSON.stringify(a.parameters) === JSON.stringify(b.parameters) ? 0 : 1;
  score += paramScore;
  parts += 1;

  return score / Math.max(parts, 1);
}

export class SeedDistance {
  static readonly DEFAULT_WEIGHTS: SeedDistanceWeights = {
    core: 0.6,
    texture: 0.3,
    bond: 0.1,
  };

  static compute(
    left: Seed,
    right: Seed,
    domain: DomainManifest,
    weights: SeedDistanceWeights = SeedDistance.DEFAULT_WEIGHTS,
  ): number {
    const definitions = fieldDefinitionsById(domain);
    const core = collectionDistance(left.coreFields, right.coreFields, definitions, domain);
    const texture = collectionDistance(
      left.textureFields,
      right.textureFields,
      definitions,
      domain,
    );
    const leftBonds = new Map(left.bondFields.map((bond) => [bond.id, bond]));
    const rightBonds = new Map(right.bondFields.map((bond) => [bond.id, bond]));
    const bondIds = new Set([...leftBonds.keys(), ...rightBonds.keys()]);
    let bond = 0;
    if (bondIds.size > 0) {
      let bondSum = 0;
      for (const id of bondIds) {
        bondSum += compareBondDistance(leftBonds.get(id), rightBonds.get(id));
      }
      bond = bondSum / bondIds.size;
    }

    return weights.core * core + weights.texture * texture + weights.bond * bond;
  }
}

export class StagnationDetector {
  static analyzeSelections(
    selections: SelectedSeedSnapshot[],
    domain: DomainManifest,
  ): StagnationAssessment {
    if (selections.length < 4) {
      return {
        stagnant: false,
        noveltyStreak: 0,
        meanNovelty: 1,
        tagCollapse: false,
        recommendation: null,
      };
    }

    let noveltyStreak = 0;
    let runningNovelty = 0;
    let runningCount = 0;
    for (let i = 1; i < selections.length; i++) {
      const current = selections[i].seed;
      const history = selections
        .slice(Math.max(0, i - 3), i)
        .map((entry) => entry.seed);
      const meanNovelty =
        history.reduce(
          (sum, previous) => sum + SeedDistance.compute(current, previous, domain),
          0,
        ) / history.length;
      runningNovelty = meanNovelty;
      runningCount += 1;
      if (meanNovelty < 0.1) {
        noveltyStreak += 1;
      } else {
        noveltyStreak = 0;
      }
    }

    const recent = selections.slice(-5);
    const topTagCounts = new Map<string, number>();
    for (const entry of recent) {
      const topTag = entry.tags[0];
      if (!topTag) continue;
      topTagCounts.set(topTag, (topTagCounts.get(topTag) ?? 0) + 1);
    }
    const tagCollapse = Array.from(topTagCounts.values()).some((count) => count >= 4);
    const stagnant = noveltyStreak >= 3 || tagCollapse;
    const recommendation = stagnant
      ? {
          recommendedRadius: "broad" as const,
          exploratoryRestartRatio: noveltyStreak >= 4 ? 0.2 : 0,
          reason: tagCollapse
            ? "Selections are collapsing onto the same top tags; widen the radius to broad."
            : "Novelty stayed below 0.10 across recent selected generations; widen the radius to broad.",
        }
      : null;

    return {
      stagnant,
      noveltyStreak,
      meanNovelty: runningCount > 0 ? runningNovelty : 1,
      tagCollapse,
      recommendation,
    };
  }
}

export class AdaptiveShortlist {
  static build(
    batch: Seed[],
    domain: DomainManifest,
    shortlistSize: number = Math.min(4, batch.length),
    randomSeed: number = 1,
  ): BatchShortlist {
    if (batch.length === 0) {
      return { batch: [], representativeIndices: [], clusterAssignments: [] };
    }

    const limit = Math.max(1, Math.min(shortlistSize, batch.length));
    const prng = DomainRuntime.createPRNG(randomSeed);
    const representatives: number[] = [Math.floor(prng() * batch.length)];

    while (representatives.length < limit) {
      let bestIndex = -1;
      let bestDistance = -1;
      for (let i = 0; i < batch.length; i++) {
        if (representatives.includes(i)) continue;
        const minDistance = representatives.reduce(
          (min, rep) =>
            Math.min(min, SeedDistance.compute(batch[i], batch[rep], domain)),
          Number.POSITIVE_INFINITY,
        );
        if (minDistance > bestDistance) {
          bestDistance = minDistance;
          bestIndex = i;
        }
      }
      if (bestIndex < 0) break;
      representatives.push(bestIndex);
    }

    const clusterAssignments = batch.map((seed) => {
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      representatives.forEach((index, clusterIndex) => {
        const distance = SeedDistance.compute(seed, batch[index], domain);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = clusterIndex;
        }
      });
      return bestCluster;
    });

    return {
      batch: [...batch],
      representativeIndices: representatives,
      clusterAssignments,
    };
  }
}

export class TuningFlowService {
  static applyStagnationStrategy(
    batch: Seed[],
    parent: Seed,
    domain: DomainManifest,
    assessment: StagnationAssessment,
  ): { batch: Seed[]; recommendation: RadiusRecommendation | null } {
    if (
      !assessment.recommendation ||
      assessment.recommendation.exploratoryRestartRatio <= 0
    ) {
      return { batch: [...batch], recommendation: assessment.recommendation };
    }

    const exploratoryCount = Math.max(
      1,
      Math.round(batch.length * assessment.recommendation.exploratoryRestartRatio),
    );
    const nextBatch = [...batch];
    for (let i = 0; i < exploratoryCount; i++) {
      let exploratory = SeedMutator.coreShift(
        parent,
        RADIUS_PRESETS.broad,
        domain,
      );
      exploratory = SeedMutator.textureGrowth(
        exploratory,
        RADIUS_PRESETS.broad,
        domain,
      );
      nextBatch[nextBatch.length - 1 - i] = exploratory;
    }

    return { batch: nextBatch, recommendation: assessment.recommendation };
  }
}

// #############################################################################
// #############################################################################
//
//   PART 8: ระบบ Lineage (ประวัติศาสตร์ของ Seed)
//   ─────────────────────────────────────────────
//
//   Lineage = "สายตระกูล" ของ Seed
//   ตอบคำถามว่า: Seed นี้มาจากไหน? ใครสร้าง? ใครเลือก? ทำไม?
//
//   ทำไมสายตระกูลสำคัญ?
//   → เพราะ Seed ที่ผ่านมือคนมาเยอะ = มี "แรงงานมนุษย์" ฝัง = มีค่า
//   → เหมือนภาพวาดที่มีประวัติการเป็นเจ้าของ = มีมูลค่า
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LineageOrigin — แหล่งกำเนิดของ Seed
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface LineageOrigin {
  /**
   * ประเภทกำเนิด:
   * - "genesis"    = สร้างจากศูนย์ (random seed)
   * - "mutation"   = เกิดจากการกลายพันธุ์จากพ่อ/แม่ตัวเดียว
   * - "crossover"  = เกิดจากการผสมพ่อแม่ 2 ตัว
   * - "adoption"   = ถูกนำเข้าจากภายนอกระบบ
   */
  type: "genesis" | "mutation" | "crossover" | "adoption";

  /** พ่อแม่ของ Seed นี้ — ว่างสำหรับ genesis */
  parents: Array<{
    seedHash: string;
    /** ส่วนที่พ่อ/แม่ตัวนี้สนับสนุน — เช่น "core fields", "texture fields" */
    contribution: string;
  }>;

  /** ชื่อ mutation operator ที่ใช้ — เช่น "core_shift", "texture_growth", "crossover" */
  mutationOperator: string;

  /** ค่า radius setting ที่ใช้ตอน mutate */
  mutationParameters: RadiusSetting;

  /** รอบที่เท่าไหร่ของการ tuning */
  generationRound: number;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LineageRecord — บันทึกประวัติศาสตร์ทั้งหมดของ Seed หนึ่งๆ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lineage record ไม่ได้เก็บใน Seed เอง (เพราะ Seed ต้อง portable)
 * แต่เก็บใน Lineage Store แยกต่างหาก — เหมือนทะเบียนบ้านแยกจากตัวบ้าน
 *
 * คุณสมบัติสำคัญ:
 * - Append-only: เขียนแล้วไม่ลบ ไม่แก้ (ถ้าผิด → เติม record แก้ไข)
 * - Public: ใครก็ตรวจสอบได้ (จำเป็นสำหรับ trust)
 * - Hash-chained: อ้างถึงพ่อแม่ด้วย hash → ป้องกันการแก้ประวัติ
 */
export interface LineageRecord {
  /** Hash ของ Seed นี้ (ใช้เป็น key ในการค้นหา) */
  seedHash: string;

  /** แหล่งกำเนิด */
  origin: LineageOrigin;

  /** การคัดเลือก */
  curation: {
    /** ตัวตนของผู้คัดเลือก (pseudonymous) */
    curatorId: string;
    /** การกระทำ */
    curatorAction: CurationAction;
    /** Tags ที่ติดมา */
    tags: string[];
    /** หมายเหตยาย */
    note?: string;
    /** batch มีกี่ตัว */
    batchSize: number;
    /** อันดับที่เท่าไหร่ใน batch */
    batchRank: number;
    /** เวลา */
    timestamp: string; // ISO 8601
  };

  /** ถ้ามี salvage origin — บอกว่าเอา field มาจาก seed ไหน */
  salvageOrigin?: SalvageRecord;

  /** ข้อมูลการรัน */
  execution: {
    /** Domain ที่รัน */
    domainId: string;
    /** เวอร์ชัน Domain */
    domainVersion: string;
    /** Execution seed (สำหรับ reproducibility) */
    executionSeed: number;
    /** เวลาที่รัน */
    executionTimestamp: string; // ISO 8601
  };
}

export class InMemoryLineageStore implements LineageStore {
  private readonly records: LineageRecord[];

  constructor(initialRecords: LineageRecord[] = []) {
    this.records = initialRecords.map((record) => structuredClone(record));
  }

  append(record: LineageRecord): void {
    this.records.push(structuredClone(record));
  }

  loadAll(): LineageRecord[] {
    return this.records.map((record) => structuredClone(record));
  }
}

export class JsonlLineageStore implements LineageStore {
  constructor(
    private readonly filePath: string = "./data/lineage.jsonl",
  ) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) {
      appendFileSync(this.filePath, "", "utf8");
    }
  }

  append(record: LineageRecord): void {
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  loadAll(): LineageRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const raw = readFileSync(this.filePath, "utf8");
    if (raw.trim().length === 0) return [];

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line) as LineageRecord;
        } catch (error) {
          throw new Error(
            `Malformed lineage JSONL at line ${index + 1}: ${
              error instanceof Error ? error.message : "unknown parse error"
            }`,
          );
        }
      });
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LineageGraph — กราฟความสัมพันธ์ของ Seeds ทั้งหมด
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * กราฟนี้เป็น DAG (Directed Acyclic Graph) — มีทิศทาง ไม่มีวนลูป
 *
 *   Genesis A ──► Child A1 ──► Child A1a (SELECTED)
 *       │                                    │
 *       └──► Child A2 (REJECTED, salvaged)   │
 *                   │                         ▼
 *                   └─salvage─► Child A1b (has salvaged fields from A2)
 *                                              │
 *                                              ▼
 *                                       Child A1b1 ──► ...
 *
 * คุณสมบัติ:
 * - DAG ไม่ใช่ tree: crossover ทำให้มี 2 พ่อแม่
 * - Immutable: เขียนแล้วไม่แก้
 * - Public: ใครก็ตรวจได้
 * - Hash-chained: อ้างอิงด้วย hash → ตรวจจับการปลอมได้
 */
export class LineageService {
  private readonly store: LineageStore;
  private records: Map<string, LineageRecord> = new Map();

  constructor(store: LineageStore = new JsonlLineageStore()) {
    this.store = store;
    for (const record of store.loadAll()) {
      this.records.set(record.seedHash, structuredClone(record));
    }
  }

  /**
   * เพิ่ม lineage record (append-only — ไม่มีการลบหรือแก้ไข)
   */
  append(record: LineageRecord): void {
    if (this.records.has(record.seedHash)) {
      // ไม่ throw — อาจเป็นการ re-sync แต่ log เตือน
      console.warn(
        `Lineage record already exists for ${record.seedHash.slice(0, 12)}...`,
      );
      return;
    }
    const cloned = structuredClone(record);
    this.store.append(cloned);
    this.records.set(record.seedHash, cloned);
  }

  /**
   * ค้นหา lineage ของ Seed
   */
  query(seedHash: string): LineageRecord | undefined {
    return this.records.get(seedHash);
  }

  listAll(): LineageRecord[] {
    return Array.from(this.records.values()).map((record) =>
      structuredClone(record),
    );
  }

  /**
   * ═══════════════════════════════════════════════════════════════════
   * คำนวณ Effective Depth
   * ═══════════════════════════════════════════════════════════════════
   *
   * Generation count ใน header นับทุกรอบ mutation
   * แต่ Effective Depth นับแค่รอบที่ "คนเลือกจริงๆ"
   *
   * ทำไมต้องแยก?
   * → Seed ที่ผ่าน mutation 20 รอบแต่คนเลือกแค่ 5 รอบ
   *    = มีแรงงานมนุษย์น้อย = มีค่าน้อย
   * → Seed ที่ generation = effective depth (คนเลือกทุกรอบ)
   *    = มีแรงงานมนุษย์มาก = มีค่ามาก
   *
   * คำนวณ: นับจำนวน curation action = "select" ในเส้นทาง lineage
   */
  computeEffectiveDepth(seedHash: string): number {
    const record = this.records.get(seedHash);
    if (!record) return 0;

    let depth = 0;

    // ถ้า seed นี้ถูกเลือก → +1
    if (record.curation.curatorAction === CurationAction.SELECT) {
      depth += 1;
    }

    // วนตามพ่อแม่ (recursive)
    for (const parent of record.origin.parents) {
      depth += this.computeEffectiveDepth(parent.seedHash);
    }

    return depth;
  }

  /**
   * สร้าง Tree View — แสดงสายตระกูลแบบต้นไม้
   * ("ใครเป็นพ่อแม่ของใคร")
   */
  getTreeView(seedHash: string, maxDepth: number = 10): object {
    const record = this.records.get(seedHash);
    if (!record || maxDepth <= 0)
      return { hash: seedHash.slice(0, 12), children: [] };

    return {
      hash: seedHash.slice(0, 12) + "...",
      action: record.curation.curatorAction,
      generation: record.origin.generationRound,
      parents: record.origin.parents.map((p) =>
        this.getTreeView(p.seedHash, maxDepth - 1),
      ),
    };
  }

  /**
   * สร้าง Story View — เล่าเรื่องเป็นภาษาคน
   *
   * ตัวอย่างผลลัพธ์:
   * "Seed นี้สร้างจากศูนย์โดย Alice เมื่อ 2025-03-15
   *  ถูกปฏิเสธ 3 รอบเพราะ rhythm ไม่ดี
   *  รอบที่ 4 Bob เห็นว่าเมโลดี้มีศักยภาพ จึงเลือก
   *  Bob tune ต่ออีก 2 รอบ เพิ่ม dynamic variation
   *  ปัจจุบัน seed นี้ผ่านการ tune 7 รอด โดย 2 คน"
   */
  getStoryView(seedHash: string): string {
    const record = this.records.get(seedHash);
    if (!record) return `ไม่พบประวัติของ Seed ${seedHash.slice(0, 12)}...`;

    const parts: string[] = [];

    // กำเนิด
    if (record.origin.type === "genesis") {
      parts.push(`Seed นี้สร้างจากศูนย์โดย ${record.curation.curatorId}`);
    } else if (record.origin.type === "mutation") {
      parts.push(
        `Seed นี้เกิดจากการ mutate จาก seed ${record.origin.parents[0]?.seedHash.slice(0, 12) ?? "?"}...`,
      );
    } else if (record.origin.type === "crossover") {
      const parentHashes = record.origin.parents
        .map((p) => p.seedHash.slice(0, 12))
        .join(" + ");
      parts.push(`Seed นี้เกิดจากการ crossover ระหว่าง ${parentHashes}...`);
    }

    // การคัดเลือก
    parts.push(
      `ถูก${record.curation.curatorAction === CurationAction.SELECT ? "เลือก" : "ปฏิเสธ"}โดย ${record.curation.curatorId}`,
    );
    if (record.curation.tags.length > 0) {
      parts.push(`เพราะ: ${record.curation.tags.join(", ")}`);
    }

    return parts.join(" ");
  }

  /**
   * ตรวจสอบความสมบูรณ์ของ lineage chain
   *
   * วิธี: ตรวจทุก record ว่า parent hashes มีอยู่จริงใน store
   * ถ้า parent หาย → chain ขาด → lineage น่าสงสัย
   */
  verifyChainIntegrity(seedHash: string): {
    valid: boolean;
    brokenLinks: string[];
  } {
    const brokenLinks: string[] = [];

    const check = (hash: string, visited: Set<string>) => {
      if (visited.has(hash)) return; // ป้องกัน infinite loop
      visited.add(hash);

      const record = this.records.get(hash);
      if (!record) {
        brokenLinks.push(hash);
        return;
      }

      for (const parent of record.origin.parents) {
        check(parent.seedHash, visited);
      }
    };

    check(seedHash, new Set());

    return { valid: brokenLinks.length === 0, brokenLinks };
  }
}

// #############################################################################
// #############################################################################
//
//   PART 9: ระบบ Trust (ความน่าเชื่อถือ)
//   ─────────────────────────────────────────
//
//   ปัญหา: Seed เป็นกล่องดำ — ซื้อมาแล้วไม่รู้ว่าข้างในคืออะไร
//   จะไว้ใจได้อย่างไรว่า Seed นี้ดีจริง?
//
//   คำตอบ: ไม่ได้เปิดกล่อง (เพราะจะทำลายมูลค่า)
//   แต่ "พิสูจน์ข้ออ้างโดยไม่เปิดเผยเนื้อหา"
//
//   5 Mechanisms:
//   1. Artifact Gallery    = พิสูจน์ว่าทำได้จริง
//   2. Lineage Disclosure  = พิสูจน์ว่ามีแรงงานมนุษย์
//   3. Curator Reputation  = พิสูจน์ว่าคนขายน่าเชื่อถือ
//   4. Deterministic Preview = พิสูจน์ว่า reproducible
//   5. Domain Compatibility  = พิสูจน์ว่าใช้ได้กับ Domain ปัจจุบัน
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ArtifactMetadata — ข้อมูลประกอบของ Artifact ที่ผลิตออกมา
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ทุกครั้งที่รัน Seed ใน Domain จะได้ Artifact + Metadata นี้มาด้วย
 * Metadata สำคัญมากเพราะ:
 * - ใช้ตรวจสอบ reproducibility (seed + execution_seed เดียวกัน → ผลเดียวกัน?)
 * - ใช้ track lineage (seed hash ไหน รันเมื่อไหร่)
 * - ใช้ debug (constraint ไหนถูกบังคับ? bond ไหนถูก apply?)
 */
export interface ArtifactMetadata {
  /** Hash ของ Seed ที่ใช้รัน */
  seedHash: string;

  /** Domain ที่รัน */
  domainId: string;

  /** เวอร์ชัน Domain ที่รัน */
  domainVersion: string;

  /** Generation ของ Seed (จาก header) */
  generation: number;

  /** Entropy budget ที่ใช้ */
  entropyBudget: number;

  /**
   * Execution seed — ค่า PRNG seed ที่ใช้รันครั้งนี้
   *
   * สำคัญมาก! ถ้าบันทึกค่านี้ไว้ → สามารถรันซ้ำได้เหมือนเดิม
   * เหมือนบันทึก "seed ของการสุ่ม" ในเกม Minecraft
   * ใส่ seed เดียวกัน → โลกเดียวกันเสมอ
   */
  executionSeed: number;

  /** เวลาที่รัน */
  executionTimestamp: string; // ISO 8601

  /** Constraint ที่ถูกบังคับ — บอกว่ามีกฎไหนที่แก้ผลงานบ้าง */
  constraintViolations: Array<{
    constraintId: string;
    enforcementMode: EnforcementMode;
    wasApplied: boolean;
  }>;

  /** Bond ที่ถูก apply — บอกว่า bond ไหนเปลี่ยนค่า field บ้าง */
  bondApplications: Array<{
    bondId: number;
    sourceField: number;
    targetField: number;
    adjustment: number;
  }>;

  /** migration ที่ถูก apply ก่อนรัน */
  migrationAuditTrail?: MigrationAuditRecord[];

  /** สถานะ knowledge references ที่ resolve ตอนรัน */
  resolvedKnowledge?: ResolvedKnowledgeReference[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CuratorReputation — คะแนนชื่อเสียงของผู้คัดเลือก
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * หลักการ: Reputation หาได้ด้วยการทำดีต่อเนื่อง
 * ไม่ใช่ซื้อได้ ไม่ใช่ประกาศเอง
 *
 * เหมือนชื่อเสียงของศิลปิน — ต้องสร้างผลงานดีๆ ต่อเนื่อง
 * จึงจะมีคนไว้วางใจ
 */
export interface CuratorReputation {
  /** จำนวน seeds ที่เผยแพร่ */
  seedsPublished: number;

  /** จำนวน seeds ที่ขายแล้ว */
  seedsSold: number;

  /** คะแนนเฉลี่ยจากผู้ซื้อ (1-5) */
  avgBuyerRating: number;

  /** Effective depth เฉลี่ยของ seeds ที่สร้าง */
  lineageDepthAvg: number;

  /** อายุบัญชี (วัน) */
  accountAgeDays: number;

  /** สถานะยืนยันตัวตน */
  verificationStatus: "unverified" | "email-verified" | "identity-verified";
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TrustService — บริการตรวจสอบความน่าเชื่อถือ
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class TrustService {
  /**
   * Mechanism 1: Artifact Gallery — พิสูจน์ว่า Seed ทำได้จริง
   *
   * กฎ: Seed ที่ขายต้องมี artifact อย่างน้อย 3 ชิ้น
   *      สำหรับ nondeterministic domain → อย่างน้อย 5 ชิ้นจาก execution_seeds ต่างกัน
   *
   * ผู้ซื้อสามารถ re-run ด้วย execution_seed เดียวกัน → ตรวจว่าได้ผลเหมือนกัน
   * ถ้าไม่เหมือน → ขายเป็นของปลอม!
   */
  static verifyArtifactGallery(
    seed: Seed,
    artifacts: Array<{ metadata: ArtifactMetadata; data: unknown }>,
    domain: DomainManifest,
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // ตรวจจำนวน artifacts
    const minRequired = domain.determinism === "deterministic" ? 3 : 5;
    if (artifacts.length < minRequired) {
      issues.push(
        `ต้องมี artifact อย่างน้อย ${minRequired} ชิ้น (มี ${artifacts.length})`,
      );
    }

    // ตรวจว่าทุก artifact มาจาก seed เดียวกัน
    const seedHash = seed.contentHash;
    for (const art of artifacts) {
      if (art.metadata.seedHash !== seedHash) {
        issues.push(
          `Artifact ไม่ตรงกับ seed hash: ${art.metadata.seedHash.slice(0, 12)}...`,
        );
      }
    }

    // ตรวจว่า nondeterministic domain มี execution_seeds ต่างกัน
    if (domain.determinism === "nondeterministic") {
      const uniqueExecSeeds = new Set(
        artifacts.map((a) => a.metadata.executionSeed),
      );
      if (uniqueExecSeeds.size < 5) {
        issues.push(
          `Nondeterministic domain ต้องมี execution_seeds ต่างกันอย่างน้อย 5 (มี ${uniqueExecSeeds.size})`,
        );
      }
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Mechanism 2: Lineage Disclosure — พิสูจน์ว่ามีแรงงานมนุษย์
   *
   * ตรวจว่า:
   * - Seed มี lineage record สาธารณะ
   * - Lineage chain ไม่ขาด
   * - Effective depth เพียงพอ
   * - มี curator หลายคน (ไม่ใช่ตัวเองเลือกคนเดียว)
   */
  static verifyLineageDisclosure(
    seed: Seed,
    lineageService: LineageService,
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    const record = lineageService.query(seed.contentHash);
    if (!record) {
      issues.push("ไม่พบ lineage record — seed นี้ไม่มีประวัติ");
      return { valid: false, issues };
    }

    // ตรวจ chain integrity
    const integrity = lineageService.verifyChainIntegrity(seed.contentHash);
    if (!integrity.valid) {
      issues.push(`Lineage chain ขาด: ${integrity.brokenLinks.length} จุด`);
    }

    // ตรวจ effective depth
    const effectiveDepth = lineageService.computeEffectiveDepth(
      seed.contentHash,
    );
    if (effectiveDepth < 2) {
      issues.push(
        `Effective depth ต่ำเกินไป: ${effectiveDepth} (แนะนำอย่างน้อย 2)`,
      );
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Mechanism 3: Curator Reputation — พิสูจน์ว่าคนขายน่าเชื่อถือ
   *
   * คำนวณ reputation score จากหลายปัจจัย
   * ไม่มีสูตรตายตัว — ปรับได้ตาม context
   */
  static computeReputationScore(rep: CuratorReputation): number {
    // สูตรง่ายๆ (ใน production จะซับซ้อนกว่านี้)
    const accountScore = Math.min(rep.accountAgeDays / 365, 1) * 20; // สูงสุด 20
    const publishScore = Math.min(rep.seedsPublished / 10, 1) * 20; // สูงสุด 20
    const ratingScore = (rep.avgBuyerRating / 5) * 30; // สูงสุด 30
    const depthScore = Math.min(rep.lineageDepthAvg / 5, 1) * 20; // สูงสุด 20
    const verifyScore =
      rep.verificationStatus === "identity-verified"
        ? 10
        : rep.verificationStatus === "email-verified"
          ? 5
          : 0; // สูงสุด 10

    return accountScore + publishScore + ratingScore + depthScore + verifyScore;
    // คะแนนเต็ม 100
  }

  /**
   * Mechanism 5: Domain Compatibility — พิสูจน์ว่าใช้ได้กับ Domain ปัจจุบัน
   *
   * ตรวจว่า:
   * - Domain ID ใน header ตรงกับ domain ที่จะรัน
   * - เวอร์ชัน compatible
   * - Seed สามารถ parse ได้โดยไม่ error
   * - Core fields ที่จำเป็นครบ
   */
  static verifyDomainCompatibility(
    seed: Seed,
    domain: DomainManifest,
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // ตรวจ domain ID
    if (seed.header.domainId !== domain.id) {
      issues.push(
        `Domain ID ไม่ตรง: seed=${seed.header.domainId}, domain=${domain.id}`,
      );
    }

    // ตรวจ core fields ที่จำเป็น
    const seedFieldIds = new Set(seed.coreFields.map((f) => f.id));
    for (const fieldDef of domain.coreFields) {
      if (fieldDef.required && !seedFieldIds.has(fieldDef.id)) {
        issues.push(
          `Core field ที่จำเป็นขาดหาย: ${fieldDef.name} (id=${fieldDef.id})`,
        );
      }
    }

    // ตรวจขนาด
    if (
      seed.coreFields.reduce(
        (s, f) => s + SeedMutatorEstimate.fieldSize(f, seed.header.version),
        0,
      ) > SEED_SIZE_LIMITS.coreMax
    ) {
      issues.push("Core section เกินขนาดสูงสุด");
    }

    return { valid: issues.length === 0, issues };
  }
}

/** Helper: ประมาณขนาย field (ใช้ในการตรวจสอบ) */
namespace SeedMutatorEstimate {
  export function fieldSize(
    field: SeedField,
    version: number = SEED_VERSION,
  ): number {
    return (
      getFieldIdByteWidth(version) +
      1 +
      SeedSerializer.measureValue(field, version)
    );
  }
}

// #############################################################################
// #############################################################################
//
//   PART 10: ระบบ Economy (เศรษฐกิจและตลาดซื้อขาย)
//   ────────────────────────────────────────────────
//
//   Seed ที่ดีมีค่า เพราะ: หายาก + มีแรงงานมนุษย์ + ใช้ได้จริง + มีเรื่องเล่า
//   คนสามารถแลกเปลี่ยน/ซื้อขาย seed ได้
//
//   ⚠️ กฎสำคัญ: ห้ามให้เศรษฐกิจครอบงำ curation!
//   - ห้าม rank ตามยอดขาย
//   - ห้าม trending algorithm
//   - ห้าม pay-for-placement
//   - หน่วยของ reputation คือ "คน" (curator) ไม่ใช่ "seed"
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ExchangeModel — รูปแบบการซื้อขาย
 * ═══════════════════════════════════════════════════════════════════════════
 */
export enum ExchangeModel {
  /**
   * Full Sale — ขายขาด
   * ผู้ซื้อได้: กรรมสิทธิ์เต็ม + lineage + สิทธิ์ tune และขายต่อ
   * ราคา: สูง
   * ใช้เมื่อ: ผู้ซื้ออยากต่อยอด seed นี้
   */
  FULL_SALE = "full_sale",

  /**
   * License (Use) — สัญญาอนุญาตใช้
   * ผู้ซื้อได้: สิทธิ์รันเท่านั้น ห้ามแก้ ห้ามขายต่อ
   * ราคา: ต่ำ-กลาง
   * ใช้เมื่อ: ผู้ซื้ออยากได้แค่ผลงาน ไม่อยากได้ seed
   */
  LICENSE_USE = "license_use",

  /**
   * License (Tune) — สัญญาอนุญาตปรับแต่ง
   * ผู้ซื้อได้: สิทธิ์รัน + แก้ไข แต่ห้ามขายของเดิม
   * ราคา: กลาง
   * ใช้เมื่อ: ผู้ซื้ออยากสร้าง seed ลูกจาก seed นี้
   */
  LICENSE_TUNE = "license_tune",

  /**
   * Subscription — สมัครสมาชิก
   * ผู้ซื้อได้: เข้าถึง seed ทั้งหมดของ curator ตามระยะเวลา
   * ราคา: รายเดือน/รายปี
   * ใช้เมื่อ: อยากตามผลงาน curator คนไหนคนหนึ่ง
   */
  SUBSCRIPTION = "subscription",

  /**
   * Commission — จ้างทำ
   * ผู้ซื้อได้: seed ที่สร้างตามสั่ง
   * ราคา: สูงมาก
   * ใช้เมื่อ: อยากได้ seed เฉพาะทาง
   */
  COMMISSION = "commission",
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SeedListing — รายการขาย Seed ในตลาด
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface SeedListing {
  /** ID ของรายการ */
  id: string;

  /** Hash ของ Seed ที่ขาย */
  seedHash: string;

  /** ผู้ขาย */
  sellerId: string;

  /** รูปแบบการขาย */
  exchangeModel: ExchangeModel;

  /** ราคา (ในหน่วยสกุลเงินของระบบ) */
  price: number;

  /** Artifact gallery — ตัวอย่างผลงาน (ต้องมีอย่างน้อย 3-5 ชิ้น) */
  artifactGallery: Array<{
    metadata: ArtifactMetadata;
    /** URL หรือ reference ไปยังข้อมูล artifact */
    artifactRef: string;
  }>;

  /** Execution seed สำหรับ reference preview (reproducible) */
  referenceExecutionSeed: number;

  /** เวลาที่ลงขาย */
  listedAt: string; // ISO 8601

  /** สถานะ */
  status: "active" | "sold" | "delisted";
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ValueTheory — ทฤษฎีมูลค่าของ Seed
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * มูลค่าของ Seed มาจาก 4 เสา (Axiom A6):
 *
 * 1. Scarcity (ความหายาก) — โอกาสเจอ seed ดีแบบนี้แบบสุ่มเป็นเท่าไหร่?
 *    ยิ่งหายาก = ยิ่งมีค่า (เหมือนเพชร vs หินธรรมดา)
 *
 * 2. Labor (แรงงานมนุษย์) — ใส่แรงไปเท่าไหร่?
 *    ยิ่ง tune มาก = ยิ่งมีค่า (เหมือนงานฝีมือ vs โรงงาน)
 *
 * 3. Utility (ประโยชน์) — ใช้ได้กี่กรณี?
 *    ยิ่งใช้ได้หลากหลาย = ยิ่งมีค่า
 *
 * 4. Narrative (เรื่องเล่า) — เรื่องราวน่าสนใจแค่ไหน?
 *    ยิ่งมีเรื่องเล่า = ยิ่งมีค่า (เหมือนของเก่าที่มีประวัติ)
 */
export namespace ValueTheory {
  /**
   * ประมาณค่า Scarcity
   *
   * คิดง่ายๆ: seed ที่ quality สูง = หายาก = scarcity สูง
   * เพราะใน seed space ส่วนใหญ่เป็น "ขยะ" (§2.2 Quality Landscape)
   *
   * ยิ่ง quality สูง → โอกาสเจอแบบสุ่มยิ่งต่ำ → scarcity ยิ่งสูง
   * แต่เราไม่รู้ Q(s) โดยตรง (มัน unobservable)
   * ใช้ effective depth เป็น proxy แทน
   */
  export function estimateScarcity(
    effectiveDepth: number,
    generation: number,
  ): number {
    // ยิ่ง depth สูงเทียบกับ generation = คนเลือกเยอะ = seed ดี = หายาก
    const depthRatio = effectiveDepth / Math.max(generation, 1);
    // ใช้ exponential เพราะ quality landscape มีลักษณะ sparse
    return Math.pow(depthRatio, 2) * Math.log(generation + 1);
  }

  /**
   * ประมาณค่า Labor
   *
   * นับจาก lineage: แต่ละรอบ curation = เวลา × ความซับซ้อน
   */
  export function estimateLabor(lineageRecords: LineageRecord[]): number {
    let totalLabor = 0;

    for (const record of lineageRecords) {
      // ประมาณเวลา: batch ใหญ่ = ดูนาน
      const estimatedTime = record.curation.batchSize * 2; // 2 นาทีต่อ artifact
      // ความซับซ้อน: ยิ่งมี field เปลี่ยนเยอะ = ซับซ้อน
      const complexity =
        record.origin.mutationParameters.textureGrowthCount +
        record.origin.mutationParameters.bondGrowthCount +
        1; // +1 เพื่อไม่ให้เป็น 0

      totalLabor += estimatedTime * complexity;
    }

    return totalLabor;
  }

  /**
   * ประมาณค่า Utility
   *
   * สำหรับ nondeterministic domain:
   *   utility = สัดส่วน execution_seeds ที่ให้ผลดี / ทั้งหมด
   * สำหรับ deterministic domain:
   *   utility = binary (ได้หรือไม่ได้)
   */
  export function estimateUtility(
    domain: DomainManifest,
    successfulExecutions: number,
    totalExecutions: number,
  ): number {
    if (domain.determinism === "deterministic") {
      return successfulExecutions > 0 ? 1 : 0;
    }
    return totalExecutions > 0 ? successfulExecutions / totalExecutions : 0;
  }

  /**
   * ประมาณค่า Narrative
   *
   * เรื่องเล่าดี = lineage ลึก + curator หลายคน + มีคนดัง + มีลูกหลายเยอะ
   */
  export function estimateNarrative(params: {
    lineageDepth: number;
    numCurators: number;
    curatorReputationSum: number;
    numDescendants: number;
    numViews: number;
    numExchanges: number;
  }): number {
    const depthScore = Math.min(params.lineageDepth / 10, 1) * 25;
    const curatorScore = Math.min(params.numCurators / 5, 1) * 25;
    const reputationScore = Math.min(params.curatorReputationSum / 500, 1) * 25;
    const descendantScore = Math.min(params.numDescendants / 20, 1) * 25;

    return depthScore + curatorScore + reputationScore + descendantScore;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MarketplaceService — บริการตลาดซื้อขาย
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * กฎ Anti-Goodhart สำหรับ marketplace:
 * - ห้าม rank ตามยอดขาย (popular ≠ good)
 * - ห้าม trending algorithm (กดดันให้ทำของ viral แทนของดี)
 * - ห้าม pay-for-placement
 * - หน่วยของ reputation คือ curator (คน) ไม่ใช่ seed (ของ)
 */
export class MarketplaceService {
  private listings: Map<string, SeedListing> = new Map();

  /**
   * ลงขาย Seed
   *
   * ตรวจสอบก่อนว่า:
   * - มี artifact gallery เพียงพอ
   * - Lineage เปิดเผย
   * - Domain compatible
   */
  listSeed(
    listing: SeedListing,
    seed: Seed,
    domain: DomainManifest,
    lineageService: LineageService,
  ): { success: boolean; issues: string[] } {
    const issues: string[] = [];

    // ตรวจ artifact gallery
    const galleryCheck = TrustService.verifyArtifactGallery(
      seed,
      listing.artifactGallery.map((a) => ({
        metadata: a.metadata,
        data: null,
      })),
      domain,
    );
    issues.push(...galleryCheck.issues);

    // ตรวจ lineage
    const lineageCheck = TrustService.verifyLineageDisclosure(
      seed,
      lineageService,
    );
    issues.push(...lineageCheck.issues);

    // ตรวจ domain compatibility
    const compatCheck = TrustService.verifyDomainCompatibility(seed, domain);
    issues.push(...compatCheck.issues);

    if (issues.length > 0) {
      return { success: false, issues };
    }

    this.listings.set(listing.id, listing);
    return { success: true, issues: [] };
  }

  /**
   * ค้นหา Seeds
   *
   * ⚠️ ไม่ใช้ยอดขายหรือ trending!
   * ค้นได้ตาม: domain, tags, curator reputation
   */
  searchSeeds(params: {
    domainId?: string;
    tags?: string[];
    minCuratorReputation?: number;
  }): SeedListing[] {
    let results = Array.from(this.listings.values()).filter(
      (l) => l.status === "active",
    );

    if (params.domainId) {
      // ต้องดูจาก seed hash → seed → domain ID
      // ใน production จะมี index สำหรับ query นี้
    }

    return results;
  }
}

// #############################################################################
// #############################################################################
//
//   PART 11: Execution Pipeline (วิธีรัน Seed ใน Domain)
//   ─────────────────────────────────────────────────────
//
//   เมื่อ Domain ได้รับ Seed มา จะผ่าน pipeline 6 ขั้นตอน:
//
//   VALIDATE → PARSE → RESOLVE → GENERATE → CONSTRAIN → OUTPUT
//
//   แต่ละขั้นมีหน้าที่ชัดเจน ถ้าขั้นไหนล้มเหลว → หยุดและแจ้ง error
//
// #############################################################################
// #############################################################################

export class KnowledgeResolver {
  static resolve(
    knowledge: DomainManifest["knowledge"],
    registry:
      | Map<string, KnowledgeModule>
      | Record<string, KnowledgeModule> = {},
  ): ResolvedKnowledgeReference[] {
    const references = knowledge.references ?? [];
    return references.map((reference) => {
      const direct = KnowledgeResolver.lookup(registry, reference.uuid);
      if (direct && direct.version === reference.version) {
        return {
          reference,
          resolvedUuid: reference.uuid,
          status: "resolved",
          module: direct,
        };
      }

      if (reference.fallback) {
        const fallback = KnowledgeResolver.lookup(registry, reference.fallback);
        if (fallback) {
          return {
            reference,
            resolvedUuid: reference.fallback,
            status: "fallback",
            module: fallback,
          };
        }
      }

      return {
        reference,
        resolvedUuid: null,
        status: "missing",
      };
    });
  }

  private static lookup(
    registry: Map<string, KnowledgeModule> | Record<string, KnowledgeModule>,
    uuid: string,
  ): KnowledgeModule | undefined {
    return registry instanceof Map ? registry.get(uuid) : registry[uuid];
  }
}

export class DeclarativeConstraintEngine {
  static evaluateConstraint(
    constraint: DomainConstraint,
    artifact: unknown,
  ): { passed: boolean; messages: string[] } {
    if (constraint.rules && constraint.rules.length > 0) {
      const failures = constraint.rules.filter(
        (rule) => !DeclarativeConstraintEngine.evaluateRule(rule, artifact),
      );
      return {
        passed: failures.length === 0,
        messages: failures.map(
          (rule) =>
            rule.message ??
            `${rule.field} ${rule.operator} ${JSON.stringify(rule.value)}`,
        ),
      };
    }

    if (constraint.check) {
      return { passed: constraint.check(artifact), messages: [] };
    }

    return { passed: true, messages: [] };
  }

  static evaluateRule(rule: DeclarativeRule, artifact: unknown): boolean {
    const value = fieldValueToComparable(readPath(artifact, rule.field));
    return compareComparableValues(value, rule.operator, rule.value);
  }
}

export class SchemaMigrator {
  static migrateToDomain(
    seed: Seed,
    domain: DomainManifest,
  ): { seed: Seed; auditTrail: MigrationAuditRecord[] } {
    const normalizedSeed = normalizeSeed(seed);
    const sourceVersion =
      normalizedSeed.header.domainSchemaVersion ??
      (isSeedVersionV2(normalizedSeed.header.version) ? domain.version : "1.0.0");

    if (
      sourceVersion === domain.version ||
      domain.migrations === undefined ||
      Object.keys(domain.migrations).length === 0
    ) {
      return { seed: normalizedSeed, auditTrail: [] };
    }

    const stepsByEdge = new Map<
      string,
      { from: string; to: string; steps: MigrationStep[] }
    >();
    for (const [range, steps] of Object.entries(domain.migrations)) {
      const match = range.match(/^\s*(.+?)\s*(?:->|→)\s*(.+?)\s*$/);
      if (!match) continue;
      const [, from, to] = match;
      stepsByEdge.set(`${from}::${to}`, { from, to, steps });
    }

    const queue: Array<{
      version: string;
      path: Array<{ from: string; to: string; steps: MigrationStep[] }>;
    }> = [{ version: sourceVersion, path: [] }];
    const visited = new Set<string>([sourceVersion]);
    let path: Array<{
      from: string;
      to: string;
      steps: MigrationStep[];
    }> | null = null;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.version === domain.version) {
        path = current.path;
        break;
      }

      for (const edge of stepsByEdge.values()) {
        if (edge.from !== current.version || visited.has(edge.to)) continue;
        visited.add(edge.to);
        queue.push({
          version: edge.to,
          path: [...current.path, edge],
        });
      }
    }

    if (path === null) {
      throw new Error(
        `No migration path from ${sourceVersion} to ${domain.version}`,
      );
    }

    const migratedSeed = normalizeSeed(normalizedSeed);
    const auditTrail: MigrationAuditRecord[] = [];
    for (const edge of path) {
      for (const step of edge.steps) {
        SchemaMigrator.applyStep(migratedSeed, step);
        auditTrail.push({
          fromVersion: edge.from,
          toVersion: edge.to,
          step: {
            ...step,
            parameters: { ...step.parameters },
          },
        });
      }
    }

    migratedSeed.header.domainSchemaVersion = domain.version;
    return { seed: migratedSeed, auditTrail };
  }

  private static applyStep(seed: Seed, step: MigrationStep): void {
    const location = SchemaMigrator.findField(seed, step.field);

    switch (step.operation) {
      case "multiply":
        if (location && typeof location.field.value === "number") {
          const by = Number(step.parameters.by ?? 1);
          location.field.value *= by;
        }
        break;
      case "add":
        if (location && typeof location.field.value === "number") {
          const amount = Number(
            step.parameters.amount ?? step.parameters.by ?? 0,
          );
          location.field.value += amount;
        }
        break;
      case "rename":
        if (location) {
          const toField = Number(step.parameters.toField ?? step.parameters.to);
          if (!Number.isNaN(toField)) {
            location.field.id = toField;
          }
        }
        break;
      case "split":
        if (location && typeof location.field.value === "number") {
          const targets = Array.isArray(step.parameters.targets)
            ? (step.parameters.targets as Array<Record<string, unknown>>)
            : [];
          for (const target of targets) {
            const fieldId = Number(target.fieldId);
            const factor = Number(target.factor ?? 1);
            SchemaMigrator.upsertField(seed, {
              id: fieldId,
              typeTag: location.field.typeTag,
              value: location.field.value * factor,
            });
          }
        }
        break;
      case "merge": {
        const sourceFields = Array.isArray(step.parameters.sourceFields)
          ? (step.parameters.sourceFields as unknown[]).map((value) =>
              Number(value),
            )
          : [step.field];
        const targetField = Number(step.parameters.targetField ?? step.field);
        const merged = sourceFields.reduce((sum, fieldId) => {
          const source = SchemaMigrator.findField(seed, fieldId);
          return (
            sum +
            (typeof source?.field.value === "number" ? source.field.value : 0)
          );
        }, 0);
        SchemaMigrator.upsertField(seed, {
          id: targetField,
          typeTag: FieldTypeTag.FLOAT64,
          value: merged,
        });
        break;
      }
      case "delete":
        if (location) {
          location.collection.splice(location.index, 1);
        }
        break;
    }
  }

  private static findField(
    seed: Seed,
    fieldId: number,
  ):
    | {
        collection: SeedField[];
        index: number;
        field: SeedField;
      }
    | undefined {
    for (const collection of [seed.coreFields, seed.textureFields]) {
      const index = collection.findIndex((field) => field.id === fieldId);
      if (index >= 0) {
        return { collection, index, field: collection[index] };
      }
    }
    return undefined;
  }

  private static upsertField(seed: Seed, field: SeedField): void {
    const existing = SchemaMigrator.findField(seed, field.id);
    if (existing) {
      existing.collection[existing.index] = {
        ...field,
        value: deepCopyFieldValue(field.value),
      };
      return;
    }

    const tier =
      getFieldTier(field.id, seed.header.version) === "unknown"
        ? getFieldTier(field.id, SEED_VERSION_V2)
        : getFieldTier(field.id, seed.header.version);
    if (tier === "texture") {
      seed.textureFields.push({
        ...field,
        value: deepCopyFieldValue(field.value),
      });
    } else {
      seed.coreFields.push({
        ...field,
        value: deepCopyFieldValue(field.value),
      });
    }
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DomainRuntime — รัน Seed ใน Domain เพื่อผลิต Artifact
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class DomainRuntime {
  /**
   * ═══════════════════════════════════════════════════════════════════════
   * execute — รัน Seed ใน Domain
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Pipeline:
   *
   * ┌──────────────┐
   * │ 1. VALIDATE  │  ตรวจ header, CRC, domain ID, version
   * └──────┬───────┘
   *        │ pass
   *        ▼
   * ┌──────────────┐
   * │ 2. PARSE     │  แกะ core, texture, bond fields จากไบนารี
   * └──────┬───────┘
   *        │ success
   *        ▼
   * ┌──────────────┐
   * │ 3. RESOLVE   │  ผสาน seed fields + knowledge defaults
   * │              │  Apply bond constraints
   * └──────┬───────┘
   *        │ resolved
   *        ▼
   * ┌──────────────┐
   * │ 4. GENERATE  │  รัน generator ด้วย resolved parameters
   * │              │  Apply entropy budget
   * └──────┬───────┘
   *        │ raw artifact
   *        ▼
   * ┌──────────────┐
   * │ 5. CONSTRAIN │  ตรวจ constraints (reject/clamp/nearest)
   * └──────┬───────┘
   *        │ valid artifact
   *        ▼
   * ┌──────────────┐
   * │ 6. OUTPUT    │  แพ็ก artifact + metadata
   * └──────────────┘
   */
  static execute(
    seed: Seed,
    domain: DomainManifest,
    executionSeed: number,
  ): { artifact: unknown; metadata: ArtifactMetadata } | { error: string } {
    const normalizedDomain = normalizeManifest(domain);

    let effectiveSeed = normalizeSeed(seed);
    let migrationAuditTrail: MigrationAuditRecord[] = [];
    try {
      const migration = SchemaMigrator.migrateToDomain(
        effectiveSeed,
        normalizedDomain,
      );
      effectiveSeed = migration.seed;
      migrationAuditTrail = migration.auditTrail;
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? `Migration failed: ${error.message}`
            : "Migration failed",
      };
    }

    const compat = TrustService.verifyDomainCompatibility(
      effectiveSeed,
      normalizedDomain,
    );
    if (!compat.valid) {
      return { error: `Validation failed: ${compat.issues.join("; ")}` };
    }

    const resolved = DomainRuntime.resolveParameters(
      effectiveSeed,
      normalizedDomain,
      migrationAuditTrail,
    );

    let rawArtifact: unknown;
    try {
      rawArtifact = DomainRuntime.generate(
        resolved,
        normalizedDomain,
        effectiveSeed.header.entropyBudget,
        executionSeed,
      );
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? `Generation failed: ${error.message}`
            : "Generation failed",
      };
    }

    const { artifact, violations } = DomainRuntime.applyConstraints(
      rawArtifact,
      normalizedDomain,
    );

    const metadata: ArtifactMetadata = {
      seedHash: effectiveSeed.contentHash,
      domainId: normalizedDomain.id,
      domainVersion: normalizedDomain.version,
      generation: effectiveSeed.header.generation,
      entropyBudget: effectiveSeed.header.entropyBudget,
      executionSeed,
      executionTimestamp: new Date().toISOString(),
      constraintViolations: violations,
      bondApplications: resolved.metadata.bondApplications,
      migrationAuditTrail,
      resolvedKnowledge: resolved.metadata.knowledge,
    };

    return { artifact, metadata };
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * RESOLVE — ผสานค่าจาก Seed + Knowledge Defaults + Bonds
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ลำดับสำคัญมาก! (ยิ่งหลังยิ่งชนะ)
   *
   * 1. เริ่มจาก Knowledge Defaults (Domain รู้อะไรอยู่แล้ว)
   * 2. Core fields เขียนทับ (จำเป็นต้องมี)
   * 3. Texture fields เขียนทับ (ตั้งค่าเฉพาะ)
   * 4. Bonds ปรับค่าให้สอดคล้อง
   *
   * ทำไมต้องทำแบบนี้?
   * → เพราะ seed ที่ไม่มี texture fields เลย ยังคงผลิตอะไรได้
   *    Domain จะเติม defaults ให้ จาก knowledge base
   * → ยิ่ง seed มี texture fields เยอะ = ยิ่ง override defaults เยอะ
   *    = ยิ่ง "ประณีต" = ยิ่งมี "ฝีมือช่าง"
   */
  static resolveParameters(
    seed: Seed,
    domain: DomainManifest,
    migrationAuditTrail: MigrationAuditRecord[] = [],
  ): ResolvedSeedState {
    const resolved: ResolvedSeedState = {
      byFieldId: new Map<number, FieldValue>(),
      byName: {},
      metadata: {
        knowledge: KnowledgeResolver.resolve(domain.knowledge),
        migrationAuditTrail: [...migrationAuditTrail],
        bondApplications: [],
      },
    };

    for (const fieldDef of [...domain.coreFields, ...domain.textureFields]) {
      if (fieldDef.default !== undefined) {
        resolved.byFieldId.set(
          fieldDef.id,
          deepCopyFieldValue(fieldDef.default),
        );
      }
    }

    for (const field of [...seed.coreFields, ...seed.textureFields]) {
      resolved.byFieldId.set(field.id, deepCopyFieldValue(field.value));
    }

    DomainRuntime.materializeState(resolved, domain);
    DomainRuntime.applyBonds(seed.bondFields, resolved, domain);
    DomainRuntime.materializeState(resolved, domain);

    return resolved;
  }

  /**
   * ✅ แก้แล้ว: Bond Application แบบ Declarative
   *
   * ปัญหาเดิม: Apply bonds แบบ imperative (เปลี่ยนค่าทีละ bond)
   * → ลำดับมีผลต่อผลลัพธ์ → ไม่ deterministic!
   *
   * แก้: คำนวณ adjustments ทั้งหมดก่อน แล้ว apply พร้อมกัน
   * และบังคับ deterministic ordering (sort by bond ID)
   *
   * แยกประเภท:
   * - Multiplicative adjustments (INHIBIT, AMPLIFY) → คูณรวม
   * - Additive adjustments (CORRELATE) → บวกรวม
   * - Hard constraints (CONSTRAIN) → apply ทีหลังสุด
   */
  static applyBonds(
    bonds: BondField[],
    state: ResolvedSeedState,
    domain: DomainManifest,
  ): void {
    const sortedBonds = bonds
      .map((bond) => normalizeBondField(bond))
      .sort((a, b) => a.id - b.id);

    for (const bond of sortedBonds) {
      const targetFieldId = bond.target?.fieldId ?? bond.targetFieldId;
      if (targetFieldId === undefined) continue;

      const numericSources = (bond.sources ?? [])
        .map((source) => ({
          source,
          value: fieldValueToNumber(state.byFieldId.get(source.fieldId)),
        }))
        .filter(
          (entry): entry is { source: BondSourceRef; value: number } =>
            entry.value !== undefined,
        );

      const weightedSum = numericSources.reduce(
        (sum, entry) => sum + entry.value * entry.source.weight,
        0,
      );
      const targetValue = fieldValueToNumber(
        state.byFieldId.get(targetFieldId),
      );
      if (
        targetValue === undefined &&
        bond.parameters.type !== RelationshipType.THRESHOLD_GATE &&
        bond.parameters.type !== RelationshipType.WEIGHTED_SUM
      ) {
        continue;
      }

      let nextValue = targetValue ?? 0;
      switch (bond.parameters.type) {
        case RelationshipType.CORRELATE: {
          const sourceVal = numericSources[0]?.value;
          if (sourceVal === undefined) continue;
          const influence = bond.parameters.influence ?? 0.3;
          const targetMean = bond.parameters.rho * sourceVal;
          nextValue = nextValue + (targetMean - nextValue) * influence;
          break;
        }
        case RelationshipType.INHIBIT:
          nextValue = nextValue * (1.0 - bond.parameters.strength);
          break;
        case RelationshipType.AMPLIFY:
          nextValue = nextValue * bond.parameters.factor;
          break;
        case RelationshipType.CONSTRAIN:
          if (weightedSum > 0) {
            nextValue = Math.max(
              bond.parameters.min,
              Math.min(bond.parameters.max, nextValue),
            );
          } else {
            continue;
          }
          break;
        case RelationshipType.SEQUENCE:
          continue;
        case RelationshipType.WEIGHTED_SUM: {
          nextValue = weightedSum + (bond.parameters.bias ?? 0);
          if (bond.parameters.clamp) {
            nextValue = Math.max(
              bond.parameters.clamp[0],
              Math.min(bond.parameters.clamp[1], nextValue),
            );
          }
          break;
        }
        case RelationshipType.THRESHOLD_GATE:
          nextValue =
            weightedSum > bond.parameters.threshold
              ? (bond.parameters.activeValue ?? nextValue)
              : (bond.parameters.inactiveValue ?? 0);
          break;
        case RelationshipType.CONDITIONAL_BLEND: {
          const allPassed = bond.parameters.conditions.every((condition) =>
            DomainRuntime.evaluateBondCondition(condition, state),
          );
          if (!allPassed) {
            if (bond.parameters.fallbackValue !== undefined) {
              nextValue = bond.parameters.fallbackValue;
            } else {
              continue;
            }
          } else {
            const blendFactor = bond.parameters.blendFactor ?? 0.3;
            nextValue = nextValue + weightedSum * blendFactor;
            if (bond.parameters.targetMin !== undefined) {
              nextValue = Math.max(bond.parameters.targetMin, nextValue);
            }
            if (bond.parameters.targetMax !== undefined) {
              nextValue = Math.min(bond.parameters.targetMax, nextValue);
            }
          }
          break;
        }
      }

      state.byFieldId.set(targetFieldId, nextValue);
      state.metadata.bondApplications.push({
        bondId: bond.id,
        sourceField: bond.sources?.[0]?.fieldId ?? bond.sourceFieldId ?? 0,
        targetField: targetFieldId,
        adjustment: nextValue - (targetValue ?? 0),
      });
      DomainRuntime.materializeState(state, domain);
    }
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * GENERATE — รัน generator ของ Domain
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ส่วนนี้เป็น abstraction — Domain แต่ละประเภทจะ implement เอง
   * เช่น MIDI domain ใช้ music generator, image domain ใช้ image generator
   *
   * สิ่งที่ต้องทำ:
   * 1. สร้าง PRNG จาก executionSeed
   * 2. ที่ทุก decision point:
   *    a. คำนวณ deterministic choice จาก resolved parameters
   *    b. ถ้า entropyBudget > 0 → ผสม randomness
   *    c. คืนค่า decision
   */
  static generate(
    resolvedState: ResolvedSeedState,
    domain: DomainManifest,
    entropyBudget: number,
    executionSeed: number,
  ): unknown {
    const prng = DomainRuntime.createPRNG(executionSeed);
    const influence = entropyBudget / 255;
    const artifact = structuredClone(resolvedState.byName);

    for (const fieldDef of [...domain.coreFields, ...domain.textureFields]) {
      const current = (artifact as Record<string, unknown>)[fieldDef.name];
      if (typeof current === "number") {
        const decisionBounds = getFieldDecisionBounds(fieldDef);
        if (!decisionBounds) {
          if (influence > 0 && isNumericTypeTag(fieldDef.typeTag)) {
            throw new Error(
              `Numeric field ${fieldDef.name} requires range or decisionRange for entropy generation`,
            );
          }
          continue;
        }
        const noise =
          (prng() - 0.5) *
          (decisionBounds[1] - decisionBounds[0]) *
          0.05 *
          influence;
        (artifact as Record<string, unknown>)[fieldDef.name] = Math.max(
          decisionBounds[0],
          Math.min(decisionBounds[1], current + noise),
        );
      }
    }

    (artifact as Record<string, unknown>).execution_seed = executionSeed;
    return artifact;
  }

  /**
   * สร้าง PRNG (Pseudo-Random Number Generator) แบบง่าย
   *
   * ใช้ Mulberry32 algorithm — เร็ว, deterministic, มีคุณภาพพอสำหรับการใช้งาน
   *
   * คุณสมบัติสำคัญ: seed เดียวกัน → ลำดับสุ่มเดียวกันเสมอ
   * ทำให้ artifact reproducible (สำคัญมากสำหรับ trust!)
   */
  static createPRNG(seed: number): () => number {
    let state = seed | 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Apply Constraints — ตรวจสอบและบังคับกฎ
   *
   * ถ้า artifact ผิดกฎ:
   * - REJECT → ไม่เอาเลย (error artifact)
   * - CLAMP → แก้ให้อยู่ในขอบเขต
   * - NEAREST → หาผลงานที่ใกล้ที่สุดที่ผ่าน
   */
  static applyConstraints(
    artifact: unknown,
    domain: DomainManifest,
  ): {
    artifact: unknown;
    violations: ArtifactMetadata["constraintViolations"];
  } {
    const violations: ArtifactMetadata["constraintViolations"] = [];

    for (const constraint of domain.constraints) {
      const evaluation = DeclarativeConstraintEngine.evaluateConstraint(
        constraint,
        artifact,
      );
      if (!evaluation.passed) {
        violations.push({
          constraintId: constraint.id,
          enforcementMode: constraint.enforcement,
          wasApplied: constraint.enforcement !== EnforcementMode.REJECT,
        });

        if (constraint.enforcement === EnforcementMode.REJECT) {
          return {
            artifact: { error: `Constraint violated: ${constraint.id}` },
            violations,
          };
        }

        // CLAMP และ NEAREST จะถูก implement โดย Domain เอง
        // (เพราะแต่ละ Domain รู้ดีที่สุดว่าจะแก้ยังไง)
      }
    }

    return { artifact, violations };
  }

  private static materializeState(
    state: ResolvedSeedState,
    domain: DomainManifest,
  ): void {
    const byName: Record<string, unknown> = {};
    const definitions = new Map<number, DomainFieldDefinition>();
    for (const field of [...domain.coreFields, ...domain.textureFields]) {
      definitions.set(field.id, field);
    }

    for (const [fieldId, value] of state.byFieldId.entries()) {
      const definition = definitions.get(fieldId);
      const materialized = DomainRuntime.materializeFieldValue(
        value,
        definition,
        domain,
      );
      const key = definition?.name ?? `field_${fieldId}`;
      byName[key] = materialized;
      byName[`0x${fieldId.toString(16).padStart(6, "0")}`] = materialized;
    }

    state.byName = byName;
  }

  private static materializeFieldValue(
    value: FieldValue,
    definition: DomainFieldDefinition | undefined,
    domain: DomainManifest,
  ): unknown {
    if (value instanceof Uint8Array) {
      return Array.from(value);
    }
    if (isArrayFieldValue(value)) {
      const elementDefinition =
        definition?.elementTypeTag !== undefined
          ? { ...definition, typeTag: definition.elementTypeTag }
          : undefined;
      return value.items.map((item) =>
        DomainRuntime.materializeAnonymousValue(
          item,
          elementDefinition,
          domain,
        ),
      );
    }
    if (isCompositeFieldValue(value)) {
      const schema =
        (definition?.compositeSchema &&
          domain.compositeSchemas?.[definition.compositeSchema]) ||
        Object.values(domain.compositeSchemas ?? {}).find(
          (candidate) => candidate.id === value.schemaId,
        );
      const fieldsById = new Map(
        schema?.fields.map((field) => [field.id, field]) ?? [],
      );
      const composite: Record<string, unknown> = {};
      for (const field of value.fields) {
        const nestedDefinition = fieldsById.get(field.id);
        const nestedValue = DomainRuntime.materializeFieldValue(
          field.value,
          nestedDefinition,
          domain,
        );
        composite[nestedDefinition?.name ?? `field_${field.id}`] = nestedValue;
        composite[`0x${field.id.toString(16).padStart(6, "0")}`] = nestedValue;
      }
      return composite;
    }
    return value;
  }

  private static materializeAnonymousValue(
    value: FieldValue,
    definition: DomainFieldDefinition | undefined,
    domain: DomainManifest,
  ): unknown {
    return DomainRuntime.materializeFieldValue(value, definition, domain);
  }

  private static evaluateBondCondition(
    condition: FieldCondition,
    state: ResolvedSeedState,
  ): boolean {
    if (typeof condition.field === "number") {
      const value = fieldValueToComparable(
        state.byFieldId.get(condition.field),
      );
      return compareComparableValues(value, condition.op, condition.value);
    }

    const value = fieldValueToComparable(
      readPath(state.byName, condition.field),
    );
    return compareComparableValues(value, condition.op, condition.value);
  }
}

// #############################################################################
// #############################################################################
//
//   PART 12: ตัวอย่าง Domain จริง — Simple MIDI Music Composition
//   ──────────────────────────────────────────────────────────────────
//
//   ส่วนนี้แสดงตัวอย่าง Domain ที่สมบูรณ์
//   เพื่อให้เห็นภาพว่าทุกอย่างเชื่อมกันอย่างไร
//
//   Domain นี้: สร้างดนตรี MIDI
//   - รับ Seed → แปล → สร้างเพลงออกมา
//   - มี knowledge: chord progressions, voice-leading, rhythmic patterns
//   - มี constraints: โน้ตห้ามกว้างเกินมือคน
//   - มี bonds: เทมโปเร็ว = โน้ตหนาแน่น
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MIDI_DOMAIN — Domain Manifest สำหรับ MIDI Music
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const MIDI_DOMAIN: DomainManifest = {
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  name: "Simple MIDI Composition",
  version: "1.0.0",
  description:
    "สร้างดนตรี MIDI จาก Seed — สามารถกำหนด tempo, key, mode, density ฯลฯ",

  determinism: "nondeterministic",
  entropyBudgetDefault: 128,

  // ─── Core Fields ─────────────────────────────────────────────────
  //
  // Core = แกนของเพลง — เปลี่ยนแล้วเพลงเปลี่ยนมาก
  // เหมือนเปลี่ยน genre ของเพลง
  //
  coreFields: [
    {
      id: 1,
      name: "tempo",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [40, 240],
      default: 120,
      semantics: "ความเร็วจังหวะ (BPM) — 60=ช้า, 120=ปกติ, 200=เร็วมาก",
    },
    {
      id: 2,
      name: "key_center",
      typeTag: FieldTypeTag.UINT8,
      required: true,
      range: [0, 11],
      default: 0,
      semantics: "ตัวโน้ตหลัก (0=C, 1=C#, 2=D, ..., 11=B)",
    },
    {
      id: 3,
      name: "mode",
      typeTag: FieldTypeTag.UINT8,
      required: true,
      range: [0, 6],
      default: 0,
      semantics:
        "สเกล (0=Major, 1=Minor, 2=Dorian, 3=Phrygian, 4=Lydian, 5=Mixolydian, 6=Locrian)",
    },
    {
      id: 4,
      name: "density",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [0, 1],
      default: 0.5,
      semantics: "ความหนาแน่นของโน้ต (0=เบาบาง, 1=แน่นมาก)",
    },
    {
      id: 5,
      name: "register_bias",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [-1, 1],
      default: 0,
      semantics: "ระดับเสียงสูง-ต่ำ (-1=ต่ำมาก, 0=กลาง, 1=สูงมาก)",
    },
    {
      id: 6,
      name: "articulation_weight",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [0, 1],
      default: 0.5,
      semantics: "ลักษณะการเล่น (0=legato=ต่อเนื่อง, 1=staccato=สั้นๆ)",
    },
    {
      id: 7,
      name: "harmonic_complexity",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [0, 1],
      default: 0.3,
      semantics: "ความซับซ้อนของคอร์ด (0=triads ธรรมดา, 1=extended/altered)",
    },
    {
      id: 8,
      name: "rhythmic_complexity",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [0, 1],
      default: 0.3,
      semantics:
        "ความซับซ้อนของจังหวะ (0=ตัวโน้ตเท่าๆ กัน, 1=syncopated/polyrhythmic)",
    },
  ],

  // ─── Texture Fields ──────────────────────────────────────────────
  //
  // Texture = รายละเอียด — เพิ่มได้เรื่อยๆ ยิ่งเยอะยิ่งประณีต
  // เหมือนเพิ่มเครื่องเทศในอาหาร — อาหารยังอยู่ แต่รสชาติซับซ้อนขึ้น
  //
  textureFields: [
    {
      id: 1001,
      name: "phrase_length_bias",
      typeTag: FieldTypeTag.FLOAT32,
      default: 4,
      range: [1, 16],
      growthWeight: 1.0,
      semantics: "ความยาว phrase ที่ชอบ (หน่วย: บาร์)",
    },
    {
      id: 1002,
      name: "repeat_tendency",
      typeTag: FieldTypeTag.FLOAT32,
      default: 0.3,
      range: [0, 1],
      growthWeight: 0.8,
      semantics: "โอกาสที่จะใช้ motif เดิมซ้ำ",
    },
    {
      id: 1003,
      name: "modulation_frequency",
      typeTag: FieldTypeTag.FLOAT32,
      default: 0.1,
      range: [0, 1],
      growthWeight: 0.5,
      semantics: "ความถี่ในการเปลี่ยนคีย์",
    },
    {
      id: 1004,
      name: "cadence_style",
      typeTag: FieldTypeTag.UINT8,
      default: 0,
      range: [0, 4],
      growthWeight: 0.7,
      semantics:
        "รูปแบบจบวรรค (0=authentic, 1=plagal, 2=deceptive, 3=half, 4=phaeacian)",
    },
    {
      id: 1005,
      name: "dynamics_range",
      typeTag: FieldTypeTag.FLOAT32,
      default: 0.5,
      range: [0.1, 1],
      growthWeight: 0.9,
      semantics: "ช่วง dynamic (0.1=แคบ pp-mp, 1.0=กว้าง ppp-fff)",
    },
    {
      id: 1006,
      name: "velocity_curve_shape",
      typeTag: FieldTypeTag.FLOAT32,
      default: 0,
      range: [-1, 1],
      growthWeight: 0.6,
      semantics: "รูปร่างเสียง (-1=decrescendo, 0=สมดุล, 1=crescendo)",
    },
    {
      id: 1007,
      name: "rest_frequency",
      typeTag: FieldTypeTag.FLOAT32,
      default: 0.2,
      range: [0, 0.8],
      growthWeight: 0.4,
      semantics: "สัดส่วนของจังหวะว่าง",
    },
    {
      id: 1008,
      name: "chord_voicing_style",
      typeTag: FieldTypeTag.UINT8,
      default: 0,
      range: [0, 5],
      growthWeight: 0.5,
      semantics:
        "รูปแบบการจัดเสียงคอร์ด (0=close, 1=drop2, 2=spread, 3=shearing, 4=piano, 5=orchestral)",
    },
  ],

  // ─── Bond Fields ─────────────────────────────────────────────────
  //
  // Bond = กฎความสอดคล้อง — ประสานให้ fields ไม่ขัดแย้ง
  //
  // ตัวอย่างปัญหาที่ bond แก้:
  //   เทมโปเร็ว + โน้ตยาว = เล่นไม่ไหว (มือคนไม่พอ)
  //   Bond: "ถ้า tempo > 160 → sustain ต้องสั้นลง"
  //
  bondFields: [
    {
      id: 2001,
      name: "tempo-density-correlation",
      sourceField: 1,
      targetField: 4,
      relationshipTypes: [RelationshipType.CORRELATE],
      defaultParameters: { type: RelationshipType.CORRELATE, rho: 0.6 },
      semantics: "เทมโปเร็ว → โน้ตหนาแน่นขึ้นตาม",
    },
    {
      id: 2002,
      name: "tempo-articulation-correlation",
      sourceField: 1,
      targetField: 6,
      relationshipTypes: [RelationshipType.CORRELATE],
      defaultParameters: { type: RelationshipType.CORRELATE, rho: -0.4 },
      semantics: "เทมโปเร็ว → โน้ตสั้นลง (staccato)",
    },
    {
      id: 2003,
      name: "register-density-inhibit",
      sourceField: 5,
      targetField: 4,
      relationshipTypes: [RelationshipType.INHIBIT],
      defaultParameters: { type: RelationshipType.INHIBIT, strength: 0.3 },
      semantics: "ระดับเสียงสูง/ต่ำมาก → โน้ตลดลง (เล่นยาก)",
    },
    {
      id: 2004,
      name: "harmonic-rhythmic-correlation",
      sourceField: 7,
      targetField: 8,
      relationshipTypes: [RelationshipType.CORRELATE],
      defaultParameters: { type: RelationshipType.CORRELATE, rho: 0.5 },
      semantics: "คอร์ดซับซ้อน → จังหวะซับซ้อนตาม",
    },
    {
      id: 2005,
      name: "tempo-phrase-constrain",
      sourceField: 1,
      targetField: 1001,
      relationshipTypes: [RelationshipType.CONSTRAIN],
      defaultParameters: { type: RelationshipType.CONSTRAIN, min: 1, max: 16 },
      semantics: "ความยาว phrase ปรับตามขอบเขต tempo",
    },
  ],

  // ─── Constraints ─────────────────────────────────────────────────
  //
  // Constraints = กฎที่ผลงานต้องเป็นไปตาม (ต่างจาก bond ที่อยู่ใน seed)
  // เช่น โน้ตห้ามกว้างเกินมือคน — นี่คือกฎของโลกจริง ไม่ใช่กฎของ seed
  //
  constraints: [
    {
      id: "playable_by_human_hands",
      description:
        "คอร์ดห้ามกว้างเกิน 19 semitones (octave+fifth) และไม่เกิน 10 โน้ตพร้อมกัน",
      enforcement: EnforcementMode.CLAMP,
      rules: [
        {
          field: "max_chord_span",
          operator: "<=",
          value: 19,
          message: "Chord span exceeds playable human hand range",
        },
        {
          field: "max_polyphony",
          operator: "<=",
          value: 10,
          message: "Polyphony exceeds practical human performance limits",
        },
      ],
      check: (artifact: any) => {
        // Stub — ใน production จะตรวจจริง
        return (
          (artifact?.max_chord_span ?? 0) <= 19 &&
          (artifact?.max_polyphony ?? 0) <= 10
        );
      },
    },
    {
      id: "duration_range",
      description: "ความยาวเพลงต้องอยู่ระหว่าง 30 วินาทีถึง 5 นาที",
      enforcement: EnforcementMode.REJECT,
      rules: [
        {
          field: "duration_seconds",
          operator: ">=",
          value: 30,
          message: "Duration is too short",
        },
        {
          field: "duration_seconds",
          operator: "<=",
          value: 300,
          message: "Duration is too long",
        },
      ],
      check: (artifact: any) => {
        const dur = artifact?.duration_seconds ?? 0;
        return dur >= 30 && dur <= 300;
      },
    },
  ],

  // ─── Knowledge ───────────────────────────────────────────────────
  //
  // Knowledge = สิ่งที่ Domain รู้อยู่แล้ว — Seed ไม่ต้องใส่เอง
  //
  // เหมือนนักดนตรีที่รู้พื้นฐานอยู่แล้ว:
  //   - chord progressions มาตรฐาน
  //   - voice-leading rules
  //   - rhythmic patterns ตาม genre
  //   - dynamic markings conventions
  //
  // Seed แค่บอกว่า "อยากเพลงเร็วๆ ในคีย์ C"
  // Domain จะเติมเต็มรายละเอียดเองจาก knowledge
  //
  knowledge: {
    description:
      "รู้ chord progressions ตาม mode, voice-leading rules, rhythmic patterns ตาม genre, cadence formulas, dynamic markings conventions, instrument ranges",
    defaultBehavior:
      "สร้างเพลง C Major ที่ 120 BPM ด้วยความหนาแน่นปานกลาง ใช้ chord progressions มาตรฐาน I-IV-V-I",
  },
};

export const CITY_DOMAIN_V2: DomainManifest = {
  id: "c1ty0000-0000-4000-8000-000000000001",
  name: "3D Procedural City Generator",
  version: "2.0.0",
  description:
    "สร้างผังเมือง 3D แบบ procedural โดยรองรับ district layouts, material sets, และ multi-source urban rules",
  determinism: "nondeterministic",
  entropyBudgetDefault: 96,
  coreFields: [
    {
      id: 0x000001,
      name: "grid_size",
      typeTag: FieldTypeTag.UINT16,
      required: true,
      range: [10, 1000],
      default: 128,
      semantics: "ขนาดกริดของเมือง",
    },
    {
      id: 0x000002,
      name: "terrain_seed",
      typeTag: FieldTypeTag.UINT32,
      required: true,
      default: 424242,
      decisionRange: { min: 0, max: 4294967295 },
      semantics: "seed สำหรับภูมิประเทศ",
    },
    {
      id: 0x000003,
      name: "climate_zone",
      typeTag: FieldTypeTag.UINT8,
      required: true,
      range: [0, 6],
      default: 2,
      semantics: "เขตภูมิอากาศของเมือง",
    },
    {
      id: 0x000004,
      name: "transit_bias",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [0, 1],
      default: 0.45,
      semantics: "น้ำหนักฝั่งขนส่งสาธารณะ",
    },
    {
      id: 0x000005,
      name: "max_building_height",
      typeTag: FieldTypeTag.FLOAT32,
      required: true,
      range: [20, 828],
      default: 180,
      semantics: "เพดานความสูงอาคารหลัก",
    },
  ],
  textureFields: [
    {
      id: 0x010001,
      name: "district_layout",
      typeTag: FieldTypeTag.COMPOSITE,
      compositeSchema: "city_layout_schema",
      growthWeight: 1.0,
      default: {
        kind: "composite",
        schemaId: 1,
        fields: [
          { id: 1, typeTag: FieldTypeTag.UINT16, value: 2 },
          {
            id: 2,
            typeTag: FieldTypeTag.ARRAY,
            value: {
              kind: "array",
              elementTypeTag: FieldTypeTag.COMPOSITE,
              items: [
                {
                  kind: "composite",
                  schemaId: 2,
                  fields: [
                    { id: 1, typeTag: FieldTypeTag.FLOAT32, value: 0.75 },
                    { id: 2, typeTag: FieldTypeTag.STRING, value: "modern" },
                    {
                      id: 3,
                      typeTag: FieldTypeTag.ARRAY,
                      value: {
                        kind: "array",
                        elementTypeTag: FieldTypeTag.FLOAT32,
                        items: [40, 220],
                      },
                    },
                    { id: 4, typeTag: FieldTypeTag.FLOAT32, value: 0.12 },
                  ],
                },
                {
                  kind: "composite",
                  schemaId: 2,
                  fields: [
                    { id: 1, typeTag: FieldTypeTag.FLOAT32, value: 0.35 },
                    { id: 2, typeTag: FieldTypeTag.STRING, value: "historic" },
                    {
                      id: 3,
                      typeTag: FieldTypeTag.ARRAY,
                      value: {
                        kind: "array",
                        elementTypeTag: FieldTypeTag.FLOAT32,
                        items: [12, 60],
                      },
                    },
                    { id: 4, typeTag: FieldTypeTag.FLOAT32, value: 0.24 },
                  ],
                },
              ],
            },
          },
        ],
      },
      semantics: "district configs แบบ nested",
    },
    {
      id: 0x010002,
      name: "building_materials",
      typeTag: FieldTypeTag.ARRAY,
      elementTypeTag: FieldTypeTag.UINT8,
      growthWeight: 0.8,
      default: {
        kind: "array",
        elementTypeTag: FieldTypeTag.UINT8,
        items: [1, 4, 7],
      },
      semantics: "รายการ material IDs ที่อนุญาต",
    },
    {
      id: 0x010003,
      name: "green_target",
      typeTag: FieldTypeTag.FLOAT32,
      range: [0.02, 0.6],
      growthWeight: 0.9,
      default: 0.18,
      semantics: "เป้าหมายสัดส่วนพื้นที่สีเขียว",
    },
  ],
  bondFields: [
    {
      id: 0x020001,
      name: "climate-transit-green-balance",
      sources: [
        { fieldId: 0x000003, weight: 0.4 },
        { fieldId: 0x000004, weight: 0.6 },
      ],
      targetRef: {
        fieldId: 0x010003,
        blendMode: "conditional",
      },
      relationshipTypes: [
        RelationshipType.CONDITIONAL_BLEND,
        RelationshipType.THRESHOLD_GATE,
      ],
      defaultParameters: {
        type: RelationshipType.CONDITIONAL_BLEND,
        conditions: [
          { field: "climate_zone", op: ">=", value: 3 },
          { field: "transit_bias", op: ">=", value: 0.4 },
        ],
        blendFactor: 0.08,
        targetMin: 0.08,
        targetMax: 0.45,
      },
      semantics: "เมืองร้อน + เน้นขนส่ง → เพิ่ม green target",
    },
    {
      id: 0x020002,
      name: "district-green-height-gate",
      sources: [
        { fieldId: 0x010003, weight: 0.7 },
        { fieldId: 0x000003, weight: 0.3 },
      ],
      targetRef: {
        fieldId: 0x000005,
        blendMode: "additive",
      },
      relationshipTypes: [
        RelationshipType.WEIGHTED_SUM,
        RelationshipType.THRESHOLD_GATE,
      ],
      defaultParameters: {
        type: RelationshipType.WEIGHTED_SUM,
        bias: 120,
        clamp: [60, 828],
      },
      semantics: "green target กับ climate รวมกันแล้วตั้งเพดานความสูงใหม่",
    },
  ],
  compositeSchemas: {
    city_layout_schema: {
      id: 1,
      name: "city_layout_schema",
      fields: [
        {
          id: 1,
          name: "district_count",
          typeTag: FieldTypeTag.UINT16,
          default: 0,
          semantics: "จำนวน district ที่กำหนดไว้",
        },
        {
          id: 2,
          name: "districts",
          typeTag: FieldTypeTag.ARRAY,
          elementTypeTag: FieldTypeTag.COMPOSITE,
          compositeSchema: "district_schema",
          default: {
            kind: "array",
            elementTypeTag: FieldTypeTag.COMPOSITE,
            items: [],
          },
          semantics: "รายการ district configs",
        },
      ],
    },
    district_schema: {
      id: 2,
      name: "district_schema",
      fields: [
        {
          id: 1,
          name: "density",
          typeTag: FieldTypeTag.FLOAT32,
          range: [0, 1],
          default: 0.5,
          semantics: "ความหนาแน่นของ district",
        },
        {
          id: 2,
          name: "style",
          typeTag: FieldTypeTag.STRING,
          default: "mixed-use",
          semantics: "แนวสถาปัตยกรรมหลัก",
        },
        {
          id: 3,
          name: "height_range",
          typeTag: FieldTypeTag.ARRAY,
          elementTypeTag: FieldTypeTag.FLOAT32,
          default: {
            kind: "array",
            elementTypeTag: FieldTypeTag.FLOAT32,
            items: [10, 120],
          },
          semantics: "ช่วงความสูง [min, max]",
        },
        {
          id: 4,
          name: "green_ratio",
          typeTag: FieldTypeTag.FLOAT32,
          range: [0, 0.5],
          default: 0.15,
          semantics: "สัดส่วนพื้นที่สีเขียวของ district",
        },
      ],
    },
  },
  constraints: [
    {
      id: "city_height_cap",
      description: "ไม่ให้ตึกสูงเกินค่าที่โลกจริงยอมรับ",
      enforcement: EnforcementMode.REJECT,
      rules: [
        {
          field: "max_building_height",
          operator: "<=",
          value: 828,
          message: "Cannot exceed Burj Khalifa height",
        },
      ],
    },
    {
      id: "green_floor",
      description: "แต่ละเมืองควรมีพื้นที่สีเขียวขั้นต่ำ",
      enforcement: EnforcementMode.CLAMP,
      rules: [
        {
          field: "green_target",
          operator: ">=",
          value: 0.05,
          message: "Minimum green target required",
        },
        {
          field: "district_layout.districts[0].green_ratio",
          operator: ">=",
          value: 0.05,
          message: "Primary district must keep some green ratio",
        },
      ],
    },
  ],
  knowledge: {
    description:
      "รู้ building codes, urban design patterns, material atlases, climate heuristics",
    defaultBehavior:
      "สร้างเมือง mixed-use ที่มีแกน transit, เขต dense หนึ่งเขต และเขตประวัติศาสตร์หนึ่งเขต",
    references: [
      {
        type: "building_code_library",
        uuid: "knowledge-building-code-2024",
        version: "2024.1.0",
        required: true,
      },
      {
        type: "material_atlas",
        uuid: "knowledge-material-atlas-2",
        version: "2.0.0",
        required: true,
      },
      {
        type: "climate_data",
        uuid: "knowledge-climate-data-1",
        version: "1.5.0",
        required: false,
        fallback: "knowledge-climate-data-lite",
      },
    ],
  },
  migrations: {
    "1.0.0 -> 2.0.0": [
      {
        field: 1005,
        operation: "rename",
        parameters: { toField: 0x010003 },
        reason: "green target moved into v2 texture range",
      },
      {
        field: 5,
        operation: "multiply",
        parameters: { by: 1.0 },
        reason:
          "legacy height cap already compatible but kept explicit for auditability",
      },
    ],
  },
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ตัวอย่าง: การสร้าง Seed และรันใน MIDI Domain
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เดินตามทีละขั้นตอน:
 * 1. สร้าง genesis seed (random)
 * 2. รันใน Domain → ดูผลงาน
 * 3. Tune ด้วย Medium radius → ได้ batch ของลูก
 * 4. ดูผลงานของทุกลูก → เลือกตัวที่ดี
 * 5. บันทึก lineage
 * 6. เอาตัวที่เลือกเป็น base รอบใหม่
 */
export function exampleWorkflow(): void {
  console.log("=== cultivar-js System: ตัวอย่างการทำงาน ===\n");

  // ─── ขั้นที่ 1: สร้าง Genesis Seed ──────────────────────────────
  // Genesis = seed ที่สร้างจากศูนย์ (random values)
  const genesisSeed: Seed = {
    header: {
      magic: SEED_MAGIC,
      version: SEED_VERSION_V1,
      domainId: MIDI_DOMAIN.id,
      generation: 0,
      entropyBudget: 128,
      coreSize: 0,
      textureSize: 0,
      bondSize: 0,
      flags: 0,
      crc32: 0,
      domainSchemaVersion: MIDI_DOMAIN.version,
    },
    coreFields: [
      { id: 1, typeTag: FieldTypeTag.FLOAT32, value: 120 }, // tempo = 120 BPM
      { id: 2, typeTag: FieldTypeTag.UINT8, value: 0 }, // key = C
      { id: 3, typeTag: FieldTypeTag.UINT8, value: 0 }, // mode = Major
      { id: 4, typeTag: FieldTypeTag.FLOAT32, value: 0.5 }, // density = ปานกลาง
      { id: 5, typeTag: FieldTypeTag.FLOAT32, value: 0.0 }, // register = กลาง
      { id: 6, typeTag: FieldTypeTag.FLOAT32, value: 0.5 }, // articulation = ปานกลาง
      { id: 7, typeTag: FieldTypeTag.FLOAT32, value: 0.3 }, // harmonic = ง่าย
      { id: 8, typeTag: FieldTypeTag.FLOAT32, value: 0.3 }, // rhythmic = ง่าย
    ],
    textureFields: [], // ยังไม่มีรายละเอียด — Domain จะใช้ defaults
    bondFields: [], // ยังไม่มี bond — fields ทำงานอิสระ
    contentHash: "genesis-placeholder-hash",
  };

  console.log("Genesis Seed:");
  console.log(`  Tempo: ${genesisSeed.coreFields[0].value} BPM`);
  console.log(`  Key: C Major`);
  console.log(`  Texture fields: ${genesisSeed.textureFields.length} (none)`);
  console.log(`  Bond fields: ${genesisSeed.bondFields.length} (none)`);
  console.log(`  → ผล: เพลง C Major ธรรมดา ไม่มีอะไรพิเศษ\n`);

  // ─── ขั้นที่ 2: รันใน Domain ────────────────────────────────────
  const result = DomainRuntime.execute(genesisSeed, MIDI_DOMAIN, 42);
  console.log(
    "รัน Genesis Seed:",
    "error" in result ? result.error : "สำเร็จ!\n",
  );

  // ─── ขั้นที่ 3: Tune ด้วย Medium radius ──────────────────────────
  const batch = SeedMutator.generateTuningBatch(
    genesisSeed,
    RADIUS_PRESETS.medium,
    5, // 5 ลูก
    MIDI_DOMAIN,
  );

  console.log(`สร้าง batch ของลูก: ${batch.length} ตัว`);
  for (let i = 0; i < batch.length; i++) {
    const child = batch[i];
    const tempo = child.coreFields.find((f) => f.id === 1)?.value ?? "?";
    console.log(
      `  ลูก ${i + 1}: tempo=${tempo}, texture=${child.textureFields.length} fields, bond=${child.bondFields.length} fields`,
    );
  }
  console.log();

  // ─── ขั้นที่ 4-5: เลือก + บันทึก Lineage ────────────────────────
  const selectedChild = batch[0]; // สมมุติเลือกตัวแรก

  const lineageService = new LineageService();
  lineageService.append({
    seedHash: selectedChild.contentHash,
    origin: {
      type: "mutation",
      parents: [
        { seedHash: genesisSeed.contentHash, contribution: "all fields" },
      ],
      mutationOperator: "compound",
      mutationParameters: RADIUS_PRESETS.medium,
      generationRound: 1,
    },
    curation: {
      curatorId: "alice",
      curatorAction: CurationAction.SELECT,
      tags: ["energetic", "better-rhythm"],
      note: "จังหวะดีกว่าตัวเดิม",
      batchSize: batch.length,
      batchRank: 1,
      timestamp: new Date().toISOString(),
    },
    execution: {
      domainId: MIDI_DOMAIN.id,
      domainVersion: MIDI_DOMAIN.version,
      executionSeed: 42,
      executionTimestamp: new Date().toISOString(),
    },
  });

  console.log("บันทึก lineage สำเร็จ");
  console.log(
    `  Effective depth: ${lineageService.computeEffectiveDepth(selectedChild.contentHash)}`,
  );
  console.log(
    `  Story: ${lineageService.getStoryView(selectedChild.contentHash)}\n`,
  );

  // ─── ขั้นที่ 6: Tune ต่อด้วย Fine radius ────────────────────────
  // หลังจากเลือกตัวที่ดีแล้ว → ใช้ Fine radius เพื่อขัดเกลาเพิ่ม
  const refinedBatch = SeedMutator.generateTuningBatch(
    selectedChild,
    RADIUS_PRESETS.fine,
    3,
    MIDI_DOMAIN,
  );

  console.log(`Tune ต่อด้วย Fine radius: ${refinedBatch.length} ตัว`);
  for (let i = 0; i < refinedBatch.length; i++) {
    const child = refinedBatch[i];
    console.log(
      `  ลูก ${i + 1}: texture=${child.textureFields.length} fields (เพิ่มรายละเอียด)`,
    );
  }
  console.log();

  // ─── ห่อ Seed เป็นสตริง ─────────────────────────────────────────
  const wrapped = SeedWrapper.wrap(selectedChild);
  console.log(
    `Seed ที่ห่อแล้ว (ตัวอย่าง 20 ตัวแรก): ${wrapped.slice(0, 30)}...`,
  );
}

// เรียกตัวอย่าง (เอา comment ออกเพื่อรัน)
// exampleWorkflow();

// #############################################################################
// #############################################################################
//
//   PART 13: ข้อเสนอแนะจากการวิเคราะห์
//   ──────────────────────────────────
//
//   ส่วนนี้สรุปปัญหาที่พบระหว่างการวิเคราะห์ design
//   พร้อมข้อเสนอแนะแก้ไข — เรียงตามความสำคัญ
//
// #############################################################################
// #############################################################################

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  ตารางสรุปปัญหา-ข้อเสนอแนะ                                            ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║                                                                         ║
 * ║  #  | ปัญหา                              | ระดับ     | Priority        ║
 * ║  ---|------------------------------------|-----------|-----------------║
 * ║  1  | CRC32 ไม่ครอบคลุม Header           | Binary    | P0 (แก่ที่สุด) ║
 * ║  2  | Bond Parameters ไม่มี length prefix | Binary    | P0              ║
 * ║  3  | Multiplicative mutation ใช้ไม่ได้   | Algorithm | P0              ║
 * ║     | กับ signed/zero fields             |           |                 ║
 * ║  4  | Crossover zip by position          | Algorithm | P0              ║
 * ║     | ≠ by field ID                      |           |                 ║
 * ║  5  | Bond application ordering          | Algorithm | P0              ║
 * ║     | มีผลต่อผลลัพธ์                      |           |                 ║
 * ║  6  | CORRELATE lerp 0.3 = magic number  | Algorithm | P1              ║
 * ║  7  | ไม่มี array/repeated type           | Type Sys  | P1              ║
 * ║  8  | Field ID range อาจไม่พอ            | Type Sys  | P1              ║
 * ║  9  | ขาด error recovery strategy        | Architect | P1              ║
 * ║  10 | ไม่มี stagnation detection          | Architect | P1              ║
 * ║  11 | Human-in-the-loop bottleneck       | Architect | P2              ║
 * ║  12 | Centralized lineage store เสี่ยง    | Architect | P2              ║
 * ║  13 | Domain check function ไม่           | Spec      | P2              ║
 * ║     | serializable                       |           |                 ║
 * ║  14 | decision_range ไม่ถูกกำหนด         | Spec      | P1              ║
 * ║                                                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ✅ = แก้แล้วในโค้ดนี้
 * ❌ = ยังไม่ได้แก้ (ต้องแก้ใน spec หรือ binary format)
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #1: CRC32 ไม่ครอบคลุม Header ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * สถานะปัจจุบัน: CRC32 ครอบ "everything after the header"
 * แต่ SHA-256 ครอบ "everything from header byte 0 to last byte before footer"
 *
 * ปัญหา: ถ้า bit flip เกิดใน header (เช่น magic/version/domain_id)
 * → CRC32 ตรวจไม่พบ (เพราะไม่ครอบ header)
 * → SHA-256 ตรวจพบ แต่ต้อง parse ถึง footer ก่อน
 * → Pipeline อาจ reject ผิดเหตุผล ("wrong domain" ทั้งที่จริงเป็น "corrupt data")
 *
 * ข้อเสนอแนะ: เปลี่ยน CRC32 ให้ครอบ Header ด้วย
 *   วิธี: ใส่ CRC = 0 ช่อง → คำนวณ CRC ทั้งก้อน → เขียนทับช่อง CRC
 *
 *   // ตัวอย่าง:
 *   header.crc32 = 0;
 *   const allBytes = serialize(seed);
 *   const computedCRC = crc32(allBytes);
 *   header.crc32 = computedCRC;
 *   // re-serialize หรือ write ทับตำแหน่ง offset 44
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #2: Bond Parameters ไม่มี length prefix ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ปัญหา: Bond field structure คือ:
 *   [Field ID (2B)] [Source (2B)] [Target (2B)] [Type (1B)] [Parameters (var)]
 *
 * "Parameters (variable)" ไม่มี length prefix → parser ต้องรู้ขนาดจาก Type
 *
 * ถ้ามี Relationship Type ใหม่ในอนาคต → parser เก่าไม่รู้จะข้ามกี่ bytes
 * → ไม่สามารถ skip unknown bond type → ต้อง reject seed ทั้งก้อน
 *
 * ข้อเสนอแนะ: เพิ่ม parameterLength (2 bytes) ก่อน parameters
 *
 *   // โครงสร้างใหม่:
 *   Bond Field V2 = [Field ID (2B)] [Source (2B)] [Target (2B)]
 *                   [Type (1B)] [Parameter Length (2B)] [Parameters (...B)]
 *
 *   // ตัวอย่าง parser:
 *   const paramLen = view.getUint16(offset, false);
 *   if (knownType(relType)) {
 *     // parse normally
 *   } else {
 *     // skip paramLen bytes — forward compatible!
 *     offset += paramLen;
 *   }
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #3: Multiplicative Mutation ใช้ไม่ได้กับ signed/zero fields ✅ (แก้แล้ว)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เดิม: field.value = clamp(field.value * (1 + δ), min, max)
 *
 * ปัญหา:
 *   - ค่าติดลบ: value=-0.5, δ=0.2 → (-0.5)*1.2 = -0.6 (เพิ่ม magnitude ผิดทิศ)
 *   - ค่าใกล้ศูนย์: value=0.01, δ=0.2 → 0.01*1.2 = 0.012 (เปลี่ยนแทบไม่มี)
 *
 * แก้แล้ว: ใช้ additive mutation
 *   field.value = clamp(field.value + range * magnitude * randomGaussian(), min, max)
 *
 * ดูใน SeedMutator.coreShift() และ SeedMutator.textureEdit()
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #4: Crossover zip by Position ≠ by Field ID ✅ (แก้แล้ว)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เดิม: for (fa, fb) in zip(parentA.coreFields, parentB.coreFields)
 *
 * ปัญหา: zip จับคู่ตามตำแหน่ง (index) ไม่ใช่ตาม field ID
 *   parentA = [field 1, field 3, field 5]
 *   parentB = [field 2, field 3, field 5]
 *   zip → จับ (field 1, field 2) → ผิด! (ไม่ใช่ field เดียวกัน)
 *
 * แก้แล้ว: วนตาม domain.coreFields แล้วหาในแต่ละ parent ด้วย field ID
 *
 * ดูใน SeedMutator.blendCores()
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #5: Bond Application Ordering ✅ (แก้แล้ว)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เดิม: Apply bonds แบบ imperative — เปลี่ยนค่าทีละ bond
 *   ปัญหา: ลำดับมีผล → INHIBIT + AMPLIFY บน field เดียวกัน
 *          ให้ผลต่างกันขึ้นอยู่กับว่าอันไหน apply ก่อน
 *   → ไม่ deterministic ข้าม implementations!
 *
 * แก้แล้ว: Apply แบบ declarative:
 *   1. รวบรวม adjustments ทั้งหมด (multiplicative + additive แยกกัน)
 *   2. Sort bonds by ID (deterministic ordering)
 *   3. Apply พร้อมกัน
 *   4. Apply CONSTRAINT bonds ทีหลัง (hard constraints override)
 *
 * ดูใน DomainRuntime.applyBonds()
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #6: CORRELATE lerp factor = magic number ✅ (แก้บางส่วน)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เดิม: params[target] = lerp(target_val, target_mean, 0.3)
 *   0.3 = magic number ไม่มีการอธิบาย ไม่ให้ผู้ใช้ปรับ
 *
 * แก้แล้ว: เปลี่ยนเป็นตัวแปร `influence = 0.3`
 *   แต่ยังไม่ได้เพิ่มเป็น parameter ของ CORRELATE bond
 *   → ควรเพิ่ม `influence: float64` ใน CORRELATE parameters
 *
 *   // ข้อเสนอ:
 *   export type BondParameters =
 *     | { type: RelationshipType.CORRELATE; rho: number; influence: number }
 *     //                                                             ^^^^^^^^ เพิ่ม
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #7: ไม่มี Array/Repeated Type ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ปัญหา: หลาย Domain ต้องการ field แบบ "list of values"
 *   เช่น ชุด pitch classes, ชุด time signature changes
 *   ตอนนี้ต้องใช้ BYTES (0x08) แล้ว encode เอง → ไม่ self-describing
 *
 * ข้อเสนอแนะ: เพิ่ม type tag 0x0A = array
 *   Array = [Element Type (1B)] [Count (2B)] [Value 1] [Value 2] ...
 *
 *   // ตัวอย่าง: custom scale = [C, D, E, G, A] (pentatonic)
 *   // tag=0x0A, element_type=0x01 (uint8), count=5, values=[0, 2, 4, 7, 9]
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #8: Field ID Range อาจไม่พอ ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ปัจจุบัน:
 *   Core:    1-999     (999 fields)
 *   Texture: 1000-1999 (1000 fields)
 *   Bond:    2000-2999 (1000 fields)
 *
 * สำหรับ Domain ง่ายๆ เช่น MIDI → พอ
 * แต่สำหรับ Domain ซับซ้อน เช่น 3D scene generation → อาจไม่พอ
 *
 * ข้อเสนอแนะ: ขยายเป็น 3 bytes field ID
 *   Core:    0x000001 – 0x00FFFF   (65535 fields)
 *   Texture: 0x010000 – 0x01FFFF   (65535 fields)
 *   Bond:    0x020000 – 0x02FFFF   (65535 fields)
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #9: ขาด Error Recovery Strategy ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * สิ่งที่ไม่ได้ครอบคลุมใน spec:
 * - Domain Runtime crash ระหว่าง generate → artifact ไม่สมบูรณ์
 * - Seed Store เสีย → seed หาย → lineage chain ขาด
 * - Lineage Store ล้มเหลว → ไม่สามารถบันทึก curation → ละเมิด Axiom A3
 *
 * ข้อเสนอแนะ:
 * 1. Local Lineage Buffer — เก็บ curation actions ชั่วคราวที่ client
 *    sync เมื่อ lineage store กลับมา
 * 2. Artifact Cache — เก็บ artifacts ที่ client เพื่อไม่ต้อง re-generate
 * 3. Circuit Breaker — ถ้า service ล้มเหลวติดต่อกัน → หยุดชั่วคราว
 *    แล้วแจ้ง user
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #10: ไม่มี Stagnation Detection ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ถ้า user เลือก "Medium" radius เรื่อยๆ → seed อาจวนลูปใน local optimum
 * → ผลงานดูเหมือนเดิมทุกรอบ → user เบื่อ → ละทิ้ง
 *
 * ข้อเสนอแนะ: เพิ่ม Stagnation Detector
 *
 *   function detectStagnation(lineage: LineageRecord[]): RadiusSuggestion | null {
 *     const recentTags = lineage.slice(-5).flatMap(r => r.curation.tags);
 *     const repeatedTags = findHighFrequency(recentTags);
 *     const depthRatio = computeEffectiveDepth(lineage) / lineage.length;
 *
 *     if (repeatedTags || depthRatio < 0.5) {
 *       return {
 *         suggestion: 'broad',
 *         reason: 'ผลงานเริ่มซ้ำๆ ลองเปลี่ยน radius เป็น Broad'
 *       };
 *     }
 *     return null;
 *   }
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #11: Human-in-the-loop Bottleneck ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Curation ต้องมีคนดูทุก artifact → batch 10 = ดู 10 ชิ้น
 * ถ้า Domain ช้า (30 วินาที/artifact) → batch 10 = 5 นาทีรอ
 * → 10 รอบ = 1.5-2.5 ชั่วโมง
 *
 * ข้อเสนอแนะ:
 * 1. Hierarchical Curation:
 *    - สร้าง batch ใหญ่ (50)
 *    - Auto-cluster → แสดง representative ของแต่ละ cluster
 *    - User เลือก cluster → ดูทั้ง cluster
 *
 * 2. Background Generation:
 *    - Generate artifacts ถัดไปขณะ user ดู batch ปัจจุบัน
 *    - Pipeline: ดู batch N ไปพร้อมกับ generate batch N+1
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #12: Distance Metric ผสม Binary + Continuous ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * d(s1, s2) = w_core * d_core + w_tex * d_tex + w_bond * d_bond
 *
 * ปัญหา: d_core = binary (ต่าง/ไม่ต่าง) แต่ d_tex = continuous (ต่างเท่าไหร่)
 *
 * ตัวอย่าง: tempo เปลี่ยนจาก 120→122 BPM (นิดหน่อย) → d_core = 1
 *          tempo เปลี่ยนจาก 120→240 BPM (มาก) → d_core = 1
 * → distance เท่ากันทั้งคู่! ทั้งที่ผลกระทบต่างกันมาก
 *
 * ข้อเสนอแนะ: d_core ควรใช้ normalized continuous distance เหมือน d_tex
 *   d_core = Σ |Δf| / (max - min) for each core field
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ปัญหา #14: decision_range ไม่ถูกกำหนด ❌
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ใน entropy mechanism: decision = lerp(decision, noise * decision_range, influence)
 * `decision_range` ไม่มีนิยาม → แต่ละ Domain ต้องกำหนดเอง
 * ถ้า Domain ไม่กำหนด → undefined behavior
 *
 * ข้อเสนอแนะ: เพิ่ม `decision_range` ใน Domain Manifest
 *   สำหรับแต่ละ decision point:
 *     decision_range: { min: number, max: number }
 */

// #############################################################################
// #############################################################################
//
//   APPENDIX: Self-Corrections Register
//   ────────────────────────────────────
//
//   สิ่งที่เคยคิดผิดแล้วแก้แล้ว — บันทึกไว้เพื่อไม่ให้ทำซ้ำ
//
// #############################################################################
// #############################################################################

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Correction #1: Sequential Dimensions of Seed Quality
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เคยคิด: Seed quality มี 2 เฟส — "smart first, then specific"
 *   เฟส 1: tuning ทำให้ seed "เก่ง" (quality เพิ่ม)
 *   เฟส 2: tuning ทำให้ seed "จำเพาะ" (aesthetic เปลี่ยน)
 *
 * ความจริง: Tuning ปรับ seed แบบองค์รวม (holistic)
 *   ไม่มีเฟสแยก — การสังเกตเห็นเฟสเป็น "emergent artifact"
 *   เกิดจากเรขาคณิตของ seed space:
 *     - รอบแรก: seed อยู่ใน region แย่ → ทิศทางไหนก็ดีขึ้น = "ดูเหมือนเก่งขึ้น"
 *     - รอบหลัง: seed อยู่ใน region ดีแล้ว → เลือกทิศทาง = "ดูเหมือนจำเพาะขึ้น"
 *
 * ผลกระทบต่อการ implement:
 *   - ห้าม encode "phase detection" ในระบบ
 *   - Mutation operators เป็น phase-agnostic
 *   - Radius presets ไม่ใช่ "phase selectors"
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Correction #2: Entropy Budget Placement
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เคยคิด: Entropy budget เป็น core field
 * ความจริง: Entropy budget เป็น header meta-field
 *
 * เหตุผล:
 *   - มันควบคุมว่า Domain จะรัน Seed อย่างไร ไม่ใช่ว่า Seed จะสร้างอะไร
 *   - ต้องปรับได้โดยไม่ต้องเปลี่ยน generative content
 *   - ต้องอ่านได้ก่อนที่ Domain จะเริ่ม parse fields
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Correction #3: Deterministic Preview Method
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เคยคิด: Preview ด้วย entropy_budget = 0
 * ความจริง: ใช้ fixed execution_seed แทน
 *
 * เหตุผล:
 *   - entropy=0 ให้ผลแบบ deterministic ที่ต่างจาก output ปกติโดยสิ้นเชิง
 *     (ไม่มี creative variation เลย → ไม่ represent ลักษณะของ seed)
 *   - fixed execution_seed + actual entropy_budget
 *     → ให้ผลที่ reproducible แต่ยังคงลักษณะของ seed อยู่
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Correction #4: Encoding Format Choice
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เคยคิด: ใช้ Protocol Buffers (Protobuf)
 * ความจริง: ใช้ self-describing format แบบ custom
 *
 * เหตุผล:
 *   - Protobuf ต้องการ .proto schema ร่วม → coupling + versioning ซับซ้อน
 *   - Custom format ที่ field IDs carry type information → "appendable without breaking"
 *   - คล้าย CBOR แต่มี convention เฉพาะสำหรับ tiered fields
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Correction #5: Salvage Complexity
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * เคยคิด: Salvage ต้องการ Domain แมป seed fields → artifact features
 * ความจริง: v1 ทำ salvage ที่ field level เท่านั้น
 *
 * เหตุผล:
 *   - Field-aspect mapping ซับซ้อนมาก → ไม่เหมาะกับ MVP
 *   - v1: user เลือก fields ที่จะ salvage เอง (ต้องเข้าใจ domain)
 *   - v2: Domain แมป fields → features ให้อัตโนมัติ (optional)
 */

// #############################################################################
// #############################################################################
//
//   จบไฟล์ — cultivar-js System TypeScript Implementation
//
//   สรุป:
//   - 13 ส่วน ครอบคลุมทุกแง่มุมของระบบ
//   - 5 ปัญหา P0 แก้แล้ว 3 (mutation, crossover, bond ordering)
//   - 2 ปัญหา P0 ยังไม่ได้แก้ (CRC32, bond length prefix) ต้องแก้ใน spec
//   - 9 ปัญหา P1/P2 บันทึกไว้พร้อมข้อเสนอแนะ
//
//   ก่อนเริ่ม Phase 0: แก้ 2 ปัญหา P0 ที่เหลือ แล้วก็พร้อม implement!
//
// #############################################################################
// #############################################################################
