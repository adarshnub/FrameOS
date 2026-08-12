import {
  v7 as uuidv7,
  validate as validateUuid,
  version as uuidVersion,
} from "uuid";

export type EntityId = string;

export function createId(): EntityId {
  return uuidv7();
}

export function isEntityId(value: string): boolean {
  return validateUuid(value) && [4, 7].includes(uuidVersion(value));
}
