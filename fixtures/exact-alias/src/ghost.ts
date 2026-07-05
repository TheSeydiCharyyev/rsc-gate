// Exists on disk, but "@/ghost" maps to ./src/nope (dead target). A matched
// exact paths key is definitive — the "@/*" pattern must NOT pick this up.
export const ghost = true;
