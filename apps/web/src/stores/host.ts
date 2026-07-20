import { atom } from "nanostores"

/**
 * Whether this participant organises the meeting (created it, or — in
 * deployments without the host gate — arrived first). Set from the token
 * response; gates the agent management UI.
 */
export const $isHost = atom<boolean>(false)
