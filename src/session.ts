import { mkdir, readFile, rename, writeFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const credentialsSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().regex(/^[a-f0-9]{64}$/),
});
export type NativeCredentials = z.infer<typeof credentialsSchema>;
const sessionSchema = credentialsSchema.extend({
  baseUrl: z.string().url(),
  userId: z.number().int().positive(),
});
export type NativeSession = z.infer<typeof sessionSchema>;

/** One BookOrbit native session, owned by one connector process. Never log it. */
export class SessionStore {
  constructor(
    readonly path: string,
    readonly baseUrl: string,
  ) {}

  async load(): Promise<NativeSession> {
    const mode = (await stat(this.path)).mode;
    if (mode & 0o077) throw new Error("Session file must be private (chmod 600).");
    const session = sessionSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    if (session.baseUrl !== this.baseUrl)
      throw new Error("Session belongs to another BookOrbit URL.");
    return session;
  }

  async save(session: NativeSession): Promise<void> {
    const validated = sessionSchema.parse(session);
    if (validated.baseUrl !== this.baseUrl) throw new Error("Session URL mismatch.");
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(validated), { mode: 0o600, flag: "wx" });
      await rename(temp, this.path);
    } finally {
      await rm(temp, { force: true });
    }
  }
}
