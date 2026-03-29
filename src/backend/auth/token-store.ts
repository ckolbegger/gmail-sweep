import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export class TokenStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  save(tokens: Tokens): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(tokens, null, 2));
  }

  load(): Tokens | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as Tokens;
    } catch {
      throw new Error("Token file contains malformed JSON");
    }
  }

  isExpired(): boolean {
    const tokens = this.load();
    if (!tokens) return true;
    return Date.now() >= tokens.expiry_date;
  }
}
