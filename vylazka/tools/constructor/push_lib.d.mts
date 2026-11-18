// Типы push_lib.mjs — для тестов (tests/constructor_push.test.ts) и страницы.
export type PushResult = { ok: boolean; message?: string; problems?: string[]; detail?: string; auth?: boolean; nothing?: boolean };
export type Counts = { things: number; moved: number; removed: number; figures: number; requests: number };
export declare const PATHS: string[];
export declare function git(args: string[], opts?: { timeout?: number; input?: string }): Promise<string>;
export declare function checkAll(): Promise<{ problems: string[]; counts: Counts }>;
export declare function failKind(text: string): 'auth' | 'behind' | 'offline' | 'other';
export declare function parseRemote(url: string): { protocol: string; host: string; owner: string } | null;
export declare const describe: (c: Counts) => string;
export declare function pushAll(opts?: { status?: (s: string) => void }): Promise<PushResult>;
export declare const isToken: (t: unknown) => boolean;
export declare function saveToken(raw: unknown): Promise<{ ok: boolean; message?: string }>;
